/**
 * Recent Changes audit for the census clear procedures (app/api/clearcensus, #507).
 *
 * clearcensusmsmts and clearcensusfull delete a census and its measurements, and
 * clearcensusfull also empties every reference table when it removes the schema's last
 * census. The route runs the procedure in caller-owned mode so that these audit rows and
 * the deletes they describe commit or roll back together.
 *
 * The application runs at READ COMMITTED, where a locking read takes no gap locks: rows
 * can still be inserted into the census or a reference table after they were audited and
 * before the procedure deletes them. In caller-owned mode the procedures report how many
 * rows each delete removed, and the clear refuses to commit unless every one was audited.
 */
import { safeEscapeId, safeFormatQuery } from '@/lib/db/sqlsecurity';
import { callProcedureInCallerTransaction, type CallerOwnedTransactionFlag, type CallerTransactionExecutor } from '@/lib/db/caller-owned-procedure-call';
import {
  ChangelogOperation,
  ChangelogWriteError,
  normalizeBitColumns,
  recordDeletedRows,
  recordMutation,
  type ChangelogRowState
} from '@/lib/changelog/record-mutation';
import { recordDeletedCensusCoreMeasurementsAudit } from '@/lib/changelog/ingestion-audit';

export const CLEAR_CENSUS_CALLER_OWNS_TRANSACTION_SQL = 'SET @clearcensus_caller_owns_transaction = 1';
export const CLEAR_CENSUS_CLEAR_CALLER_TRANSACTION_SQL = 'SET @clearcensus_caller_owns_transaction = NULL';
export const CLEAR_CENSUS_FLAG_CLEAR_FAILED_REASON = 'Failed to clear the census-clear caller transaction flag';

const CLEAR_CENSUS_CALLER_FLAG: CallerOwnedTransactionFlag = {
  setSQL: CLEAR_CENSUS_CALLER_OWNS_TRANSACTION_SQL,
  clearSQL: CLEAR_CENSUS_CLEAR_CALLER_TRANSACTION_SQL,
  clearFailedReason: CLEAR_CENSUS_FLAG_CLEAR_FAILED_REASON
};

/** The census clear types that have a stored procedure behind them. */
export const CLEAR_CENSUS_TYPES = ['msmts', 'full'] as const;
export type ClearCensusType = (typeof CLEAR_CENSUS_TYPES)[number];

const CLEAR_CENSUS_FULL_TYPE: ClearCensusType = 'full';
const CENSUS_TABLE_NAME = 'census';

interface ReferenceTableKey {
  tableName: string;
  /** Columns that identify one physical row; attributes is keyed on (Code, IsActive). */
  keyColumns: readonly string[];
  /** Column stored as RecordID — the grid's own id for the table (attributes: Code). */
  recordIDColumn: string;
  /** Column of the procedure's caller-owned result set holding this table's delete count. */
  deletedCountColumn: string;
}

/** The tables clearcensusfull empties on the last census, in its own delete order. */
export const CLEAR_CENSUS_FULL_REFERENCE_TABLES: readonly ReferenceTableKey[] = [
  { tableName: 'attributes', keyColumns: ['Code', 'IsActive'], recordIDColumn: 'Code', deletedCountColumn: 'DeletedAttributes' },
  { tableName: 'personnel', keyColumns: ['PersonnelID'], recordIDColumn: 'PersonnelID', deletedCountColumn: 'DeletedPersonnel' },
  { tableName: 'roles', keyColumns: ['RoleID'], recordIDColumn: 'RoleID', deletedCountColumn: 'DeletedRoles' },
  { tableName: 'quadrats', keyColumns: ['QuadratID'], recordIDColumn: 'QuadratID', deletedCountColumn: 'DeletedQuadrats' },
  { tableName: 'species', keyColumns: ['SpeciesID'], recordIDColumn: 'SpeciesID', deletedCountColumn: 'DeletedSpecies' },
  { tableName: 'specieslimits', keyColumns: ['SpeciesLimitID'], recordIDColumn: 'SpeciesLimitID', deletedCountColumn: 'DeletedSpecieslimits' },
  { tableName: 'genus', keyColumns: ['GenusID'], recordIDColumn: 'GenusID', deletedCountColumn: 'DeletedGenus' },
  { tableName: 'family', keyColumns: ['FamilyID'], recordIDColumn: 'FamilyID', deletedCountColumn: 'DeletedFamily' },
  { tableName: 'reference', keyColumns: ['ReferenceID'], recordIDColumn: 'ReferenceID', deletedCountColumn: 'DeletedReference' }
];

