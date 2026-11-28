import type ConnectionManager from '@/lib/db/connectionmanager';
import { safeFormatQuery } from '@/lib/db/sqlsecurity';
import { toTxExecutor } from '@/config/utils';
import { ChangelogOperation, recordMutation, type ChangelogRowState } from '@/lib/changelog/record-mutation';
import type { MeasurementScopeInput } from '@/config/editplan/scopeguard';

export const COREMEASUREMENTS_TABLE_NAME = 'coremeasurements';
/** Every `??` in a fragment becomes the escaped schema in safeFormatQuery, so shared SQL builders can take it as their schema. */
export const SCHEMA_PLACEHOLDER = '??';
export const MEASUREMENT_ALIAS = 'cm';
/** RecordID of a census-wide summary row; ingestion-audit names whole-census coremeasurements changes the same way. */
const CENSUS_SUMMARY_RECORD_ID_PREFIX = 'census:';
/** Every statement joins `??.census c ON c.CensusID = cm.CensusID` and filters with this; binds censusID then plotID. */
export const CENSUS_OF_PLOT_PREDICATE_SQL = 'c.CensusID = ? AND c.PlotID = ?';

export interface IsValidatedCounts {
  passed: number;
  failed: number;
  pending: number;
}

export interface CensusValidationChange {
  summaryKind: string;
  before: ChangelogRowState;
  after: ChangelogRowState;
}

export function censusScopeParams(scope: MeasurementScopeInput): number[] {
  return [scope.censusID, scope.plotID];
}

export function readAffectedRows(result: unknown, statementDescription: string): number {
  const affectedRows =
    result !== null && typeof result === 'object' && 'affectedRows' in result ? Number((result as { affectedRows: unknown }).affectedRows) : Number.NaN;
  if (!Number.isSafeInteger(affectedRows) || affectedRows < 0)
    throw new Error(`${statementDescription} returned no affected-row count: ${JSON.stringify(result)}`);
  return affectedRows;
}

/** Counts the census's rows by IsValidated, narrowed by `extraPredicateSql` (which may use `??` and the `cm` alias). */
export async function readIsValidatedCounts(
  cm: ConnectionManager,
  scope: MeasurementScopeInput,
  extraPredicateSql: string | null,
  transactionID: string
): Promise<IsValidatedCounts> {
  const rows = await cm.executeQuery(
    safeFormatQuery(
      scope.schema,
      `SELECT COALESCE(SUM(cm.IsValidated = TRUE), 0) AS PassedCount,
              COALESCE(SUM(cm.IsValidated = FALSE), 0) AS FailedCount,
              COALESCE(SUM(cm.IsValidated IS NULL), 0) AS PendingCount
         FROM ??.coremeasurements cm
         JOIN ??.census c ON c.CensusID = cm.CensusID
        WHERE ${CENSUS_OF_PLOT_PREDICATE_SQL}${extraPredicateSql ? `\n          AND ${extraPredicateSql}` : ''}`
    ),
    censusScopeParams(scope),
    transactionID
  );
  if (!Array.isArray(rows) || rows.length === 0) throw new Error(`IsValidated count returned no row for census ${scope.censusID}`);
  return { passed: Number(rows[0].PassedCount), failed: Number(rows[0].FailedCount), pending: Number(rows[0].PendingCount) };
}

export function totalMeasurements(counts: IsValidatedCounts): number {
  return counts.passed + counts.failed + counts.pending;
}

/**
 * One Recent Changes row for the whole census, attributed to the signed-in user, in the caller's transaction so it
 * commits or rolls back with the change. A per-row audit would write one row per measurement for a census-wide action.
 */
export async function recordCensusValidationChange(
  cm: ConnectionManager,
  scope: MeasurementScopeInput,
  changedBy: string,
  change: CensusValidationChange,
  transactionID: string
): Promise<void> {
  await recordMutation({
    tx: toTxExecutor(cm, transactionID),
    schema: scope.schema,
    tableName: COREMEASUREMENTS_TABLE_NAME,
    recordID: `${CENSUS_SUMMARY_RECORD_ID_PREFIX}${scope.censusID}`,
    operation: ChangelogOperation.UPDATE,
    oldRowState: { summaryKind: change.summaryKind, ...change.before },
    newRowState: { summaryKind: change.summaryKind, ...change.after },
    changedBy,
    plotID: scope.plotID,
    censusID: scope.censusID
  });
}
