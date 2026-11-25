import { createHash } from 'node:crypto';
import { buildInPlaceholders, safeFormatQuery } from '@/lib/db/sqlsecurity';
import { CENSUS_LIST_SIZE, chunkCensusIDs, errorOccurrenceSource, type BuiltStatement, type ErrorSetScope } from '@/app/api/errors/explorer/errorsetsql';

export const MEMBERSHIP_PROBE_LABELS = {
  f2: '/* errors-explorer-probe:membership-f2 */',
  f1: '/* errors-explorer-probe:membership-f1 */'
} as const;
export const M1_TRIGGER_RATIO = 1.2;

export const M1_STATUS = { comparable: 'comparable', inconclusive: 'inconclusive' } as const;
export type M1Status = (typeof M1_STATUS)[keyof typeof M1_STATUS];

export const M1_INCONCLUSIVE_DIAGNOSTICS = {
  rowCountMismatch: 'the two membership forms returned different row counts at warm-up',
  hashMismatch: 'the two membership forms returned different rows at warm-up',
  nonPositiveBaseline: 'the F1 median duration was not positive',
  noMeasurements: 'no measured durations',
  statementTimedOut: 'a probe statement exceeded the statement time limit'
} as const;

const PROBE_COLUMNS = 'eo.CoreMeasurementID, eo.ErrorID, eo.PriorCensusID, eo.PriorDBH, eo.PriorHOM';
const PROBE_ORDER = 'ORDER BY eo.CoreMeasurementID, eo.ErrorID';
const MEDIAN_DIVISOR = 2;

function paddedCensusIDs(scope: ErrorSetScope): Array<number | null> {
  return [...scope.censusIDs, ...Array<null>(CENSUS_LIST_SIZE - scope.censusIDs.length).fill(null)];
}

/** F2, the shipped shared source (spec §2), projecting its five columns. */
export function buildF2MembershipProbe(scope: ErrorSetScope): BuiltStatement {
  const source = errorOccurrenceSource(scope, null);
  return {
    sql: safeFormatQuery(scope.schema, `${MEMBERSHIP_PROBE_LABELS.f2}\nSELECT ${PROBE_COLUMNS}\n  FROM (\n${source.sql}\n  ) eo\n ${PROBE_ORDER}`),
    params: source.params
  };
}

/** F1, today's LEFT JOIN membership (8b60006b _shared.ts:209-221) with the sargable IsResolved predicate, same five columns. */
export function buildF1MembershipProbe(scope: ErrorSetScope): BuiltStatement {
  return {
    sql: safeFormatQuery(
      scope.schema,
      `${MEMBERSHIP_PROBE_LABELS.f1}
SELECT ${PROBE_COLUMNS}
  FROM (SELECT cm.CoreMeasurementID, mel.ErrorID, mel.PriorCensusID, mel.PriorDBH, mel.PriorHOM
          FROM ??.coremeasurements cm
          JOIN ??.measurementssummary ms ON ms.CoreMeasurementID = cm.CoreMeasurementID
          LEFT JOIN ??.measurement_error_log mel
            ON mel.MeasurementID = cm.CoreMeasurementID AND (mel.IsResolved = FALSE OR mel.IsResolved IS NULL)
         WHERE ms.PlotID = ? AND ms.CensusID IN (${buildInPlaceholders(CENSUS_LIST_SIZE)}) AND COALESCE(cm.IsActive, TRUE) = TRUE
           AND (mel.MeasurementID IS NOT NULL OR ms.IsValidated = FALSE)) eo
 ${PROBE_ORDER}`
    ),
    params: [scope.plotID, ...paddedCensusIDs(scope)]
  };
}

export interface MembershipProbeRow {
  CoreMeasurementID: number;
  ErrorID: number | null;
  PriorCensusID: number | null;
  PriorDBH: number | string | null;
  PriorHOM: number | string | null;
}
export interface MembershipProbeSample {
  durationMs: number;
  rowCount: number;
  hash: string;
}

type ProbeBuilder = (chunk: ErrorSetScope) => BuiltStatement;
/** The rows and the SQL-only duration, as measured by the caller's executor (telemetry and row serialisation excluded). */
export interface TimedProbeRows {
  rows: MembershipProbeRow[];
  sqlMs: number;
}
export type ProbeExecutor = (statement: BuiltStatement) => Promise<TimedProbeRows>;

/**
 * One repetition over the full target: every census chunk runs sequentially, and the repetition's duration is the sum
 * of the SQL durations the executor reports for each chunk call. Row canonicalisation and hashing are never timed.
 */
