/**
 * Export preview counts for the census overview (#547): why active measurements
 * would be skipped by a publish, and how many exported rows still carry an
 * unresolved error. Every count is defined against exportableMeasurementIdSelect,
 * the same set selectMeasurements ships, so the preview cannot disagree with the
 * artifact. Callers run these inside their snapshot transaction.
 */
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { safeFormatQuery } from '@/lib/db/sqlsecurity';
import { EXPORT_SKIP_REASON_KINDS, type ExportSkipReasonCount, type ExportSkipReasonKind } from '@/config/censusoverview';
import { exportableMeasurementIdSelect } from './exportable-measurement';
import { UNRESOLVED_ERROR_LOG_CONDITION, type PreconditionInput } from './precondition';

// One condition per clause of the export predicate. Each is written so it never
// evaluates to NULL (LEFT JOIN misses are coalesced or tested with IS NULL), which
// keeps the `other` bucket exact. DeletedAt is ignored because the export ignores it.
const SKIP_REASON_CONDITIONS: Record<Exclude<ExportSkipReasonKind, 'other'>, string> = {
  'not-validated': '(cm.IsValidated IS NULL OR cm.IsValidated = FALSE)',
  'no-stem-guid': '(cm.StemGUID IS NULL)',
  'inactive-stem-or-tree': '(COALESCE(s.IsActive, 1) <> 1 OR COALESCE(t.IsActive, 1) <> 1)',
  'missing-link':
    '(cm.StemGUID IS NOT NULL AND (s.StemGUID IS NULL OR t.TreeID IS NULL OR q.QuadratID IS NULL OR sp.SpeciesID IS NULL OR gn.GenusID IS NULL OR fam.FamilyID IS NULL))'
};

function skipReasonCondition(kind: ExportSkipReasonKind): string {
  if (kind === 'other') return `NOT (${Object.values(SKIP_REASON_CONDITIONS).join(' OR ')})`;
  return SKIP_REASON_CONDITIONS[kind];
}

/**
 * Counts, over the census's skipped rows only (active rows NOT IN the exportable
 * set), how many match each skip reason. Reasons can overlap; `other` should stay
 * 0 and exists so a future export clause cannot leave skipped rows unexplained.
 */
export async function countExportSkipReasons(conn: Connection, input: PreconditionInput): Promise<ExportSkipReasonCount[]> {
  const reasonColumns = EXPORT_SKIP_REASON_KINDS.map(kind => `COALESCE(SUM(${skipReasonCondition(kind)}), 0) AS \`${kind}\``).join(',\n            ');
  const sql = safeFormatQuery(
    input.schema,
    `SELECT ${reasonColumns}
       FROM ??.coremeasurements cm
       JOIN ??.census c ON c.CensusID = cm.CensusID
       LEFT JOIN ??.stems    s   ON s.StemGUID   = cm.StemGUID
       LEFT JOIN ??.trees    t   ON t.TreeID     = s.TreeID
       LEFT JOIN ??.quadrats q   ON q.QuadratID  = s.QuadratID
       LEFT JOIN ??.species  sp  ON sp.SpeciesID = t.SpeciesID
       LEFT JOIN ??.genus    gn  ON gn.GenusID   = sp.GenusID
       LEFT JOIN ??.family   fam ON fam.FamilyID = gn.FamilyID
      WHERE c.PlotID = ? AND cm.CensusID = ? AND cm.IsActive = 1
        AND cm.CoreMeasurementID NOT IN (${exportableMeasurementIdSelect()})`
  );
  // Outer [plotId, censusId], then the subquery's [censusId, plotId].
  const [rows] = await conn.query<RowDataPacket[]>(sql, [input.plotId, input.censusId, input.censusId, input.plotId]);
  return EXPORT_SKIP_REASON_KINDS.map(kind => ({ kind, count: Number(rows[0][kind]) }));
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
