import { describe, expect, it } from 'vitest';
import { CENSUS_LIST_SIZE, chunkCensusIDs, readStatementLabel, type BuiltStatement, type ErrorSetScope } from '@/app/api/errors/explorer/errorsetsql';
import { mergeSignatureRows } from '@/app/api/errors/explorer/errorsetcounts';
import {
  buildF1MembershipProbe,
  buildF2MembershipProbe,
  compareWarmUpSamples,
  M1_INCONCLUSIVE_DIAGNOSTICS,
  M1_STATUS,
  M1_TRIGGER_RATIO,
  m1Summary,
  MEMBERSHIP_PROBE_LABELS,
  runMembershipProbe,
  runMembershipProbeRepetition,
  type MembershipProbeRow,
  type MembershipProbeSample,
  type TimedProbeRows
} from './membershipprobe';

const SCHEMA = 'forestgeo_testsite';
const PLOT_ID = 3;
const CENSUS_COUNT = 26;
const EXPECTED_CHUNK_LENGTHS = [8, 8, 8, 2];
const EXPECTED_TARGET_DURATION_MS = 10;
const CENSUS_IDS = Array.from({ length: CENSUS_COUNT }, (_, index) => index + 1);
const SCOPE: ErrorSetScope = { schema: SCHEMA, plotID: PLOT_ID, censusIDs: CENSUS_IDS };
const MEASURED_RUNS = 2;
const WALL_DELAY_MS = 8;
const CALLS_PER_REPETITION = EXPECTED_CHUNK_LENGTHS.length;
const MEASUREMENT_ID_FACTOR = 1000;
const PRIOR_DBH = '12.50';
const CHANGED_PRIOR_DBH = '12.60';
const PRIOR_HOM = '1.30';
const NULLS_PER_SLOT_LIST = (chunkLength: number) => CENSUS_LIST_SIZE - chunkLength;
const CENSUS_LISTS_IN_F2_SOURCE = 2;
const PLOT_PARAM_COUNT = 1;

type ProbeBuilder = (chunk: ErrorSetScope) => BuiltStatement;
const PROBE_BUILDERS: Array<[string, ProbeBuilder, string]> = [
  ['F2', buildF2MembershipProbe, MEMBERSHIP_PROBE_LABELS.f2],
  ['F1', buildF1MembershipProbe, MEMBERSHIP_PROBE_LABELS.f1]
];

/** Both builders bind the plot first and the padded census list second. */
function censusIDsOf(statement: BuiltStatement): number[] {
  return statement.params.slice(PLOT_PARAM_COUNT, PLOT_PARAM_COUNT + CENSUS_LIST_SIZE).filter((param): param is number => param !== null);
}

function rowFor(censusID: number, priorDBH: string = PRIOR_DBH): MembershipProbeRow {
  return { CoreMeasurementID: censusID * MEASUREMENT_ID_FACTOR, ErrorID: censusID, PriorCensusID: censusID - 1, PriorDBH: priorDBH, PriorHOM: PRIOR_HOM };
}

interface RecordingRun {
  readonly chunks: number[][];
  readonly statements: BuiltStatement[];
  readonly executedLabels: string[];
  maxInFlight: number;
  readonly buildProbe: (builder: ProbeBuilder) => ProbeBuilder;
  readonly execute: (statement: BuiltStatement) => Promise<TimedProbeRows>;
}

/** The executor reports its own SQL time: the n-th completed call of a repetition takes n milliseconds. No clock is read anywhere else. */
function recordingRun(options: { rowsForChunk?: (chunk: number[]) => MembershipProbeRow[] } = {}): RecordingRun {
  const rowsForChunk = options.rowsForChunk ?? ((chunk: number[]) => chunk.map(censusID => rowFor(censusID)));
  let inFlight = 0;
  let callsInRepetition = 0;
  const run: RecordingRun = {
    chunks: [],
    statements: [],
    executedLabels: [],
    maxInFlight: 0,
    buildProbe: builder => chunk => {
      const statement = builder(chunk);
      run.chunks.push([...chunk.censusIDs]);
      return statement;
    },
    execute: async statement => {
      inFlight++;
      run.maxInFlight = Math.max(run.maxInFlight, inFlight);
      run.statements.push(statement);
      run.executedLabels.push(statement.sql.slice(0, statement.sql.indexOf('*/') + 2));
      callsInRepetition = (callsInRepetition % CALLS_PER_REPETITION) + 1;
      await Promise.resolve();
      inFlight--;
      return { rows: rowsForChunk(censusIDsOf(statement)), sqlMs: callsInRepetition };
    }
  };
  return run;
}

