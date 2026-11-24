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
import { ChangelogOperation, normalizeBitColumns, recordMutation, type ChangelogRowState } from '@/lib/changelog/record-mutation';
import { COREMEASUREMENTS_TABLE_NAME, recordDeletedCensusCoreMeasurementsAudit, recordSnapshotRowsAudit } from '@/lib/changelog/ingestion-audit';

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

interface ReferenceTable {
  tableName: string;
  /** Stored as RecordID: the grid's own id for the table (attributes: Code). */
  recordIDColumn: string;
  deletedCountColumn: string;
}

/** The tables clearcensusfull empties on the last census, in its own delete order. */
export const CLEAR_CENSUS_FULL_REFERENCE_TABLES: readonly ReferenceTable[] = [
  { tableName: 'attributes', recordIDColumn: 'Code', deletedCountColumn: 'DeletedAttributes' },
  { tableName: 'personnel', recordIDColumn: 'PersonnelID', deletedCountColumn: 'DeletedPersonnel' },
  { tableName: 'roles', recordIDColumn: 'RoleID', deletedCountColumn: 'DeletedRoles' },
  { tableName: 'quadrats', recordIDColumn: 'QuadratID', deletedCountColumn: 'DeletedQuadrats' },
  { tableName: 'species', recordIDColumn: 'SpeciesID', deletedCountColumn: 'DeletedSpecies' },
  { tableName: 'specieslimits', recordIDColumn: 'SpeciesLimitID', deletedCountColumn: 'DeletedSpecieslimits' },
  { tableName: 'genus', recordIDColumn: 'GenusID', deletedCountColumn: 'DeletedGenus' },
  { tableName: 'family', recordIDColumn: 'FamilyID', deletedCountColumn: 'DeletedFamily' },
  { tableName: 'reference', recordIDColumn: 'ReferenceID', deletedCountColumn: 'DeletedReference' }
];

const DELETED_MEASUREMENTS_COLUMN = 'DeletedMeasurements';

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
 * Under READ COMMITTED the audit's INSERT ... SELECT is a non-locking read, so the
 * measurements are locked first: no edit can then change one between its audit and its
 * delete. The route has already locked the census row, so it is always found.
 */
async function auditCensusAndMeasurements(params: {
  tx: CallerTransactionExecutor;
  schema: string;
  censusID: number;
  plotID: number;
  changedBy: string;
}): Promise<number> {
  const { tx, schema, censusID, plotID, changedBy } = params;
  const [censusRow] = await tx.query<ChangelogRowState[]>(safeFormatQuery(schema, 'SELECT * FROM ??.census WHERE CensusID = ? FOR UPDATE'), [censusID]);

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

/** Read and locked only when clearing the schema's last census, the only time clearcensusfull empties them. */
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
 * The procedure deletes every row of each table unconditionally and the snapshot holds
 * them all locked, so the snapshot is exactly what it removed unless a row was inserted
 * concurrently, which the delete count exposes. Reference data is schema-wide, so PlotID
 * and CensusID stay NULL.
 */
async function auditRemovedReferenceRows(params: {
  tx: CallerTransactionExecutor;
  schema: string;
  removed: ReferenceTablesSnapshot;
  deletedCounts: ClearCensusDeletedCounts;
  changedBy: string;
}): Promise<void> {
  const { tx, schema, removed, deletedCounts, changedBy } = params;
  for (const table of CLEAR_CENSUS_FULL_REFERENCE_TABLES) {
    const rows = (removed.get(table.tableName) ?? []).map(row => ({ id: String(row[table.recordIDColumn]), oldRow: row, newRow: null }));
    const audited = await recordSnapshotRowsAudit({
      tx,
      schema,
      tableName: table.tableName,
      operation: ChangelogOperation.DELETE,
      rows,
      changedBy,
      plotID: null,
      censusID: null
    });
    assertAuditedEveryDeletedRow(table.tableName, deletedCounts[table.deletedCountColumn] ?? 0, audited);
  }
}

/** Throws ClearCensusAuditMismatchError when any deleted row went unaudited; the caller must then roll back. */
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
    await auditRemovedReferenceRows({ tx, schema, removed: referenceSnapshot, deletedCounts, changedBy });
  }
}
