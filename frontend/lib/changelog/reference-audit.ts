/**
 * Client-safe changelog auditing shared by the reference writers
 * (`lib/uploads/reference-data-writers.ts`) and the manual grid-edit
 * processors (`processSpecies`, `processPersonnel`), which are reachable from
 * client bundles and so must not import mysql2's runtime.
 */
import type ConnectionManager from '@/lib/db/connectionmanager';
import { safeFormatQuery, safeEscapeId } from '@/lib/db/sqlsecurity';
import { toTxExecutor, type UpsertOperation } from '@/config/utils';
import { recordMutation, ChangelogOperation, type ChangelogRowState } from '@/lib/changelog/record-mutation';

/**
 * Audits a `handleUpsert` result (family, genus, roles). An 'updated' result
 * records `oldRowState: null` -- handleUpsert overwrites before anything can
 * read the prior row. 'unchanged' is skipped: not a real mutation.
 */
export async function auditHandleUpsertResult(
  connectionManager: ConnectionManager,
  schema: string,
  transactionID: string,
  tableName: string,
  primaryKeyColumn: string,
  upsertResult: { id: number; operation: UpsertOperation },
  changedBy: string
): Promise<void> {
  if (upsertResult.operation === 'unchanged') return;

  const selectSQL = safeFormatQuery(schema, `SELECT * FROM ??.${safeEscapeId(tableName)} WHERE ${safeEscapeId(primaryKeyColumn)} = ?`);
  const rows = await connectionManager.executeQuery(selectSQL, [upsertResult.id], transactionID);
  const persistedRow: ChangelogRowState | undefined = rows[0];
  if (!persistedRow) {
    throw new Error(`Audit failed: ${tableName} row ${upsertResult.id} vanished immediately after its own upsert.`);
  }

  const tx = toTxExecutor(connectionManager, transactionID);
  if (upsertResult.operation === 'inserted') {
    await recordMutation({
      tx,
      schema,
      tableName,
      recordID: upsertResult.id,
      operation: ChangelogOperation.INSERT,
      newRowState: persistedRow,
      changedBy,
      plotID: null,
      censusID: null
    });
    return;
  }

  await recordMutation({
    tx,
    schema,
    tableName,
    recordID: upsertResult.id,
    operation: ChangelogOperation.UPDATE,
    oldRowState: null,
    newRowState: persistedRow,
    changedBy,
    plotID: null,
    censusID: null
  });
}

/**
 * Links a person to a census's active roster and audits only a real
 * mutation: `INSERT IGNORE` reports `affectedRows: 0` for an existing link.
 * Only caller: `upsertPersonnelRows` (lib/uploads/reference-data-writers.ts).
 */
export async function auditCensusActivePersonnelLink(
  connectionManager: ConnectionManager,
  schema: string,
  transactionID: string,
  censusID: number,
  personnelID: number,
  changedBy: string
): Promise<void> {
  const capSQL = safeFormatQuery(schema, `INSERT IGNORE INTO ??.censusactivepersonnel (CensusID, PersonnelID) VALUES (?, ?)`);
  const result = await connectionManager.executeQuery(capSQL, [censusID, personnelID], transactionID);
  if (!result?.affectedRows) return; // link already existed — not a mutation

  const capID = Number(result.insertId);
  if (!capID) {
    throw new Error(
      `auditCensusActivePersonnelLink: INSERT IGNORE reported affectedRows=${result.affectedRows} for CensusID=${censusID}, PersonnelID=${personnelID} but returned no insertId; cannot audit a link whose own id is unknown.`
    );
  }

  const tx = toTxExecutor(connectionManager, transactionID);
  await recordMutation({
    tx,
    schema,
    tableName: 'censusactivepersonnel',
    recordID: capID,
    operation: ChangelogOperation.INSERT,
    newRowState: { CAPID: capID, CensusID: censusID, PersonnelID: personnelID },
    changedBy,
    plotID: null,
    censusID
  });
}