describe('membership probe builders', () => {
  it.each(PROBE_BUILDERS)('%s carries its probe label, which is not an explorer statement label', (_name, build, label) => {
    const { sql } = build({ ...SCOPE, censusIDs: [1, 2] });
    console.log(`probe label=${label} first line=${sql.split('\n')[0]}`);
    expect(sql.startsWith(label)).toBe(true);
    expect(readStatementLabel(sql), 'a probe must not count toward the nine explorer statement texts').toBeNull();
  });

  it.each(PROBE_BUILDERS)('%s pads every census list to the fixed slot count with NULLs', (name, build) => {
    for (const chunkLength of [1, 2, CENSUS_LIST_SIZE]) {
      const chunk = Array.from({ length: chunkLength }, (_, index) => index + 1);
      const { params } = build({ ...SCOPE, censusIDs: chunk });
      const nullCount = params.filter(param => param === null).length;
      const censusListCount = name === 'F2' ? CENSUS_LISTS_IN_F2_SOURCE : 1;
      console.log(`${name} chunk length ${chunkLength}: ${params.length} params, ${nullCount} NULL slots`);
      expect(nullCount).toBe(NULLS_PER_SLOT_LIST(chunkLength) * censusListCount);
      expect(chunk.every(censusID => params.includes(censusID))).toBe(true);
    }
  });
});

describe('membership probe repetition over a multi-chunk target', () => {
  it.each(PROBE_BUILDERS)('%s runs 26 censuses as sequential chunks of 8/8/8/2 and sums the call durations', async (_name, build) => {
    const run = recordingRun();
    const sample = await runMembershipProbeRepetition(SCOPE, run.buildProbe(build), run.execute);
    console.log(
      `chunks=${JSON.stringify(run.chunks.map(chunk => chunk.length))} maxInFlight=${run.maxInFlight} durationMs=${sample.durationMs} rows=${sample.rowCount}`
    );
    expect(run.chunks.map(chunk => chunk.length)).toEqual(EXPECTED_CHUNK_LENGTHS);
    expect(run.chunks.flat()).toEqual(CENSUS_IDS);
    expect(run.maxInFlight).toBe(1);
    expect(sample.durationMs).toBe(EXPECTED_TARGET_DURATION_MS);
    expect(sample.rowCount).toBe(CENSUS_COUNT);
  });

  it('sums the SQL time the executor reports, whatever wall time passes around the call', async () => {
    const run = recordingRun();
    const slowAround = async (statement: BuiltStatement) => {
      await new Promise(resolve => setTimeout(resolve, WALL_DELAY_MS));
      const timed = await run.execute(statement);
      await new Promise(resolve => setTimeout(resolve, WALL_DELAY_MS));
      return timed;
    };
    const startedAt = performance.now();
    const sample = await runMembershipProbeRepetition(SCOPE, buildF2MembershipProbe, slowAround);
    const wallMs = performance.now() - startedAt;
    console.log(`wall=${wallMs.toFixed(1)} ms; reported SQL durationMs=${sample.durationMs}`);
    expect(wallMs).toBeGreaterThan(EXPECTED_TARGET_DURATION_MS);
    expect(sample.durationMs).toBe(EXPECTED_TARGET_DURATION_MS);
  });

  it('builds every chunk with at most eight census IDs, as chunkCensusIDs does', async () => {
    const run = recordingRun();
    await runMembershipProbeRepetition(SCOPE, run.buildProbe(buildF2MembershipProbe), run.execute);
    expect(run.chunks).toEqual(chunkCensusIDs(CENSUS_IDS));
  });

  it('gives the same hash for the same rows in a different order and a different hash when one value differs', async () => {
    const inOrder = recordingRun();
    const reversed = recordingRun({ rowsForChunk: chunk => chunk.map(censusID => rowFor(censusID)).reverse() });
    const changedValue = recordingRun({ rowsForChunk: chunk => chunk.map(censusID => rowFor(censusID, censusID === 1 ? CHANGED_PRIOR_DBH : PRIOR_DBH)) });
    const first = await runMembershipProbeRepetition(SCOPE, inOrder.buildProbe(buildF2MembershipProbe), inOrder.execute);
    const second = await runMembershipProbeRepetition(SCOPE, reversed.buildProbe(buildF1MembershipProbe), reversed.execute);
    const third = await runMembershipProbeRepetition(SCOPE, changedValue.buildProbe(buildF1MembershipProbe), changedValue.execute);
    console.log(`hashes in-order=${first.hash.slice(0, 12)} reversed=${second.hash.slice(0, 12)} changed=${third.hash.slice(0, 12)}`);
    expect(second.rowCount).toBe(first.rowCount);
    expect(second.hash).toBe(first.hash);
    expect(third.rowCount).toBe(first.rowCount);
    expect(third.hash).not.toBe(first.hash);
  });

  it('keeps duplicate rows, so a form that repeats a row cannot match one that does not', async () => {
    const single = recordingRun();
    const duplicated = recordingRun({ rowsForChunk: chunk => chunk.flatMap(censusID => [rowFor(censusID), rowFor(censusID)]) });
    const one = await runMembershipProbeRepetition(SCOPE, single.buildProbe(buildF2MembershipProbe), single.execute);
    const two = await runMembershipProbeRepetition(SCOPE, duplicated.buildProbe(buildF1MembershipProbe), duplicated.execute);
    expect(two.rowCount).toBe(one.rowCount * 2);
    expect(two.hash).not.toBe(one.hash);
  });
});

