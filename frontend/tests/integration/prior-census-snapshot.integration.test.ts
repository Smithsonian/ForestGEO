/**
 * Prior-Census Snapshot Integration Tests
 *
 * RunSharedDBHChangeValidations (ValidationIDs 1 growth / 2 shrinkage) must record,
 * on each measurement_error_log row it writes, exactly which prior-census measurement
 * it compared: PriorCensusID, PriorDBH, PriorHOM. Scientists use the snapshot to see
 * both censuses' values side by side and dismiss HOM-change false positives.
 *
 * Properties under test:
 *   1. The snapshot carries the prior census's DBH and HOM (including across an HOM change).
 *   2. Multi-match ties resolve to the greatest violating cm_past.CoreMeasurementID for
 *      THAT error kind - never a prior row that did not itself violate; growth and
 *      shrinkage may pick different prior rows.
 *   3. Re-validation refreshes the snapshot and reopens the error (the ON DUPLICATE KEY
 *      UPDATE branch is reachable).
 *   4. Errors other than ValidationIDs 1/2 keep NULL snapshot columns.
 *   5. Flagged-set parity: the refactor does not change WHICH measurements get flagged
 *      (a legal 2% shrink stays unflagged with both validations enabled).
 *
 * Prerequisites: docker compose up -d mysql (from repo root)
 * Run: npm run test:integration -- prior-census-snapshot
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import {
  setupTestDatabase,
  teardownTestDatabase,
  cleanupTestMeasurements,
  insertCrossCensusMeasurements,
  seedStatusAttributes,
  setupTwoCensusScenario,
  type TestData
} from '../setup/local-db-setup';

const GROWTH_VALIDATION_ID = 1;
const SHRINKAGE_VALIDATION_ID = 2;
const RUN_ENABLED = 1;
const ALIVE_CODE = 'A';
const INGESTION_ERROR_CODE_NEGATIVE_DBH = 'NEGATIVE_DBH';
const PRIOR_MEASUREMENT_DATE = '2024-06-15';
const PRIOR_SIBLING_MEASUREMENT_DATE = '2024-07-15';
const PRESENT_MEASUREMENT_DATE = '2025-06-15';

interface SnapshotRow {
  MeasurementID: number;
  ErrorID: number;
  ErrorSource: string;
  ErrorCode: string;
  IsResolved: number;
  ResolvedAt: Date | null;
  PriorCensusID: number | null;
  PriorDBH: number | null;
  PriorHOM: number | null;
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' ? parseFloat(value) : Number(value);
}

function toBoolNumber(value: unknown): number {
  if (Buffer.isBuffer(value)) return value[0];
  return Number(value);
}

async function callSharedDBHValidations(connection: Connection, censusID: number, plotID: number): Promise<void> {
  await connection.query('CALL RunSharedDBHChangeValidations(?, ?, ?, ?)', [censusID, plotID, RUN_ENABLED, RUN_ENABLED]);
}

async function getErrorLogRows(connection: Connection, measurementID: number, validationID?: number): Promise<SnapshotRow[]> {
  let query = `
    SELECT mel.MeasurementID, mel.ErrorID, me.ErrorSource, me.ErrorCode,
           mel.IsResolved, mel.ResolvedAt,
           mel.PriorCensusID, mel.PriorDBH, mel.PriorHOM
    FROM measurement_error_log mel
    JOIN measurement_errors me ON me.ErrorID = mel.ErrorID
    WHERE mel.MeasurementID = ?
  `;
  const params: Array<number | string> = [measurementID];
  if (validationID !== undefined) {
    query += ` AND me.ErrorSource = 'validation' AND me.ErrorCode = CAST(? AS CHAR)`;
    params.push(validationID);
  }
  query += ' ORDER BY me.ErrorSource, me.ErrorCode';

  const [rows] = await connection.query<RowDataPacket[]>(query, params);
  return rows.map(row => ({
    MeasurementID: row.MeasurementID,
    ErrorID: row.ErrorID,
    ErrorSource: row.ErrorSource,
    ErrorCode: row.ErrorCode,
    IsResolved: toBoolNumber(row.IsResolved),
    ResolvedAt: row.ResolvedAt,
    PriorCensusID: row.PriorCensusID,
    PriorDBH: toNumberOrNull(row.PriorDBH),
    PriorHOM: toNumberOrNull(row.PriorHOM)
  }));
}

/**
 * Inserts an additional validated prior-census measurement on an existing stem,
 * with an alive attribute so the dead-status exclusions do not filter it.
 * Returns the new CoreMeasurementID (always greater than earlier inserts).
 */