const DELETED_MEASUREMENTS_COLUMN = 'DeletedMeasurements';
const COREMEASUREMENTS_TABLE_NAME = 'coremeasurements';

type ReferenceTablesSnapshot = Map<string, ChangelogRowState[]>;
type ClearCensusDeletedCounts = Record<string, number>;

/** The rows a clear deleted and the rows it audited disagree; nothing has been committed. */
export class ClearCensusAuditMismatchError extends Error {
  readonly tableName: string;
  readonly deletedCount: number;
  readonly auditedCount: number;

  constructor(tableName: string, deletedCount: number, auditedCount: number) {
    super(`The census clear deleted ${deletedCount} ${tableName} row(s) but audited ${auditedCount}; rows changed while it ran, so nothing was committed.`);
    this.name = 'ClearCensusAuditMismatchError';
    this.tableName = tableName;
    this.deletedCount = deletedCount;
    this.auditedCount = auditedCount;
  }
}

export function isClearCensusType(value: string): value is ClearCensusType {
  return (CLEAR_CENSUS_TYPES as readonly string[]).includes(value);
}

function rowKey(row: ChangelogRowState, keyColumns: readonly string[]): string {
  return keyColumns.map(column => String(row[column])).join('\u0000');
}

function assertAuditedEveryDeletedRow(tableName: string, deletedCount: number, auditedCount: number): void {
  if (deletedCount !== auditedCount) throw new ClearCensusAuditMismatchError(tableName, deletedCount, auditedCount);
}

async function countRows(tx: CallerTransactionExecutor, sql: string, params: unknown[]): Promise<number> {
  const rows = await tx.query<Array<{ total: number | string }>>(sql, params);
  return Number(rows[0]?.total ?? 0);
}

/** A CALL returns `[resultSetRows, okPacket]`; the caller-owned clears end with one row of delete counts. */
function readDeletedCounts(procedureResult: unknown): ClearCensusDeletedCounts {
  const resultSet = Array.isArray(procedureResult) && Array.isArray(procedureResult[0]) ? procedureResult[0] : undefined;
  const countsRow = resultSet?.[0] as Record<string, unknown> | undefined;
  if (!countsRow || !(DELETED_MEASUREMENTS_COLUMN in countsRow)) {
    throw new Error('The census clear procedure reported no delete counts; it may predate caller-owned mode, so the clear was not committed.');
  }
  return Object.fromEntries(Object.entries(countsRow).map(([column, value]) => [column, Number(value)]));
}

async function callClearCensusInCallerTransaction(
  tx: CallerTransactionExecutor,
  schema: string,
  type: ClearCensusType,
  censusID: number
): Promise<ClearCensusDeletedCounts> {
  const procedureName = `clearcensus${type}`;
  const result = await callProcedureInCallerTransaction(tx, CLEAR_CENSUS_CALLER_FLAG, safeFormatQuery(schema, `CALL ??.${safeEscapeId(procedureName)}(?)`), [
    censusID
  ]);
  return readDeletedCounts(result);
}

/**
 * Locks the census row and every one of its measurements, then audits them. Under READ
 * COMMITTED the INSERT ... SELECT is a non-locking read, so the rows are locked first:
 * no edit can then change a measurement between its audit and its delete.
 */
async function auditCensusAndMeasurements(params: {
  tx: CallerTransactionExecutor;
  schema: string;
  censusID: number;
  plotID: number;
  changedBy: string;
}): Promise<number> {
  const { tx, schema, censusID, plotID, changedBy } = params;
  const censusRows = await tx.query<ChangelogRowState[]>(safeFormatQuery(schema, 'SELECT * FROM ??.census WHERE CensusID = ? FOR UPDATE'), [censusID]);
  const censusRow = censusRows[0];
  if (!censusRow) {
    throw new ChangelogWriteError(
      ChangelogOperation.DELETE,
      CENSUS_TABLE_NAME,
      censusID,
      new Error('The census row vanished before its delete could be audited.')
    );
  }

  const lockedMeasurements = await countRows(tx, safeFormatQuery(schema, 'SELECT COUNT(*) AS total FROM ??.coremeasurements WHERE CensusID = ? FOR UPDATE'), [
    censusID
  ]);
  const auditedMeasurements = await recordDeletedCensusCoreMeasurementsAudit({ tx, schema, censusID, changedBy, plotID });
  assertAuditedEveryDeletedRow(COREMEASUREMENTS_TABLE_NAME, lockedMeasurements, auditedMeasurements);

  await recordMutation({
    tx,
    schema,
    tableName: CENSUS_TABLE_NAME,
    recordID: censusID,
    operation: ChangelogOperation.DELETE,
    oldRowState: normalizeBitColumns(censusRow),
    changedBy,
    plotID,
    censusID
  });
  return auditedMeasurements;
}

