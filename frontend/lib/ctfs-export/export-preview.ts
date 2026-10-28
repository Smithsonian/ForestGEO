/**
 * Publish-precondition counts and the export preview for the census overview
 * (#547, #557): the blockers, why active measurements would be skipped by a
 * publish, and how many exported rows still carry an unresolved error.
 * "Exportable" is exportable-measurement.ts's definition, the set
 * selectMeasurements ships, and every row check is a PRECONDITION_ROW_CHECKS
 * declaration that checkFinishedCensus also runs, so the preview cannot disagree
 * with the gate or the artifact. Callers run these inside their snapshot transaction.
 */
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { safeFormatQuery } from '@/lib/db/sqlsecurity';
import { EXPORT_SKIP_REASON_KINDS, type ExportSkipReasonCount, type ExportSkipReasonKind } from '@/config/censusoverview';
import {
  ALL_MEASUREMENT_LINK_ALIASES,
  EXPORTABLE_ROW_CONDITION,
  exportableMeasurementIdSelect,
  joinMeasurementLinks,
  measurementLinksMatched
} from './exportable-measurement';
import {
  exportableShortfallKind,
  MEASUREMENT_SCOPE_FROM,
  MEASUREMENT_SCOPE_WHERE,
  NO_STEM_GUID_CONDITION,
  NOT_VALIDATED_CONDITION,
  PRECONDITION_ROW_CHECKS,
  rowCheckFromWhere,
  UNRESOLVED_ERROR_LOG_CONDITION,
  type BlockingKindClassifier,
  type MeasurementGraphRowCheck,
  type PreconditionInput,
  type PublishBlockerCount,
  type RelatedRowsRowCheck
} from './precondition';

// One condition per clause of the export predicate, built from the shared check
// predicates and link guards. Each is written so it never evaluates to NULL (LEFT
// JOIN misses are coalesced or tested through IS NOT NULL key guards), which keeps
// the `other` bucket exact. DeletedAt is ignored because the export ignores it.
const SKIP_REASON_CONDITIONS: Record<Exclude<ExportSkipReasonKind, 'other'>, string> = {
  'not-validated': `(${NOT_VALIDATED_CONDITION})`,
  'no-stem-guid': `(${NO_STEM_GUID_CONDITION})`,
  'inactive-stem-or-tree': '(COALESCE(s.IsActive, 1) <> 1 OR COALESCE(t.IsActive, 1) <> 1)',
  'missing-link': `(NOT (${NO_STEM_GUID_CONDITION}) AND NOT (${measurementLinksMatched(ALL_MEASUREMENT_LINK_ALIASES)}))`
};

function skipReasonCondition(kind: ExportSkipReasonKind): string {
  if (kind === 'other') return `NOT (${Object.values(SKIP_REASON_CONDITIONS).join(' OR ')})`;
  return SKIP_REASON_CONDITIONS[kind];
}

const TOTAL_ACTIVE_COLUMN = 'totalActiveCount';
const EXPORTABLE_COLUMN = 'exportableCount';
// not-validated and no-stem-guid are both check kinds and skip reasons, so the skip columns carry a prefix.
const SKIP_REASON_COLUMN_PREFIX = 'skip:';

export interface PublishPreconditionCounts {
  /** Classified, in check order, then the census-level shortfall kind. */
  blockers: PublishBlockerCount[];
  /** Exportable measurements, exactly as check 8 counts them. */
  count: number;
  /** Active measurements in the census, exactly as check 8 counts them. */
  totalActiveCount: number;
  /** Over skipped rows only; one row can have several reasons. */
  skipReasons: ExportSkipReasonCount[];
}

function skipReasonColumn(kind: ExportSkipReasonKind): string {
  return `${SKIP_REASON_COLUMN_PREFIX}${kind}`;
}

function countWhenColumn(condition: string, column: string): string {
  return `COUNT(CASE WHEN ${condition} THEN 1 END) AS \`${column}\``;
}

const MEASUREMENT_GRAPH_ROW_CHECKS = PRECONDITION_ROW_CHECKS.filter((check): check is MeasurementGraphRowCheck => check.joinShape === 'measurement-graph');

// NULL, not FALSE, when cm.IsValidated is NULL: negate it with IS NOT TRUE, never NOT.
const EXPORTABLE_IN_MEASUREMENT_GRAPH = `(${measurementLinksMatched(ALL_MEASUREMENT_LINK_ALIASES)}) AND (${EXPORTABLE_ROW_CONDITION})`;