async function insertAdditionalPriorMeasurement(
  connection: Connection,
  stemGUID: number,
  censusID: number,
  dbh: number,
  hom: number,
  date: string
): Promise<number> {
  await connection.query(
    `INSERT INTO coremeasurements
     (StemGUID, CensusID, MeasuredDBH, MeasuredHOM, MeasurementDate, IsValidated, IsActive)
     VALUES (?, ?, ?, ?, ?, 1, 1)`,
    [stemGUID, censusID, dbh, hom, date]
  );
  const [rows] = await connection.query<RowDataPacket[]>('SELECT LAST_INSERT_ID() AS CoreMeasurementID');
  const coreMeasurementID = rows[0].CoreMeasurementID as number;
  await connection.query('INSERT INTO cmattributes (CoreMeasurementID, Code) VALUES (?, ?)', [coreMeasurementID, ALIVE_CODE]);
  return coreMeasurementID;
}

describe('Prior-Census Snapshot on DBH Change Validations', () => {
  let connection: Connection;
  let testData: TestData;
  let config: { database: string };
  let census1ID: number;
  let census2ID: number;
  let plotID: number;
  let speciesCode: string;
  let quadratName: string;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
    config = setup.config;
    plotID = testData.plots[0].plotID;

    const scenario = await setupTwoCensusScenario(connection, testData);
    census1ID = scenario.census1.censusID;
    census2ID = scenario.census2.censusID;

    await seedStatusAttributes(connection);

    speciesCode = testData.species[0]?.SpeciesCode || testData.species[0]?.Mnemonic;
    quadratName = testData.quadrats[0]?.QuadratName || testData.quadrats[0]?.Quadrat;
    if (!speciesCode || !quadratName) {
      throw new Error('Test setup failed: missing species or quadrat data');
    }
  }, 90000);

  afterAll(async () => {
    await teardownTestDatabase(connection, config);
  });

  beforeEach(async () => {
    await cleanupTestMeasurements(connection, testData);
  });

  it('records the prior census DBH and HOM when shrinkage fires across an HOM change', async () => {
    const { census2MeasurementIDs } = await insertCrossCensusMeasurements(connection, testData, census1ID, census2ID, [
      {
        treeTag: 'SNAP_HOM_CHANGE',
        stemTag: 'S001',
        speciesCode,
        quadratName,
        x: 5,
        y: 5,
        census1DBH: 50,
        census2DBH: 40,
        hom: 1.3,
        census1Date: PRIOR_MEASUREMENT_DATE,
        census2Date: PRESENT_MEASUREMENT_DATE,
        codes: ALIVE_CODE
      }
    ]);
    const presentID = census2MeasurementIDs[0];

    // The measurer moved the point of measurement up the stem: HOM 1.3 -> 2.6.
    // Shrinkage still fires (40 < 50 * 0.95), and the snapshot must expose the
    // prior HOM so a scientist can dismiss this as an HOM-change false positive.
    await connection.query('UPDATE coremeasurements SET MeasuredHOM = 2.6 WHERE CoreMeasurementID = ?', [presentID]);

    await callSharedDBHValidations(connection, census2ID, plotID);

    const shrinkageRows = await getErrorLogRows(connection, presentID, SHRINKAGE_VALIDATION_ID);
    const growthRows = await getErrorLogRows(connection, presentID, GROWTH_VALIDATION_ID);
    console.log('[HOM-change] shrinkage rows:', JSON.stringify(shrinkageRows));
    console.log('[HOM-change] growth rows:', JSON.stringify(growthRows));

    expect(shrinkageRows.length).toBe(1);
    expect(shrinkageRows[0].PriorCensusID).toBe(census1ID);
    expect(shrinkageRows[0].PriorDBH).toBe(50);
    expect(shrinkageRows[0].PriorHOM).toBe(1.3);
    expect(shrinkageRows[0].IsResolved).toBe(0);
    expect(growthRows.length).toBe(0);
  });

  it('records the prior HOM even when it matches the present HOM', async () => {
    const { census2MeasurementIDs } = await insertCrossCensusMeasurements(connection, testData, census1ID, census2ID, [
      {
        treeTag: 'SNAP_EQUAL_HOM',
        stemTag: 'S001',
        speciesCode,
        quadratName,
        x: 6,
        y: 6,
        census1DBH: 50,
        census2DBH: 40,
        hom: 1.3,
        census1Date: PRIOR_MEASUREMENT_DATE,
        census2Date: PRESENT_MEASUREMENT_DATE,
        codes: ALIVE_CODE
      }
    ]);
    const presentID = census2MeasurementIDs[0];

    await callSharedDBHValidations(connection, census2ID, plotID);

    const shrinkageRows = await getErrorLogRows(connection, presentID, SHRINKAGE_VALIDATION_ID);
    console.log('[equal-HOM] shrinkage rows:', JSON.stringify(shrinkageRows));

    expect(shrinkageRows.length).toBe(1);
    expect(shrinkageRows[0].PriorCensusID).toBe(census1ID);
    expect(shrinkageRows[0].PriorDBH).toBe(50);
    expect(shrinkageRows[0].PriorHOM).toBe(1.3);
  });

  it('snapshots only a violating prior row when a later non-violating sibling exists', async () => {
    const { census2MeasurementIDs, stemGUIDs } = await insertCrossCensusMeasurements(connection, testData, census1ID, census2ID, [
      {
        treeTag: 'SNAP_MULTI_NONVIOL',
        stemTag: 'S001',
        speciesCode,
        quadratName,
        x: 7,
        y: 7,
        census1DBH: 50,
        census2DBH: 40,
        hom: 1.3,
        census1Date: PRIOR_MEASUREMENT_DATE,
        census2Date: PRESENT_MEASUREMENT_DATE,
        codes: ALIVE_CODE
      }
    ]);
    const presentID = census2MeasurementIDs[0];
    const priorStemGUID = stemGUIDs[0];

    // Second validated prior measurement on the SAME stem: DBH 41 vs present 40
    // is only a ~2.4% shrink, so it does NOT violate. It gets the GREATER
    // CoreMeasurementID - a naive "max prior ID over all matches" would pick it.
    const nonViolatingPriorID = await insertAdditionalPriorMeasurement(connection, priorStemGUID, census1ID, 41, 1.3, PRIOR_SIBLING_MEASUREMENT_DATE);
    console.log('[multi-match non-violating] non-violating prior CoreMeasurementID:', nonViolatingPriorID);

    await callSharedDBHValidations(connection, census2ID, plotID);

    const shrinkageRows = await getErrorLogRows(connection, presentID, SHRINKAGE_VALIDATION_ID);
    console.log('[multi-match non-violating] shrinkage rows:', JSON.stringify(shrinkageRows));

    expect(shrinkageRows.length).toBe(1);
    expect(shrinkageRows[0].PriorCensusID).toBe(census1ID);
    expect(shrinkageRows[0].PriorDBH).toBe(50);
    expect(shrinkageRows[0].PriorHOM).toBe(1.3);
  });

  it('resolves a tie between two violating prior rows to the greatest prior CoreMeasurementID', async () => {
    const { census2MeasurementIDs, stemGUIDs } = await insertCrossCensusMeasurements(connection, testData, census1ID, census2ID, [
      {
        treeTag: 'SNAP_MULTI_BOTHVIOL',
        stemTag: 'S001',
        speciesCode,
        quadratName,
        x: 8,
        y: 8,
        census1DBH: 50,
        census2DBH: 40,
        hom: 1.3,
        census1Date: PRIOR_MEASUREMENT_DATE,
        census2Date: PRESENT_MEASUREMENT_DATE,
        codes: ALIVE_CODE
      }
    ]);
    const presentID = census2MeasurementIDs[0];
    const priorStemGUID = stemGUIDs[0];

    // Both prior rows violate shrinkage (40 < 50*0.95 and 40 < 55*0.95); the
    // later insert has the greater CoreMeasurementID and must win the tie.
    const laterViolatingPriorID = await insertAdditionalPriorMeasurement(connection, priorStemGUID, census1ID, 55, 1.4, PRIOR_SIBLING_MEASUREMENT_DATE);
    console.log('[multi-match both-violating] later violating prior CoreMeasurementID:', laterViolatingPriorID);

    await callSharedDBHValidations(connection, census2ID, plotID);

    const shrinkageRows = await getErrorLogRows(connection, presentID, SHRINKAGE_VALIDATION_ID);
    console.log('[multi-match both-violating] shrinkage rows:', JSON.stringify(shrinkageRows));

    expect(shrinkageRows.length).toBe(1);
    expect(shrinkageRows[0].PriorCensusID).toBe(census1ID);
    expect(shrinkageRows[0].PriorDBH).toBe(55);
    expect(shrinkageRows[0].PriorHOM).toBe(1.4);
  });

  it('lets growth and shrinkage snapshot different prior rows for the same measurement', async () => {
    const { census2MeasurementIDs, stemGUIDs } = await insertCrossCensusMeasurements(connection, testData, census1ID, census2ID, [
      {
        treeTag: 'SNAP_SPLIT_KINDS',
        stemTag: 'S001',
        speciesCode,
        quadratName,
        x: 9,
        y: 9,
        census1DBH: 100, // growth violates vs present 200 (delta 100mm > 65mm); shrinkage does not
        census2DBH: 200,
        hom: 1.3,
        census1Date: PRIOR_MEASUREMENT_DATE,
        census2Date: PRESENT_MEASUREMENT_DATE,
        codes: ALIVE_CODE
      }
    ]);
    const presentID = census2MeasurementIDs[0];
    const priorStemGUID = stemGUIDs[0];

    // Second prior row: DBH 300 violates shrinkage (200 < 285) but not growth.
    await insertAdditionalPriorMeasurement(connection, priorStemGUID, census1ID, 300, 1.5, PRIOR_SIBLING_MEASUREMENT_DATE);

    await callSharedDBHValidations(connection, census2ID, plotID);

    const growthRows = await getErrorLogRows(connection, presentID, GROWTH_VALIDATION_ID);
    const shrinkageRows = await getErrorLogRows(connection, presentID, SHRINKAGE_VALIDATION_ID);
    console.log('[split-kinds] growth rows:', JSON.stringify(growthRows));
    console.log('[split-kinds] shrinkage rows:', JSON.stringify(shrinkageRows));

    expect(growthRows.length).toBe(1);
    expect(growthRows[0].PriorDBH).toBe(100);
    expect(growthRows[0].PriorHOM).toBe(1.3);

    expect(shrinkageRows.length).toBe(1);
    expect(shrinkageRows[0].PriorDBH).toBe(300);
    expect(shrinkageRows[0].PriorHOM).toBe(1.5);
  });

  it('refreshes the snapshot and reopens a resolved error on re-validation', async () => {
    const { census1MeasurementIDs, census2MeasurementIDs } = await insertCrossCensusMeasurements(connection, testData, census1ID, census2ID, [
      {
        treeTag: 'SNAP_REFRESH',
        stemTag: 'S001',
        speciesCode,
        quadratName,
        x: 10,
        y: 10,
        census1DBH: 50,
        census2DBH: 40,
        hom: 1.3,
        census1Date: PRIOR_MEASUREMENT_DATE,
        census2Date: PRESENT_MEASUREMENT_DATE,
        codes: ALIVE_CODE
      }
    ]);
    const priorID = census1MeasurementIDs[0];
    const presentID = census2MeasurementIDs[0];

    await callSharedDBHValidations(connection, census2ID, plotID);

    const firstRun = await getErrorLogRows(connection, presentID, SHRINKAGE_VALIDATION_ID);
    console.log('[refresh] first-run shrinkage rows:', JSON.stringify(firstRun));
    expect(firstRun.length).toBe(1);
    expect(firstRun[0].PriorDBH).toBe(50);

    // A back-correction changes the prior measurement, and someone resolved the
    // error in the meantime. Re-validation must refresh the snapshot AND reopen.
    await connection.query('UPDATE coremeasurements SET MeasuredDBH = 60 WHERE CoreMeasurementID = ?', [priorID]);
    await connection.query('UPDATE measurement_error_log SET IsResolved = TRUE, ResolvedAt = NOW() WHERE MeasurementID = ?', [presentID]);

    await callSharedDBHValidations(connection, census2ID, plotID);

    const secondRun = await getErrorLogRows(connection, presentID, SHRINKAGE_VALIDATION_ID);
    console.log('[refresh] second-run shrinkage rows:', JSON.stringify(secondRun));

    expect(secondRun.length).toBe(1);
    expect(secondRun[0].PriorCensusID).toBe(census1ID);
    expect(secondRun[0].PriorDBH).toBe(60);
    expect(secondRun[0].PriorHOM).toBe(1.3);
    expect(secondRun[0].IsResolved).toBe(0);
    expect(secondRun[0].ResolvedAt).toBeNull();
  });

  it('leaves the snapshot columns NULL on errors other than ValidationIDs 1 and 2', async () => {
    // Non-violating pair: no growth (0mm delta) and no shrinkage (0%).
    const { census2MeasurementIDs } = await insertCrossCensusMeasurements(connection, testData, census1ID, census2ID, [
      {
        treeTag: 'SNAP_OTHER_ERROR',
        stemTag: 'S001',
        speciesCode,
        quadratName,
        x: 11,
        y: 11,
        census1DBH: 50,
        census2DBH: 50,
        hom: 1.3,
        census1Date: PRIOR_MEASUREMENT_DATE,
        census2Date: PRESENT_MEASUREMENT_DATE,
        codes: ALIVE_CODE
      }
    ]);
    const presentID = census2MeasurementIDs[0];

    const [ingestionErrorRows] = await connection.query<RowDataPacket[]>(
      `SELECT ErrorID FROM measurement_errors WHERE ErrorSource = 'ingestion' AND ErrorCode = ?`,
      [INGESTION_ERROR_CODE_NEGATIVE_DBH]
    );
    expect(ingestionErrorRows.length).toBe(1);
    const ingestionErrorID = ingestionErrorRows[0].ErrorID;

    await connection.query('INSERT INTO measurement_error_log (MeasurementID, ErrorID) VALUES (?, ?)', [presentID, ingestionErrorID]);

    await callSharedDBHValidations(connection, census2ID, plotID);

    const allRows = await getErrorLogRows(connection, presentID);
    console.log('[non-1/2 error] all error rows:', JSON.stringify(allRows));

    expect(allRows.length).toBe(1);
    expect(allRows[0].ErrorSource).toBe('ingestion');
    expect(allRows[0].ErrorCode).toBe(INGESTION_ERROR_CODE_NEGATIVE_DBH);
    expect(allRows[0].PriorCensusID).toBeNull();
    expect(allRows[0].PriorDBH).toBeNull();
    expect(allRows[0].PriorHOM).toBeNull();
    expect(allRows[0].IsResolved).toBe(0);
  });

  it('flagged-set parity: a legal 2% shrink is not flagged by growth or shrinkage', async () => {
    const { census2MeasurementIDs } = await insertCrossCensusMeasurements(connection, testData, census1ID, census2ID, [
      {
        treeTag: 'SNAP_LEGAL_SHRINK',
        stemTag: 'S001',
        speciesCode,
        quadratName,
        x: 12,
        y: 12,
        census1DBH: 50,
        census2DBH: 49, // 2% shrink: 49 >= 50 * 0.95, legal
        hom: 1.3,
        census1Date: PRIOR_MEASUREMENT_DATE,
        census2Date: PRESENT_MEASUREMENT_DATE,
        codes: ALIVE_CODE
      }
    ]);
    const presentID = census2MeasurementIDs[0];

    await callSharedDBHValidations(connection, census2ID, plotID);

    const allRows = await getErrorLogRows(connection, presentID);
    console.log('[parity negative] error rows for legal 2% shrink:', JSON.stringify(allRows));

    expect(allRows.length).toBe(0);

    // The measurement itself must still exist and be pending validation.
    const [cmRows] = await connection.query<RowDataPacket[]>(
      'SELECT CoreMeasurementID, MeasuredDBH, IsValidated FROM coremeasurements WHERE CoreMeasurementID = ?',
      [presentID]
    );
    expect(cmRows.length).toBe(1);
    expect(cmRows[0].IsValidated).toBeNull();
  });
});
