/**
 * Recent Changes audit for the census clear procedures (app/api/clearcensus, #507).
 *
 * clearcensusmsmts and clearcensusfull delete a census and its measurements, and
 * clearcensusfull also empties every reference table when it removes the schema's last
 * census. The route runs the procedure in caller-owned mode, which reports how many rows
 * each delete removed, and records one summary row: the census's last state plus those
 * counts. The summary and the deletes commit or roll back together.
 *
 * Both procedures delete child rows before their parents with foreign_key_checks off: a
 * measurement's attributes and error links before the measurement, and, for clearcensusfull on
 * the last census, species before genus and the other fixed-data tables in turn. Every parent
 * the procedure will delete is locked first, so a concurrent insert that references one (an
 * attribute on an existing measurement, a species naming an existing genus) waits and is then
 * refused, instead of landing between two deletes and outliving its parent. READ COMMITTED takes
 * no gap locks, so a brand-new parent can still be inserted; the procedure then deletes more rows
 * than were locked, and the clear is refused.
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

const CLEAR_CENSUS_FULL_TYPE: ClearCensusType = 'full';
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

const FIXED_DATA_TABLES = Object.keys(CLEAR_CENSUS_DELETED_COUNT_COLUMNS).filter(tableName => tableName !== COREMEASUREMENTS_TABLE_NAME);

/** The procedure deleted rows the clear had not locked; nothing has been committed. */
export class ClearCensusConcurrentChangeError extends Error {
  readonly tableName: string;
  readonly lockedCount: number;
  readonly deletedCount: number;

  constructor(tableName: string, lockedCount: number, deletedCount: number) {
    super(`The census clear deleted ${deletedCount} ${tableName} row(s) but had locked ${lockedCount}; rows changed while it ran, so nothing was committed.`);
    this.name = 'ClearCensusConcurrentChangeError';
    this.tableName = tableName;
    this.lockedCount = lockedCount;
    this.deletedCount = deletedCount;
  }
}

interface CensusDeleteSummaryState extends ChangelogRowState {
  summaryKind: typeof DELETION_SUMMARY_KIND.censusDelete;
  clearType: ClearCensusType;
  deletedRowCounts: DeletedRowCounts;
}

export function isClearCensusType(value: string): value is ClearCensusType {
  return (CLEAR_CENSUS_TYPES as readonly string[]).includes(value);
}

async function countRows(tx: CallerTransactionExecutor, sql: string, params: unknown[] = []): Promise<number> {
  const rows = await tx.query<Array<{ total: number | string }>>(sql, params);
  return Number(rows[0]?.total ?? 0);
}

/**
 * Locks the parents the procedure will delete and returns how many of each it holds: the census's measurements, and,
 * for a full clear, every fixed-data row when this is the schema's last census (the only time clearcensusfull empties
 * them; zero counts otherwise).
 */
async function lockRowsTheClearDeletes(tx: CallerTransactionExecutor, schema: string, type: ClearCensusType, censusID: number): Promise<DeletedRowCounts> {
  const locked: DeletedRowCounts = {
    [COREMEASUREMENTS_TABLE_NAME]: await countRows(
      tx,
      safeFormatQuery(schema, 'SELECT COUNT(*) AS total FROM ??.coremeasurements WHERE CensusID = ? FOR UPDATE'),
      [censusID]
    )
  };
  if (type !== CLEAR_CENSUS_FULL_TYPE) return locked;
  const isLastCensus = (await countRows(tx, safeFormatQuery(schema, 'SELECT COUNT(*) AS total FROM ??.census'))) === 1;
  for (const tableName of FIXED_DATA_TABLES) {
    locked[tableName] = isLastCensus
      ? await countRows(tx, safeFormatQuery(schema, `SELECT COUNT(*) AS total FROM ??.${safeEscapeId(tableName)} FOR UPDATE`))
      : 0;
  }
  return locked;
}

function assertDeletedOnlyLockedRows(locked: DeletedRowCounts, deleted: DeletedRowCounts): void {
  for (const [tableName, lockedCount] of Object.entries(locked)) {
    const deletedCount = deleted[tableName] ?? 0;
    if (deletedCount !== lockedCount) throw new ClearCensusConcurrentChangeError(tableName, lockedCount, deletedCount);
  }
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

/**
 * Deletes the census through its procedure and records one summary row; the caller commits or rolls back both.
 * Throws ClearCensusConcurrentChangeError when the procedure removed rows the clear had not locked.
 */
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
  const lockedRows = await lockRowsTheClearDeletes(tx, schema, type, censusID);
  const deletedRowCounts = await callClearCensusInCallerTransaction(tx, schema, type, censusID);
  assertDeletedOnlyLockedRows(lockedRows, deletedRowCounts);
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