/**
 * One scan of the census's active measurements, LEFT JOINed to every link: one
 * row per measurement, because each link is keyed on its table's primary key.
 * A measurement-graph check counts a row when every link the gate inner-joins
 * for it matched and its condition is TRUE. That is the gate's row set, because
 * WHERE and CASE WHEN both keep only TRUE. Bound [plotId, censusId].
 */
const SINGLE_PASS_SQL = `SELECT ${[
  `COUNT(*) AS \`${TOTAL_ACTIVE_COLUMN}\``,
  countWhenColumn(`(${EXPORTABLE_IN_MEASUREMENT_GRAPH})`, EXPORTABLE_COLUMN),
  ...MEASUREMENT_GRAPH_ROW_CHECKS.map(check => countWhenColumn(`(${measurementLinksMatched(check.links)}) AND (${check.condition})`, check.kind)),
  ...EXPORT_SKIP_REASON_KINDS.map(kind =>
    countWhenColumn(`(${skipReasonCondition(kind)}) AND (${EXPORTABLE_IN_MEASUREMENT_GRAPH}) IS NOT TRUE`, skipReasonColumn(kind))
  )
].join(',\n            ')}
       ${MEASUREMENT_SCOPE_FROM}
       ${joinMeasurementLinks(ALL_MEASUREMENT_LINK_ALIASES, 'LEFT JOIN')}
      WHERE ${MEASUREMENT_SCOPE_WHERE}`;

async function countRelatedRowsCheck(conn: Connection, input: PreconditionInput, check: RelatedRowsRowCheck): Promise<number> {
  const [rows] = await conn.query<RowDataPacket[]>(
    safeFormatQuery(input.schema, `SELECT COUNT(DISTINCT cm.CoreMeasurementID) AS n ${rowCheckFromWhere(check)}`),
    [input.plotId, input.censusId]
  );
  return Number(rows[0].n);
}

/**
 * Uncapped counterpart of checkFinishedCensus for the census overview: the
 * single pass, then one COUNT(DISTINCT) per related-rows check the classifier
 * reports. `isBlocking` only decides what is reported; the pass counts every
 * measurement-graph kind either way.
 */
export async function countPublishPreconditions(
  conn: Connection,
  input: PreconditionInput,
  isBlocking: BlockingKindClassifier
): Promise<PublishPreconditionCounts> {
  const [passRows] = await conn.query<RowDataPacket[]>(safeFormatQuery(input.schema, SINGLE_PASS_SQL), [input.plotId, input.censusId]);
  const pass = passRows[0];

  const blockers: PublishBlockerCount[] = [];
  for (const check of PRECONDITION_ROW_CHECKS) {
    const { kind } = check;
    if (!isBlocking(kind)) continue;
    const flaggedMeasurements = check.joinShape === 'measurement-graph' ? Number(pass[kind]) : await countRelatedRowsCheck(conn, input, check);
    if (flaggedMeasurements > 0) blockers.push({ kind, count: flaggedMeasurements });
  }

  const count = Number(pass[EXPORTABLE_COLUMN]);
  const totalActiveCount = Number(pass[TOTAL_ACTIVE_COLUMN]);
  const shortfallKind = exportableShortfallKind(count, totalActiveCount);
  if (shortfallKind !== null && isBlocking(shortfallKind)) blockers.push({ kind: shortfallKind, count: null });

  const skipReasons = EXPORT_SKIP_REASON_KINDS.map(kind => ({ kind, count: Number(pass[skipReasonColumn(kind)]) }));
  return { blockers, count, totalActiveCount, skipReasons };
}

/** Exported rows that still carry an unresolved measurement_error_log row (check 2's predicate). */
export async function countExportedRowsWithUnresolvedErrors(conn: Connection, input: PreconditionInput): Promise<number> {
  const sql = safeFormatQuery(
    input.schema,
    `SELECT COUNT(DISTINCT mel.MeasurementID) AS n
       FROM ??.measurement_error_log mel
      WHERE ${UNRESOLVED_ERROR_LOG_CONDITION}
        AND mel.MeasurementID IN (${exportableMeasurementIdSelect()})`
  );
  const [rows] = await conn.query<RowDataPacket[]>(sql, [input.censusId, input.plotId]);
  return Number(rows[0].n);
}