/**
 * clearcensusfull empties the reference tables only when it removes the schema's last
 * census, so they are read (and locked) only then. If another census appears or vanishes
 * concurrently, the delete counts the procedure reports expose it.
 */
async function snapshotReferenceTablesForLastCensus(tx: CallerTransactionExecutor, schema: string): Promise<ReferenceTablesSnapshot> {
  const snapshot: ReferenceTablesSnapshot = new Map();
  if ((await countRows(tx, safeFormatQuery(schema, 'SELECT COUNT(*) AS total FROM ??.census'), [])) !== 1) return snapshot;
  for (const table of CLEAR_CENSUS_FULL_REFERENCE_TABLES) {
    const rows = await tx.query<ChangelogRowState[]>(safeFormatQuery(schema, `SELECT * FROM ??.${safeEscapeId(table.tableName)} FOR UPDATE`));
    snapshot.set(table.tableName, (Array.isArray(rows) ? rows : []).map(normalizeBitColumns));
  }
  return snapshot;
}

/**
 * Audits, as DELETE rows, every snapshot row whose key is gone after the CALL, and checks
 * each table's count against what the procedure deleted. Reference data is schema-wide,
 * so PlotID and CensusID stay NULL, as on every other reference writer.
 */
async function auditRemovedReferenceRows(params: {
  tx: CallerTransactionExecutor;
  schema: string;
  before: ReferenceTablesSnapshot;
  deletedCounts: ClearCensusDeletedCounts;
  changedBy: string;
}): Promise<void> {
  const { tx, schema, before, deletedCounts, changedBy } = params;
  for (const table of CLEAR_CENSUS_FULL_REFERENCE_TABLES) {
    const priorRows = before.get(table.tableName) ?? [];
    let audited = 0;
    if (priorRows.length > 0) {
      const keyList = table.keyColumns.map(column => safeEscapeId(column)).join(', ');
      const remainingRows = await tx.query<ChangelogRowState[]>(safeFormatQuery(schema, `SELECT ${keyList} FROM ??.${safeEscapeId(table.tableName)}`));
      const remainingKeys = new Set((Array.isArray(remainingRows) ? remainingRows : []).map(row => rowKey(row, table.keyColumns)));
      const removedRows = priorRows
        .filter(row => !remainingKeys.has(rowKey(row, table.keyColumns)))
        .map(row => ({ recordID: String(row[table.recordIDColumn]), oldRowState: row }));
      if (removedRows.length > 0) {
        audited = await recordDeletedRows({ tx, schema, tableName: table.tableName, rows: removedRows, changedBy, plotID: null, censusID: null });
      }
    }
    assertAuditedEveryDeletedRow(table.tableName, deletedCounts[table.deletedCountColumn] ?? 0, audited);
  }
}

/**
 * Clears one census through its procedure in the caller's transaction and writes a
 * Recent Changes DELETE row for the census, each of its measurements and, on a
 * last-census `full` clear, each reference row removed. Throws
 * ClearCensusAuditMismatchError when any deleted row went unaudited; the caller must then
 * roll back.
 */
export async function clearCensusWithAudit(params: {
  tx: CallerTransactionExecutor;
  schema: string;
  type: ClearCensusType;
  censusID: number;
  plotID: number;
  changedBy: string;
}): Promise<void> {
  const { tx, schema, type, censusID, plotID, changedBy } = params;
  const auditedMeasurements = await auditCensusAndMeasurements({ tx, schema, censusID, plotID, changedBy });
  const referenceSnapshot: ReferenceTablesSnapshot = type === CLEAR_CENSUS_FULL_TYPE ? await snapshotReferenceTablesForLastCensus(tx, schema) : new Map();

  const deletedCounts = await callClearCensusInCallerTransaction(tx, schema, type, censusID);
  assertAuditedEveryDeletedRow(COREMEASUREMENTS_TABLE_NAME, deletedCounts[DELETED_MEASUREMENTS_COLUMN], auditedMeasurements);
  if (type === CLEAR_CENSUS_FULL_TYPE) {
    await auditRemovedReferenceRows({ tx, schema, before: referenceSnapshot, deletedCounts, changedBy });
  }
}
