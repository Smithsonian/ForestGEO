import crypto from 'crypto';
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';
import type ConnectionManager from '@/lib/db/connectionmanager';
import { stageMeasurementChunk } from '@/lib/uploads/stage-measurements';
import { UploadMode } from '@/config/uploadmodes';
import { SourceFormat } from '@/config/macros/formdetails';
import { DEFAULT_TEST_CONFIG } from './local-db-setup';

export const INGESTION_ERROR_SOURCE = 'ingestion';
export const SQL_EXCEPTION_ERROR_CODE = 'SQL_EXCEPTION';
export const UPLOAD_STATUS = { COMPLETED: 'completed', FAILED: 'failed', PROCESSING: 'processing' } as const;
export type UploadStatus = (typeof UPLOAD_STATUS)[keyof typeof UPLOAD_STATUS];
export const CHANGELOG_DELETE = 'DELETE';
const CHANGELOG_TABLE_COREMEASUREMENTS = 'coremeasurements';
const SEED_MEASUREMENT_DATE = '2024-03-15';
const SEED_SPECIES_CODE = 'ACERRU';
const SEED_QUADRAT = 'Q01';
const SEED_STEM_TAG = '1';
const SEED_CODES = 'A';
const SEED_HOM = 1.3;
const SEED_DBH_BASE = 10;
const SEED_DBH_SPREAD = 500;
const SEED_DBH_DIVISOR = 10;
const SEED_GRID = 20;
const RECURSION_HEADROOM = 1;
const SIDE_CONNECTION_ISOLATION = 'READ COMMITTED';

/** uploadmetrics.uploadId and uploadintegrityalerts.uploadId are varchar(50) (tablestructures.sql:1217, :1261) and local MySQL is STRICT. */
export const UPLOAD_ID_MAX_LENGTH = 50;
/** bulkingestionprocess derives its uploadId as LEFT(SHA2(…, 256), 40) (storedprocedures.sql:1843); fixtures use the same shape. */
const FIXTURE_UPLOAD_ID_HEX_LENGTH = 40;

/** A deterministic 40-character id for a seeded metric or alert, unique per (kind, file, batch, status). */
export function fixtureUploadID(...parts: Array<string | number>): string {
  const uploadID = crypto.createHash('sha256').update(parts.join('#')).digest('hex').slice(0, FIXTURE_UPLOAD_ID_HEX_LENGTH);
  if (uploadID.length > UPLOAD_ID_MAX_LENGTH) throw new RangeError(`fixture uploadId ${uploadID} exceeds ${UPLOAD_ID_MAX_LENGTH} characters`);
  return uploadID;
}

export async function countOf(connection: Connection, sql: string, params: unknown[] = []): Promise<number> {
  const [rows] = await connection.query<RowDataPacket[]>(sql, params);
  return Number(rows[0].total);
}

export async function sqlExceptionErrorID(connection: Connection): Promise<number> {
  const [rows] = await connection.query<RowDataPacket[]>('SELECT ErrorID FROM measurement_errors WHERE ErrorSource = ? AND ErrorCode = ?', [
    INGESTION_ERROR_SOURCE,
    SQL_EXCEPTION_ERROR_CODE
  ]);
  if (rows.length !== 1)
    throw new Error(
      `measurement_errors has ${rows.length} rows for ${INGESTION_ERROR_SOURCE}/${SQL_EXCEPTION_ERROR_CODE}; the schema seed should provide exactly one`
    );
  return Number(rows[0].ErrorID);
}

export interface UnresolvedRowsSeed {
  censusID: number;
  fileID: string;
  batchID: string;
  count: number;
  /** Distinct per seed call: RawTreeTag is `${tagPrefix}${n}`, so rows never match another seed's staged rows. */
  tagPrefix: string;
  /** Default true: one unresolved SQL_EXCEPTION ingestion link per row. */
  withErrorLink?: boolean;
}