describe('membership probe comparability', () => {
  const sample = (overrides: Partial<MembershipProbeSample> = {}): MembershipProbeSample => ({
    durationMs: 5,
    rowCount: CENSUS_COUNT,
    hash: 'aaaa',
    ...overrides
  });

  it('accepts a warm-up pair with the same row count and hash', () => {
    expect(compareWarmUpSamples(sample(), sample({ durationMs: 9 }))).toBeNull();
  });

  it('reports a hash mismatch when the counts are equal but a value differs', async () => {
    const f2 = recordingRun();
    const f1 = recordingRun({ rowsForChunk: chunk => chunk.map(censusID => rowFor(censusID, censusID === 1 ? CHANGED_PRIOR_DBH : PRIOR_DBH)) });
    const f2Sample = await runMembershipProbeRepetition(SCOPE, f2.buildProbe(buildF2MembershipProbe), f2.execute);
    const f1Sample = await runMembershipProbeRepetition(SCOPE, f1.buildProbe(buildF1MembershipProbe), f1.execute);
    console.log(`warm-up rows F2=${f2Sample.rowCount} F1=${f1Sample.rowCount}`);
    expect(f1Sample.rowCount).toBe(f2Sample.rowCount);
    expect(compareWarmUpSamples(f2Sample, f1Sample)).toBe(M1_INCONCLUSIVE_DIAGNOSTICS.hashMismatch);
  });

  it('reports a row-count mismatch', () => {
    expect(compareWarmUpSamples(sample(), sample({ rowCount: CENSUS_COUNT + 1 }))).toBe(M1_INCONCLUSIVE_DIAGNOSTICS.rowCountMismatch);
  });

  it.each([
    ['0', 0],
    ['negative', -3]
  ])('is inconclusive, with no ratio or trigger, when the F1 median is %s', (_name, f1Duration) => {
    const summary = m1Summary([10, 11, 12], [f1Duration, f1Duration, f1Duration]);
    console.log(`summary=${JSON.stringify(summary)}`);
    expect(summary.m1Status).toBe(M1_STATUS.inconclusive);
    expect(summary).not.toHaveProperty('m1Ratio');
    expect(summary).not.toHaveProperty('m1Triggered');
    expect(summary).toMatchObject({ diagnostic: M1_INCONCLUSIVE_DIAGNOSTICS.nonPositiveBaseline });
  });

  it('is inconclusive when there are no measured durations', () => {
    expect(m1Summary([], []).m1Status).toBe(M1_STATUS.inconclusive);
  });

  it('computes the ratio of the two medians and triggers only above the threshold', () => {
    expect(m1Summary([10, 11, 12], [10, 10, 10])).toMatchObject({ m1Status: M1_STATUS.comparable, m1Ratio: 1.1, m1Triggered: false });
    expect(m1Summary([13, 13, 13], [10, 10, 10])).toMatchObject({ m1Status: M1_STATUS.comparable, m1Ratio: 1.3, m1Triggered: true });
    expect(m1Summary([12, 12, 12], [10, 10, 10])).toMatchObject({ m1Ratio: M1_TRIGGER_RATIO, m1Triggered: false });
  });

  it('uses the median of the per-repetition sums, not the fastest or the mean', () => {
    const summary = m1Summary([100, 11, 12, 13, 400], [10, 10, 10, 10, 10]);
    expect(summary).toMatchObject({ p50F2Ms: 13, p50F1Ms: 10, m1Ratio: 1.3 });
  });
});

