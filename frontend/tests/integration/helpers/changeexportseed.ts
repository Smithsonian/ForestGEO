/**
 * Seeds `unifiedchangelog` for the change-log export tests (#592) through the production audit
 * writers, and pins each seeded change to a known time so row order can be asserted exactly.
 * `insertRawChange` is for shapes no current writer produces; a JSON column takes valid JSON only.
 */
import type { Connection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { expect } from 'vitest';
import { recordCommittedCoreMeasurementsAudit } from '@/lib/changelog/ingestion-audit';
import { ChangelogOperation, recordMutation } from '@/lib/changelog/record-mutation';

export const SEED_CHANGED_BY = 'export-seed@forestgeo.test';
const SEED_TRANSACTION_ID = 'change-export-seed';
const SEED_MEASUREMENT_DATE = '2026-03-01';
const SEED_MEASURED_HOM = 1.3;
const SEED_STEM_TAG = '1';

export interface ChangeExportSeedScope {
  connection: Connection;
  schema: string;
  plotID: number;
  censusID: number;
}

export interface RawChangeSeed {
  tableName: string;
  recordID: string;
  operation: ChangelogOperation;
  oldRowState?: unknown;
  newRowState?: unknown;
  changeTime: string | null;
  /** Defaults to the seed scope's plot; pass null for a change with no plot. */
  plotID?: number | null;
}

export interface GridChangeSeed {
  tableName: string;
  recordID: number;
  operation: ChangelogOperation;
  oldRowState?: Record<string, unknown> | null;
  newRowState?: Record<string, unknown>;
  /** null records a change with no plot scope. */
  plotID: number | null;
  changeTime: string;
}

export function createChangeExportSeeder({ connection, schema, plotID, censusID }: ChangeExportSeedScope) {
  const seedTx = {
    id: SEED_TRANSACTION_ID,
    query: async <T>(sql: string, params?: unknown[]): Promise<T> => {
      const [result] = await connection.query(sql, params);
      return result as T;
    }
  };

  async function pinChangeTime(changeIDs: number[], changeTime: string | null): Promise<void> {
    await connection.query('UPDATE unifiedchangelog SET ChangeTimestamp = ? WHERE ChangeID IN (?)', [changeTime, changeIDs]);
  }

  async function soleChangeID(tableName: string, recordID: string | number, operation: ChangelogOperation): Promise<number> {
    const [rows] = await connection.query<RowDataPacket[]>(
      'SELECT ChangeID FROM unifiedchangelog WHERE TableName = ? AND RecordID = ? AND Operation = ? ORDER BY ChangeID',
      [tableName, String(recordID), operation]
    );
    expect(rows, `exactly one ${operation} changelog row for ${tableName} ${recordID}`).toHaveLength(1);
    return Number(rows[0].ChangeID);
  }

  async function insertRawChange(seed: RawChangeSeed): Promise<number> {
    const serialize = (state: unknown) => (state === undefined ? null : JSON.stringify(state));
    const [result] = await connection.query<ResultSetHeader>(
      `INSERT INTO unifiedchangelog (TableName, RecordID, Operation, OldRowState, NewRowState, ChangeTimestamp, ChangedBy, PlotID, CensusID)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        seed.tableName,
        seed.recordID,
        seed.operation,
        serialize(seed.oldRowState),
        serialize(seed.newRowState),
        seed.changeTime,
        SEED_CHANGED_BY,
        seed.plotID === undefined ? plotID : seed.plotID,
        censusID
      ]
    );
    return result.insertId;
  }

  /** A parked (StemGUID NULL) measurement, the cheapest real row the snapshot writers can audit. */
  async function insertMeasurement(fileID: string | null, batchID: string | null, treeTag: string, dbh: number): Promise<number> {
    const [result] = await connection.query<ResultSetHeader>(
      `INSERT INTO coremeasurements (CensusID, StemGUID, IsValidated, MeasurementDate, MeasuredDBH, MeasuredHOM, UploadFileID, UploadBatchID, RawTreeTag, RawStemTag, IsActive)
       VALUES (?, NULL, FALSE, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [censusID, SEED_MEASUREMENT_DATE, dbh, SEED_MEASURED_HOM, fileID, batchID, treeTag, SEED_STEM_TAG]
    );
    return result.insertId;
  }

  /** Audits every measurement of (fileID, batchID) with the writer manual entry and ingestion use; returns the new ChangeIDs. */
  async function auditCommittedUpload(fileID: string, batchID: string, auditPlotID: number, changeTime: string): Promise<number[]> {
    const [before] = await connection.query<RowDataPacket[]>('SELECT COALESCE(MAX(ChangeID), 0) AS latest FROM unifiedchangelog');
    const written = await recordCommittedCoreMeasurementsAudit({
      tx: seedTx,
      schema,
      fileID,
      batchID,
      changedBy: SEED_CHANGED_BY,
      plotID: auditPlotID,
      censusID
    });
    const [rows] = await connection.query<RowDataPacket[]>('SELECT ChangeID FROM unifiedchangelog WHERE ChangeID > ? ORDER BY ChangeID', [before[0].latest]);
    const changeIDs = rows.map(row => Number(row.ChangeID));
    expect(changeIDs, `recordCommittedCoreMeasurementsAudit reported ${written} rows for ${fileID}/${batchID}`).toHaveLength(written);
    await pinChangeTime(changeIDs, changeTime);
    return changeIDs;
  }

  /** One grid-style change through recordMutation; (tableName, recordID, operation) must be unique within a test. */
  async function recordGridChange(seed: GridChangeSeed): Promise<number> {
    const base = { tx: seedTx, schema, tableName: seed.tableName, recordID: seed.recordID, changedBy: SEED_CHANGED_BY, plotID: seed.plotID };
    if (seed.operation === ChangelogOperation.INSERT) {
      await recordMutation({ ...base, operation: ChangelogOperation.INSERT, newRowState: seed.newRowState ?? {} });
    } else if (seed.operation === ChangelogOperation.DELETE) {
      await recordMutation({ ...base, operation: ChangelogOperation.DELETE, oldRowState: seed.oldRowState ?? {} });
    } else {
      await recordMutation({ ...base, operation: ChangelogOperation.UPDATE, oldRowState: seed.oldRowState ?? null, newRowState: seed.newRowState ?? {} });
    }
    const changeID = await soleChangeID(seed.tableName, seed.recordID, seed.operation);
    await pinChangeTime([changeID], seed.changeTime);
    return changeID;
  }

  return { seedTx, pinChangeTime, soleChangeID, insertRawChange, insertMeasurement, auditCommittedUpload, recordGridChange };
}

export type ChangeExportSeeder = ReturnType<typeof createChangeExportSeeder>;