/** Inserts `count` unresolved (StemGUID NULL) rows with distinct raw values; returns their ids ascending. */
export async function seedUnresolvedMeasurements(connection: Connection, seed: UnresolvedRowsSeed): Promise<number[]> {
  await connection.query('SET SESSION cte_max_recursion_depth = ?', [seed.count + RECURSION_HEADROOM]);
  await connection.query(
    `INSERT INTO coremeasurements (CensusID, StemGUID, IsValidated, MeasurementDate, MeasuredDBH, MeasuredHOM, UploadFileID, UploadBatchID,
                                   RawTreeTag, RawStemTag, RawSpCode, RawQuadrat, RawX, RawY, RawCodes, SourceRowIndex, IsActive)
     WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < ?)
     SELECT ?, NULL, FALSE, ?, ? + MOD(n, ?) / ?, ?, ?, ?, CONCAT(?, n), ?, ?, ?, MOD(n, ?), MOD(n DIV ?, ?), ?, n, 1 FROM seq`,
    [
      seed.count,
      seed.censusID,
      SEED_MEASUREMENT_DATE,
      SEED_DBH_BASE,
      SEED_DBH_SPREAD,
      SEED_DBH_DIVISOR,
      SEED_HOM,
      seed.fileID,
      seed.batchID,
      seed.tagPrefix,
      SEED_STEM_TAG,
      SEED_SPECIES_CODE,
      SEED_QUADRAT,
      SEED_GRID,
      SEED_GRID,
      SEED_GRID,
      SEED_CODES
    ]
  );
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT CoreMeasurementID FROM coremeasurements WHERE CensusID = ? AND UploadFileID = ? AND UploadBatchID = ? AND RawTreeTag LIKE CONCAT(?, '%') ORDER BY CoreMeasurementID`,
    [seed.censusID, seed.fileID, seed.batchID, seed.tagPrefix]
  );
  const ids = rows.map(row => Number(row.CoreMeasurementID));
  if (seed.withErrorLink !== false && ids.length > 0) {
    await connection.query(
      `INSERT INTO measurement_error_log (MeasurementID, ErrorID) SELECT CoreMeasurementID, ? FROM coremeasurements WHERE CoreMeasurementID IN (?)`,
      [await sqlExceptionErrorID(connection), ids]
    );
  }
  return ids;
}

/** One staged row per measurement, copying exactly the raw values the cross-file (C3) join compares. */
export async function stageRowsMirroringMeasurements(
  connection: Connection,
  staged: { fileID: string; batchID: string; plotID: number; measurementIDs: number[] }
): Promise<void> {
  await connection.query(
    `INSERT INTO temporarymeasurements (FileID, BatchID, PlotID, CensusID, TreeTag, StemTag, SpeciesCode, QuadratName, LocalX, LocalY, DBH, HOM, MeasurementDate, Codes, Comments)
     SELECT ?, ?, ?, CensusID, RawTreeTag, RawStemTag, RawSpCode, RawQuadrat, RawX, RawY, MeasuredDBH, MeasuredHOM, MeasurementDate, RawCodes, RawComments
     FROM coremeasurements WHERE CoreMeasurementID IN (?)`,
    [staged.fileID, staged.batchID, staged.plotID, staged.measurementIDs]
  );
}

/** `count` staged rows of an incoming family that match no seeded measurement (tags `${tagPrefix}${n}`). */
export async function stageIncomingRows(
  connection: Connection,
  staged: { fileID: string; batchID: string; plotID: number; censusID: number; count: number; tagPrefix: string }
): Promise<void> {
  await connection.query('SET SESSION cte_max_recursion_depth = ?', [staged.count + RECURSION_HEADROOM]);
  await connection.query(
    `INSERT INTO temporarymeasurements (FileID, BatchID, PlotID, CensusID, TreeTag, StemTag, SpeciesCode, QuadratName, LocalX, LocalY, DBH, HOM, MeasurementDate, Codes)
     WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < ?)
     SELECT ?, ?, ?, ?, CONCAT(?, n), ?, ?, ?, MOD(n, ?), MOD(n DIV ?, ?), ? + MOD(n, ?) / ?, ?, ?, ? FROM seq`,
    [
      staged.count,
      staged.fileID,
      staged.batchID,
      staged.plotID,
      staged.censusID,
      staged.tagPrefix,
      SEED_STEM_TAG,
      SEED_SPECIES_CODE,
      SEED_QUADRAT,
      SEED_GRID,
      SEED_GRID,
      SEED_GRID,
      SEED_DBH_BASE,
      SEED_DBH_SPREAD,
      SEED_DBH_DIVISOR,
      SEED_HOM,
      SEED_MEASUREMENT_DATE,
      SEED_CODES
    ]
  );
}

export async function seedUploadMetric(
  connection: Connection,
  metric: { schema: string; plotID: number; censusID: number; fileID: string; batchID: string; status: UploadStatus }
): Promise<void> {
  await connection.query(
    `INSERT INTO uploadmetrics (uploadId, fileID, batchID, schema_name, plotID, censusID, status, startTime) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      fixtureUploadID('metric', metric.fileID, metric.batchID, metric.status),
      metric.fileID,
      metric.batchID,
      metric.schema,
      metric.plotID,
      metric.censusID,
      metric.status
    ]
  );
}