describe('membership probe scenario', () => {
  it('warms each form once, alternates F2 then F1, and reports comparable timings', async () => {
    const run = recordingRun();
    const result = await runMembershipProbe(SCOPE, run.execute, { measuredRuns: MEASURED_RUNS });
    const labelsPerRepetition = run.executedLabels.filter((_label, index) => index % CALLS_PER_REPETITION === 0);
    console.log(`repetition order=${JSON.stringify(labelsPerRepetition)} result=${JSON.stringify(result)}`);
    expect(labelsPerRepetition).toEqual(Array.from({ length: 1 + MEASURED_RUNS }).flatMap(() => [MEMBERSHIP_PROBE_LABELS.f2, MEMBERSHIP_PROBE_LABELS.f1]));
    expect(run.maxInFlight).toBe(1);
    expect(result).toMatchObject({ m1Status: M1_STATUS.comparable, f2RowCount: CENSUS_COUNT, f1RowCount: CENSUS_COUNT, m1Ratio: 1, m1Triggered: false });
  });

  it('stops after the warm-ups and reports inconclusive when the forms return different rows', async () => {
    const run = recordingRun();
    const differing = async (statement: BuiltStatement) => {
      const timed = await run.execute(statement);
      return statement.sql.startsWith(MEMBERSHIP_PROBE_LABELS.f1) ? { ...timed, rows: timed.rows.slice(1) } : timed;
    };
    const result = await runMembershipProbe(SCOPE, differing, { measuredRuns: MEASURED_RUNS });
    console.log(`result=${JSON.stringify(result)} executed=${run.executedLabels.length}`);
    expect(result.m1Status).toBe(M1_STATUS.inconclusive);
    expect(result).not.toHaveProperty('m1Ratio');
    expect(result).not.toHaveProperty('m1Triggered');
    expect(run.executedLabels).toHaveLength(2 * CALLS_PER_REPETITION);
  });

  it('never puts rows, SQL or parameters in the diagnostic', async () => {
    const run = recordingRun();
    const differing = async (statement: BuiltStatement) => {
      const timed = await run.execute(statement);
      return statement.sql.startsWith(MEMBERSHIP_PROBE_LABELS.f1)
        ? { ...timed, rows: timed.rows.map(row => ({ ...row, PriorDBH: CHANGED_PRIOR_DBH })) }
        : timed;
    };
    const result = await runMembershipProbe(SCOPE, differing, { measuredRuns: MEASURED_RUNS });
    const printed = JSON.stringify(result);
    expect(result).toMatchObject({ m1Status: M1_STATUS.inconclusive, diagnostic: M1_INCONCLUSIVE_DIAGNOSTICS.hashMismatch });
    expect(printed).not.toContain(CHANGED_PRIOR_DBH);
    expect(printed).not.toContain(SCHEMA);
  });
});

describe('signature merging across census chunks', () => {
  it('counts one signature once and sums its MeasurementCount over four chunks', () => {
    const signature = { ErrorTypeKeys: '3,7', SignatureComplete: 1, HasDuplicate: 0, HasSameBatch: 1, IsFailedRow: 0 };
    const otherSignature = { ErrorTypeKeys: '3', SignatureComplete: 1, HasDuplicate: 0, HasSameBatch: 0, IsFailedRow: 0 };
    const chunks = [1, 2, 3, 4].map(count => [{ ...signature, MeasurementCount: count }]);
    chunks[2].push({ ...otherSignature, MeasurementCount: 5 });
    const merged = mergeSignatureRows(chunks);
    console.log(`per-chunk row counts=${JSON.stringify(chunks.map(chunk => chunk.length))} merged=${JSON.stringify(merged)}`);
    expect(merged).toHaveLength(2);
    expect(merged.find(row => row.ErrorTypeKeys === signature.ErrorTypeKeys)?.MeasurementCount).toBe(10);
    expect(merged.find(row => row.ErrorTypeKeys === otherSignature.ErrorTypeKeys)?.MeasurementCount).toBe(5);
    expect(merged.length).toBeLessThan(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  });
});
