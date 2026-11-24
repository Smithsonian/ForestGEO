/**
 * Recent Changes audit for the census clear procedures (app/api/clearcensus, #507).
 *
 * clearcensusmsmts and clearcensusfull delete a census and its measurements, and
 * clearcensusfull also empties every reference table when it removes the schema's last
 * census. The route runs the procedure in caller-owned mode so that these audit rows and
 * the deletes they describe commit or roll back together.
 */
import { safeEscapeId, safeFormatQuery } from '@/lib/db/sqlsecurity';
import { callProcedureInCallerTransaction, type CallerOwnedTransactionFlag, type CallerTransactionExecutor } from '@/lib/db/caller-owned-procedure-call';
import { ChangelogOperation, ChangelogWriteError, recordDeletedRows, recordMutation, type ChangelogRowState } from '@/lib/changelog/record-mutation';
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

export const CLEAR_CENSUS_FULL_TYPE: ClearCensusType = 'full';
const CENSUS_TABLE_NAME = 'census';

interface ReferenceTableKey {
  tableName: string;
  /** Columns that identify one physical row; attributes is keyed on (Code, IsActive). */
  keyColumns: readonly string[];
  /** Column stored as RecordID — the grid's own id for the table (attributes: Code). */
  recordIDColumn: string;
}

/** The tables clearcensusfull empties on the last census, in its own delete order. */
export const CLEAR_CENSUS_FULL_REFERENCE_TABLES: readonly ReferenceTableKey[] = [
  { tableName: 'attributes', keyColumns: ['Code', 'IsActive'], recordIDColumn: 'Code' },
  { tableName: 'personnel', keyColumns: ['PersonnelID'], recordIDColumn: 'PersonnelID' },
  { tableName: 'roles', keyColumns: ['RoleID'], recordIDColumn: 'RoleID' },
  { tableName: 'quadrats', keyColumns: ['QuadratID'], recordIDColumn: 'QuadratID' },
  { tableName: 'species', keyColumns: ['SpeciesID'], recordIDColumn: 'SpeciesID' },
  { tableName: 'specieslimits', keyColumns: ['SpeciesLimitID'], recordIDColumn: 'SpeciesLimitID' },
  { tableName: 'genus', keyColumns: ['GenusID'], recordIDColumn: 'GenusID' },
  { tableName: 'family', keyColumns: ['FamilyID'], recordIDColumn: 'FamilyID' },
  { tableName: 'reference', keyColumns: ['ReferenceID'], recordIDColumn: 'ReferenceID' }
];

export type ReferenceTablesSnapshot = Map<string, ChangelogRowState[]>;

export function isClearCensusType(value: string): value is ClearCensusType {
  return (CLEAR_CENSUS_TYPES as readonly string[]).includes(value);
}

function rowKey(row: ChangelogRowState, keyColumns: readonly string[]): string {
  return keyColumns.map(column => String(row[column])).join('\u0000');
}

export async function callClearCensusInCallerTransaction(
  tx: CallerTransactionExecutor,
  schema: string,
  type: ClearCensusType,
  censusID: number
): Promise<void> {
  const procedureName = `clearcensus${type}`;
  await callProcedureInCallerTransaction(tx, CLEAR_CENSUS_CALLER_FLAG, safeFormatQuery(schema, `CALL ??.${safeEscapeId(procedureName)}(?)`), [censusID]);
}

/**
 * Writes the audit rows for everything the CALL will delete from `census` and
 * `coremeasurements`. Runs BEFORE the CALL, in its transaction, so each OldRowState is
 * the row's last real state. Returns the number of measurement rows audited.
 */
export async function recordCensusClearAudit(params: {
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

  const auditedMeasurements = await recordDeletedCensusCoreMeasurementsAudit({ tx, schema, censusID, changedBy, plotID });
  await recordMutation({
    tx,
    schema,
    tableName: CENSUS_TABLE_NAME,
    recordID: censusID,
    operation: ChangelogOperation.DELETE,
    oldRowState: censusRow,
    changedBy,
    plotID,
    censusID
  });
  return auditedMeasurements;
}

/** Full row images of every reference table clearcensusfull may empty, read before the CALL. */
export async function snapshotReferenceTables(tx: CallerTransactionExecutor, schema: string): Promise<ReferenceTablesSnapshot> {
  const snapshot: ReferenceTablesSnapshot = new Map();
  for (const table of CLEAR_CENSUS_FULL_REFERENCE_TABLES) {
    const rows = await tx.query<ChangelogRowState[]>(safeFormatQuery(schema, `SELECT * FROM ??.${safeEscapeId(table.tableName)} FOR UPDATE`));
    snapshot.set(table.tableName, Array.isArray(rows) ? rows : []);
  }
  return snapshot;
}

/**
 * Audits, as DELETE rows, every snapshot row whose key is gone after the CALL. Reference
 * data is schema-wide, so PlotID and CensusID stay NULL, as on every other reference
 * writer. Returns the number of rows audited.
 */
export async function auditRemovedReferenceRows(params: {
  tx: CallerTransactionExecutor;
  schema: string;
  before: ReferenceTablesSnapshot;
  changedBy: string;
}): Promise<number> {
  const { tx, schema, before, changedBy } = params;
  let audited = 0;
  for (const table of CLEAR_CENSUS_FULL_REFERENCE_TABLES) {
    const priorRows = before.get(table.tableName) ?? [];
    if (priorRows.length === 0) continue;

    const keyList = table.keyColumns.map(column => safeEscapeId(column)).join(', ');
    const remainingRows = await tx.query<ChangelogRowState[]>(safeFormatQuery(schema, `SELECT ${keyList} FROM ??.${safeEscapeId(table.tableName)}`));
    const remainingKeys = new Set((Array.isArray(remainingRows) ? remainingRows : []).map(row => rowKey(row, table.keyColumns)));
    const removedRows = priorRows
      .filter(row => !remainingKeys.has(rowKey(row, table.keyColumns)))
      .map(row => ({ recordID: String(row[table.recordIDColumn]), oldRowState: row }));
    if (removedRows.length === 0) continue;

    const written = await recordDeletedRows({ tx, schema, tableName: table.tableName, rows: removedRows, changedBy, plotID: null, censusID: null });
    if (written !== removedRows.length) {
      throw new ChangelogWriteError(
        ChangelogOperation.DELETE,
        table.tableName,
        removedRows.map(row => row.recordID).join(','),
        new Error(`Expected to audit ${removedRows.length} removed row(s) but audited ${written} — the audit trail and the data would disagree.`)
      );
    }
    audited += written;
  }
  return audited;
}