export async function seedIntegrityAlert(connection: Connection, alert: { plotID: number; censusID: number; fileID: string; batchID: string }): Promise<void> {
  await connection.query(
    `INSERT INTO uploadintegrityalerts (uploadId, type, message, fileID, batchID, plotID, censusID, sourceRecords, processedRecords, failedRecords, missingRecords)
     VALUES (?, 'PROCEDURE_EXCEPTION', 'seeded by a #562 test', ?, ?, ?, ?, 0, 0, 0, 0)`,
    [fixtureUploadID('alert', alert.fileID, alert.batchID), alert.fileID, alert.batchID, alert.plotID, alert.censusID]
  );
}

/** `count` trees with one stem each and no measurement (legacy residue of a failed first load). */
export async function seedResidualTreesAndStems(
  connection: Connection,
  residue: { censusID: number; speciesID: number; quadratID: number; count: number; tagPrefix: string }
): Promise<void> {
  await connection.query('SET SESSION cte_max_recursion_depth = ?', [residue.count + RECURSION_HEADROOM]);
  await connection.query(
    `INSERT INTO trees (TreeTag, SpeciesID, CensusID) WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < ?) SELECT CONCAT(?, n), ?, ? FROM seq`,
    [residue.count, residue.tagPrefix, residue.speciesID, residue.censusID]
  );
  await connection.query(
    `INSERT INTO stems (TreeID, QuadratID, CensusID, StemTag, LocalX, LocalY) SELECT TreeID, ?, CensusID, ?, 0, 0 FROM trees WHERE CensusID = ? AND TreeTag LIKE CONCAT(?, '%')`,
    [residue.quadratID, SEED_STEM_TAG, residue.censusID, residue.tagPrefix]
  );
}

/** DELETE-audit rows per coremeasurements RecordID for `censusID`: RecordID → { count, changedBy }. */
export async function deleteAuditCounts(connection: Connection, censusID: number): Promise<Map<number, { count: number; changedBy: string | null }>> {
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT RecordID, COUNT(*) AS auditRows, MIN(ChangedBy) AS changedBy FROM unifiedchangelog
     WHERE TableName = ? AND Operation = ? AND CensusID = ? GROUP BY RecordID`,
    [CHANGELOG_TABLE_COREMEASUREMENTS, CHANGELOG_DELETE, censusID]
  );
  return new Map(rows.map(row => [Number(row.RecordID), { count: Number(row.auditRows), changedBy: row.changedBy === null ? null : String(row.changedBy) }]));
}

/** A content checksum of every coremeasurements row whose id is not in `excludedIDs`, with the row count. */
export async function fingerprintMeasurementsOutside(connection: Connection, excludedIDs: number[]): Promise<{ rows: number; crc: string }> {
  const exclusion = excludedIDs.length > 0 ? 'WHERE CoreMeasurementID NOT IN (?)' : '';
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(CRC32(CONCAT_WS('#', CoreMeasurementID, IFNULL(StemGUID, 'null'), CensusID, IFNULL(UploadFileID, ''), IFNULL(UploadBatchID, ''),
                                        IFNULL(RawTreeTag, ''), MeasuredDBH, IsActive, IFNULL(Description, '')))), 0) AS crc
     FROM coremeasurements ${exclusion}`,
    excludedIDs.length > 0 ? [excludedIDs] : []
  );
  return { rows: Number(rows[0].total), crc: String(rows[0].crc) };
}

