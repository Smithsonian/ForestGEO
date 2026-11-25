/**
 * Recent Changes audit for the census clear procedures (app/api/clearcensus, #507).
 *
 * clearcensusmsmts and clearcensusfull delete a census and its measurements, and
 * clearcensusfull also empties every reference table when it removes the schema's last
 * census. The route runs the procedure in caller-owned mode, which reports how many rows
 * each delete removed, and records one summary row: the census's last state plus those
 * counts. The summary and the deletes commit or roll back together.
 */
import { safeEscapeId, safeFormatQuery } from '@/lib/db/sqlsecurity';
import { callProcedureInCallerTransaction, type CallerOwnedTransactionFlag, type CallerTransactionExecutor } from '@/lib/db/caller-owned-procedure-call';
import { ChangelogOperation, normalizeBitColumns, recordMutation, type ChangelogRowState } from '@/lib/changelog/record-mutation';
import { DELETION_SUMMARY_KIND, type DeletedRowCounts } from '@/lib/changelog/deletion-summary';

export const CLEAR_CENSUS_CALLER_OWNS_TRANSACTION_SQL = 'SET @clearcensus_caller_owns_transaction = 1';
export const CLEAR_CENSUS_CLEAR_CALLER_TRANSACTION_SQL = 'SET @clearcensus_caller_owns_transaction = NULL';
export const CLEAR_CENSUS_FLAG_CLEAR_FAILED_REASON = 'Failed to clear the census-clear caller transaction flag';

const CLEAR_CENSUS_CALLER_FLAG: CallerOwnedTransactionFlag = {
  setSQL: CLEAR_CENSUS_CALLER_OWNS_TRANSACTION_SQL,
  clearSQL: CLEAR_CENSUS_CLEAR_CALLER_TRANSACTION_SQL,
  clearFailedReason: CLEAR_CENSUS_FLAG_CLEAR_FAILED_REASON
};

export const CLEAR_CENSUS_TYPES = ['msmts', 'full'] as const;
export type ClearCensusType = (typeof CLEAR_CENSUS_TYPES)[number];

const CENSUS_TABLE_NAME = 'census';
const COREMEASUREMENTS_TABLE_NAME = 'coremeasurements';
const DELETED_MEASUREMENTS_COLUMN = 'DeletedMeasurements';

/** The result-set column each table's delete count arrives in, in clearcensusfull's delete order. */
const CLEAR_CENSUS_DELETED_COUNT_COLUMNS: Readonly<Record<string, string>> = {
  [COREMEASUREMENTS_TABLE_NAME]: DELETED_MEASUREMENTS_COLUMN,
  attributes: 'DeletedAttributes',
  personnel: 'DeletedPersonnel',
  roles: 'DeletedRoles',
  quadrats: 'DeletedQuadrats',
  species: 'DeletedSpecies',
  specieslimits: 'DeletedSpecieslimits',
  genus: 'DeletedGenus',
  family: 'DeletedFamily',
  reference: 'DeletedReference'
};

interface CensusDeleteSummaryState extends ChangelogRowState {
  summaryKind: typeof DELETION_SUMMARY_KIND.censusDelete;
  clearType: ClearCensusType;
  deletedRowCounts: DeletedRowCounts;
}

export function isClearCensusType(value: string): value is ClearCensusType {
  return (CLEAR_CENSUS_TYPES as readonly string[]).includes(value);
}

/** A CALL returns `[resultSetRows, okPacket]`; the caller-owned clears end with one row of delete counts. */
function readDeletedRowCounts(procedureResult: unknown): DeletedRowCounts {
  const resultSet = Array.isArray(procedureResult) && Array.isArray(procedureResult[0]) ? procedureResult[0] : undefined;
  const countsRow = resultSet?.[0] as Record<string, unknown> | undefined;
  if (!countsRow || !(DELETED_MEASUREMENTS_COLUMN in countsRow)) {
    throw new Error('The census clear procedure reported no delete counts; it may predate caller-owned mode, so the clear was not committed.');
  }
  return Object.fromEntries(
    Object.entries(CLEAR_CENSUS_DELETED_COUNT_COLUMNS)
      .filter(([, column]) => column in countsRow)
      .map(([tableName, column]) => [tableName, Number(countsRow[column])])
  );
}

async function callClearCensusInCallerTransaction(
  tx: CallerTransactionExecutor,
  schema: string,
  type: ClearCensusType,
  censusID: number
): Promise<DeletedRowCounts> {
  const procedureName = `clearcensus${type}`;
  const result = await callProcedureInCallerTransaction(tx, CLEAR_CENSUS_CALLER_FLAG, safeFormatQuery(schema, `CALL ??.${safeEscapeId(procedureName)}(?)`), [
    censusID
  ]);
  return readDeletedRowCounts(result);
}

/** Deletes the census through its procedure and records one summary row; the caller commits or rolls back both. */
export async function clearCensusWithAudit(params: {
  tx: CallerTransactionExecutor;
  schema: string;
  type: ClearCensusType;
  censusID: number;
  plotID: number;
  changedBy: string;
}): Promise<DeletedRowCounts> {
  const { tx, schema, type, censusID, plotID, changedBy } = params;
  const [censusRow] = await tx.query<ChangelogRowState[]>(safeFormatQuery(schema, 'SELECT * FROM ??.census WHERE CensusID = ? FOR UPDATE'), [censusID]);
  if (!censusRow) throw new Error(`Census ${censusID} was not found under lock; the caller must lock it before clearing.`);
  const deletedRowCounts = await callClearCensusInCallerTransaction(tx, schema, type, censusID);
  const summary: CensusDeleteSummaryState = {
    ...normalizeBitColumns(censusRow),
    summaryKind: DELETION_SUMMARY_KIND.censusDelete,
    clearType: type,
    deletedRowCounts
  };
  await recordMutation({
    tx,
    schema,
    tableName: CENSUS_TABLE_NAME,
    recordID: censusID,
    operation: ChangelogOperation.DELETE,
    oldRowState: summary,
    changedBy,
    plotID,
    censusID
  });
  return deletedRowCounts;
}