export async function runMembershipProbeRepetition(scope: ErrorSetScope, buildProbe: ProbeBuilder, execute: ProbeExecutor): Promise<MembershipProbeSample> {
  let durationMs = 0;
  const canonicalRows: string[] = [];
  for (const censusIDs of chunkCensusIDs(scope.censusIDs)) {
    const statement = buildProbe({ ...scope, censusIDs });
    const { rows, sqlMs } = await execute(statement);
    durationMs += sqlMs;
    for (const row of rows) {
      canonicalRows.push(JSON.stringify([row.CoreMeasurementID, row.ErrorID, row.PriorCensusID, row.PriorDBH, row.PriorHOM]));
    }
  }
  canonicalRows.sort();
  return { durationMs, rowCount: canonicalRows.length, hash: createHash('sha256').update(JSON.stringify(canonicalRows)).digest('hex') };
}

/** Null when the two warm-up samples describe the same rows; otherwise a fixed diagnostic that names neither rows nor SQL. */
export function compareWarmUpSamples(f2: MembershipProbeSample, f1: MembershipProbeSample): string | null {
  if (f2.rowCount !== f1.rowCount) return M1_INCONCLUSIVE_DIAGNOSTICS.rowCountMismatch;
  if (f2.hash !== f1.hash) return M1_INCONCLUSIVE_DIAGNOSTICS.hashMismatch;
  return null;
}

function p50(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / MEDIAN_DIVISOR);
  return sorted.length % MEDIAN_DIVISOR === 0 ? (sorted[middle - 1] + sorted[middle]) / MEDIAN_DIVISOR : sorted[middle];
}

export type M1Summary =
  | { m1Status: typeof M1_STATUS.comparable; p50F2Ms: number; p50F1Ms: number; m1Ratio: number; m1Triggered: boolean }
  | { m1Status: typeof M1_STATUS.inconclusive; diagnostic: string };

/** m1Ratio = p50(F2) / p50(F1) over the per-repetition target durations. */
export function m1Summary(f2DurationsMs: readonly number[], f1DurationsMs: readonly number[]): M1Summary {
  if (f2DurationsMs.length === 0 || f1DurationsMs.length === 0) {
    return { m1Status: M1_STATUS.inconclusive, diagnostic: M1_INCONCLUSIVE_DIAGNOSTICS.noMeasurements };
  }
  const p50F2Ms = p50(f2DurationsMs);
  const p50F1Ms = p50(f1DurationsMs);
  if (!(p50F1Ms > 0) || !Number.isFinite(p50F2Ms)) {
    return { m1Status: M1_STATUS.inconclusive, diagnostic: M1_INCONCLUSIVE_DIAGNOSTICS.nonPositiveBaseline };
  }
  const m1Ratio = p50F2Ms / p50F1Ms;
  return { m1Status: M1_STATUS.comparable, p50F2Ms, p50F1Ms, m1Ratio, m1Triggered: m1Ratio > M1_TRIGGER_RATIO };
}

export type M1Result = M1Summary & { f2RowCount: number; f1RowCount: number };

/**
 * The m1Probe scenario: one warm-up repetition per form (compared by row count and canonical hash), then
 * `measuredRuns` rounds of F2 followed by F1. A warm-up mismatch ends the scenario without measured rounds.
 */
export async function runMembershipProbe(scope: ErrorSetScope, execute: ProbeExecutor, options: { measuredRuns: number }): Promise<M1Result> {
  const repeat = (build: ProbeBuilder) => runMembershipProbeRepetition(scope, build, execute);
  const f2WarmUp = await repeat(buildF2MembershipProbe);
  const f1WarmUp = await repeat(buildF1MembershipProbe);
  const counts = { f2RowCount: f2WarmUp.rowCount, f1RowCount: f1WarmUp.rowCount };
  const mismatch = compareWarmUpSamples(f2WarmUp, f1WarmUp);
  if (mismatch) return { m1Status: M1_STATUS.inconclusive, diagnostic: mismatch, ...counts };
  const f2DurationsMs: number[] = [];
  const f1DurationsMs: number[] = [];
  for (let round = 0; round < options.measuredRuns; round++) {
    f2DurationsMs.push((await repeat(buildF2MembershipProbe)).durationMs);
    f1DurationsMs.push((await repeat(buildF1MembershipProbe)).durationMs);
  }
  return { ...m1Summary(f2DurationsMs, f1DurationsMs), ...counts };
}