/** A second session on the test schema at READ COMMITTED (the ConnectionManager's level) with its own lock wait. */
export class InvalidLockWaitTimeoutError extends Error {
  constructor(value: number) {
    super(`innodb_lock_wait_timeout must be a positive integer number of seconds; got ${value}`);
    this.name = 'InvalidLockWaitTimeoutError';
  }
}

export async function openSideConnection(database: string, lockWaitTimeoutSeconds: number): Promise<Connection> {
  if (!Number.isInteger(lockWaitTimeoutSeconds) || lockWaitTimeoutSeconds <= 0) throw new InvalidLockWaitTimeoutError(lockWaitTimeoutSeconds);
  const { host, port, user, password } = DEFAULT_TEST_CONFIG;
  const side = await mysql.createConnection({ host, port, user, password, database });
  await side.query(`SET SESSION TRANSACTION ISOLATION LEVEL ${SIDE_CONNECTION_ISOLATION}`);
  await side.query(`SET SESSION innodb_lock_wait_timeout = ${lockWaitTimeoutSeconds}`);
  return side;
}

export const CLEAN_FIXTURE_ROW_COUNT = 5;
export const CLEAN_FIXTURE_CSV_HEADERS = ['tag', 'stemtag', 'spcode', 'quadrat', 'lx', 'ly', 'dbh', 'hom', 'date', 'codes'];
const CLEAN_FIXTURE_CSV_DELIMITER = ',';
const CLEAN_FIXTURE_MEASUREMENT_DATE = '2024-03-15';
const CLEAN_FIXTURE_HOM = '1.3';

/** Five rows that ingest cleanly into the seeded first census (valid species, quadrats, codes, a date inside its window). */
export function buildCleanFixtureRows(): Record<string, string>[] {
  const row = (tag: string, spcode: string, quadrat: string, lx: string, ly: string, dbh: string, codes: string) => ({
    tag,
    stemtag: SEED_STEM_TAG,
    spcode,
    quadrat,
    lx,
    ly,
    dbh,
    hom: CLEAN_FIXTURE_HOM,
    date: CLEAN_FIXTURE_MEASUREMENT_DATE,
    codes
  });
  return [
    row('IB001', 'ACERRU', 'Q01', '1.5', '2.5', '10.5', 'A'),
    row('IB002', 'QUERCO', 'Q01', '3.5', '4.5', '20.4', 'A;R'),
    row('IB003', 'PINUST', 'Q02', '5.5', '6.5', '30.1', 'A'),
    row('IB004', 'FAGUGR', 'Q02', '7.5', '8.5', '15.2', 'A'),
    row('IB005', 'BETUAL', 'Q03', '9.5', '0.5', '25.8', 'A')
  ];
}

/** Stages the clean rows for one family through the production staging path, REVISIONS mode, no session, in its own transaction. */
export async function stageCleanFixtureRows(
  connectionManager: ConnectionManager,
  family: { schema: string; fileName: string; batchID: string; plotID: number; censusID: number; changedBy: string }
): Promise<number> {
  const transactionID = await connectionManager.beginTransaction();
  try {
    const result = await stageMeasurementChunk(connectionManager, {
      ...family,
      uploadMode: UploadMode.REVISIONS,
      sourceFormat: SourceFormat.csv,
      rawRows: buildCleanFixtureRows(),
      csvHeaders: CLEAN_FIXTURE_CSV_HEADERS,
      delimiter: CLEAN_FIXTURE_CSV_DELIMITER,
      uploadSessionID: null,
      firstRowOrdinal: null,
      transactionID
    });
    await connectionManager.commitTransaction(transactionID);
    return result.insertedCount;
  } catch (stagingError: unknown) {
    await connectionManager.rollbackTransaction(transactionID);
    throw stagingError;
  }
}
