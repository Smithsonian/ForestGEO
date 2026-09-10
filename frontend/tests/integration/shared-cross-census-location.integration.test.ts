import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import {
  cleanupTestMeasurements,
  insertCrossCensusMeasurements,
  setupTestDatabase,
  setupTwoCensusScenario,
  teardownTestDatabase,
  type TestData
} from '../setup/local-db-setup';

async function errorCount(connection: Connection, validationID: number, measurementID: number): Promise<number> {
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS count
     FROM measurement_error_log mel
     JOIN measurement_errors me ON me.ErrorID = mel.ErrorID
     WHERE mel.MeasurementID = ? AND me.ErrorSource = 'validation' AND me.ErrorCode = ?`,
    [measurementID, String(validationID)]
  );
  return Number(rows[0].count);
}

async function runShared(connection: Connection, censusID: number, plotID: number) {
  await connection.query('CALL RunSharedCrossCensusLocationValidations(?, ?, 1, 1)', [censusID, plotID]);
}

describe('RunSharedCrossCensusLocationValidations', () => {
  let connection: Connection;
  let config: { database: string };
  let testData: TestData;
  let census1ID: number;
  let census2ID: number;
  let plotID: number;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    config = setup.config;
    testData = setup.testData;
    plotID = testData.plots[0].plotID;
    const scenario = await setupTwoCensusScenario(connection, testData);
    census1ID = scenario.census1.censusID;
    census2ID = scenario.census2.censusID;
  }, 90000);

  afterAll(async () => {
    await teardownTestDatabase(connection, config);
  });

  beforeEach(async () => {
    await cleanupTestMeasurements(connection, testData, { preserveCensusCount: 2 });
    await connection.query('UPDATE quadrats SET IsActive = 1 WHERE PlotID = ?', [plotID]);
  });

  it('keeps the distinct current keys first in the previous-census lookup plan', () => {
    const sql = fs.readFileSync(path.resolve(process.cwd(), 'db/sql/storedprocedures.sql'), 'utf8');
    expect(sql).toMatch(/FROM current_cross_census_keys scope_keys\s+STRAIGHT_JOIN trees t_prev[\s\S]*?STRAIGHT_JOIN stems s_prev/);
  });

  it('flags active linked pending measurements for both location checks', async () => {
    const speciesCode = testData.species[0].SpeciesCode;
    const [q1, q2] = testData.quadrats;
    const inserted = await insertCrossCensusMeasurements(connection, testData, census1ID, census2ID, [
      {
        treeTag: 'SHARED_PENDING_QUAD',
        stemTag: 'S1',
        speciesCode,
        quadratName: q1.QuadratName,
        quadratName2: q2.QuadratName,
        x: 1,
        y: 1,
        census1DBH: 10,
        census2DBH: 11,
        hom: 1.3,
        census1Date: '2024-01-01',
        census2Date: '2025-01-01'
      },
      {
        treeTag: 'SHARED_PENDING_DRIFT',
        stemTag: 'S1',
        speciesCode,
        quadratName: q1.QuadratName,
        x: 1,
        y: 1,
        x2: 12,
        y2: 1,
        census1DBH: 10,
        census2DBH: 11,
        hom: 1.3,
        census1Date: '2024-01-01',
        census2Date: '2025-01-01'
      }
    ]);

    await runShared(connection, census2ID, plotID);
    expect(await errorCount(connection, 17, inserted.census2MeasurementIDs[0])).toBe(1);
    expect(await errorCount(connection, 18, inserted.census2MeasurementIDs[1])).toBe(1);
  });

  it('has no candidate for the first census or a new recruit without a prior tag match', async () => {
    const speciesCode = testData.species[0].SpeciesCode;
    const quadratName = testData.quadrats[0].QuadratName;
    const first = await insertCrossCensusMeasurements(connection, testData, census1ID, census2ID, [
      {
        treeTag: 'SHARED_NEW_RECRUIT',
        stemTag: 'S1',
        speciesCode,
        quadratName,
        x: 2,
        y: 2,
        census1DBH: 10,
        census2DBH: 11,
        hom: 1.3,
        census1Date: '2024-01-01',
        census2Date: '2025-01-01'
      }
    ]);
    await connection.query('UPDATE coremeasurements SET IsValidated = NULL WHERE CoreMeasurementID = ?', [first.census1MeasurementIDs[0]]);
    await runShared(connection, census1ID, plotID);
    expect(await errorCount(connection, 17, first.census1MeasurementIDs[0])).toBe(0);
    expect(await errorCount(connection, 18, first.census1MeasurementIDs[0])).toBe(0);
    await connection.query('DELETE FROM cmattributes WHERE CoreMeasurementID = ?', [first.census1MeasurementIDs[0]]);
    await connection.query('DELETE FROM coremeasurements WHERE CoreMeasurementID = ?', [first.census1MeasurementIDs[0]]);
    await connection.query('DELETE FROM stems WHERE StemGUID = ?', [first.stemGUIDs[0]]);
    await connection.query('DELETE FROM trees WHERE CensusID = ? AND TreeTag = ?', [census1ID, 'SHARED_NEW_RECRUIT']);

    await runShared(connection, census1ID, plotID);
    await runShared(connection, census2ID, plotID);
    expect(await errorCount(connection, 17, first.census2MeasurementIDs[0])).toBe(0);
    expect(await errorCount(connection, 18, first.census2MeasurementIDs[0])).toBe(0);
  });

  it('uses any duplicate prior species-fork match but records each validation once', async () => {
    const [species, alternateSpecies] = testData.species;
    const [q1, q2] = testData.quadrats;
    const inserted = await insertCrossCensusMeasurements(connection, testData, census1ID, census2ID, [
      {
        treeTag: 'SHARED_SPECIES_FORK',
        stemTag: 'S1',
        speciesCode: species.SpeciesCode,
        quadratName: q1.QuadratName,
        x: 1,
        y: 1,
        census1DBH: 10,
        census2DBH: 11,
        hom: 1.3,
        census1Date: '2024-01-01',
        census2Date: '2025-01-01'
      }
    ]);
    const [speciesRows] = await connection.query<RowDataPacket[]>('SELECT SpeciesID FROM species WHERE SpeciesCode = ?', [alternateSpecies.SpeciesCode]);
    const [quadratRows] = await connection.query<RowDataPacket[]>('SELECT QuadratID FROM quadrats WHERE PlotID = ? AND QuadratName = ?', [
      plotID,
      q2.QuadratName
    ]);
    await connection.query('INSERT INTO trees (TreeTag, SpeciesID, CensusID, IsActive) VALUES (?, ?, ?, 1)', [
      'SHARED_SPECIES_FORK',
      speciesRows[0].SpeciesID,
      census1ID
    ]);
    const [treeRows] = await connection.query<RowDataPacket[]>('SELECT LAST_INSERT_ID() AS TreeID');
    await connection.query('INSERT INTO stems (TreeID, QuadratID, CensusID, StemTag, LocalX, LocalY, IsActive) VALUES (?, ?, ?, ?, ?, ?, 1)', [
      treeRows[0].TreeID,
      quadratRows[0].QuadratID,
      census1ID,
      'S1',
      20,
      1
    ]);

    await runShared(connection, census2ID, plotID);
    expect(await errorCount(connection, 17, inserted.census2MeasurementIDs[0])).toBe(1);
    expect(await errorCount(connection, 18, inserted.census2MeasurementIDs[0])).toBe(1);
  });

  it('handles null coordinates, exact ten metres, inactive prior quadrats, and empty stem tags', async () => {
    const speciesCode = testData.species[0].SpeciesCode;
    const [q1, q2] = testData.quadrats;
    const inserted = await insertCrossCensusMeasurements(connection, testData, census1ID, census2ID, [
      {
        treeTag: 'SHARED_EXACT_TEN',
        stemTag: 'S1',
        speciesCode,
        quadratName: q1.QuadratName,
        x: 1,
        y: 1,
        x2: 11,
        y2: 1,
        census1DBH: 10,
        census2DBH: 11,
        hom: 1.3,
        census1Date: '2024-01-01',
        census2Date: '2025-01-01'
      },
      {
        treeTag: 'SHARED_NULL_COORD',
        stemTag: 'S1',
        speciesCode,
        quadratName: q1.QuadratName,
        x: 1,
        y: 1,
        x2: 30,
        y2: 1,
        census1DBH: 10,
        census2DBH: 11,
        hom: 1.3,
        census1Date: '2024-01-01',
        census2Date: '2025-01-01'
      },
      {
        treeTag: 'SHARED_INACTIVE_Q',
        stemTag: 'S1',
        speciesCode,
        quadratName: q2.QuadratName,
        quadratName2: q1.QuadratName,
        x: 1,
        y: 1,
        x2: 20,
        y2: 1,
        census1DBH: 10,
        census2DBH: 11,
        hom: 1.3,
        census1Date: '2024-01-01',
        census2Date: '2025-01-01'
      },
      {
        treeTag: 'SHARED_EMPTY_STEM',
        stemTag: '',
        speciesCode,
        quadratName: q1.QuadratName,
        x: 1,
        y: 1,
        census1DBH: 10,
        census2DBH: 11,
        hom: 1.3,
        census1Date: '2024-01-01',
        census2Date: '2025-01-01'
      }
    ]);
    await connection.query('UPDATE stems SET LocalX = NULL WHERE StemGUID = ?', [inserted.stemGUIDs[2]]);
    await connection.query('UPDATE quadrats SET IsActive = 0 WHERE PlotID = ? AND QuadratName = ?', [plotID, q2.QuadratName]);

    await runShared(connection, census2ID, plotID);
    for (const measurementID of [inserted.census2MeasurementIDs[0], inserted.census2MeasurementIDs[1], inserted.census2MeasurementIDs[3]]) {
      expect(await errorCount(connection, 17, measurementID)).toBe(0);
      expect(await errorCount(connection, 18, measurementID)).toBe(0);
    }
    expect(await errorCount(connection, 17, inserted.census2MeasurementIDs[2])).toBe(0);
    expect(await errorCount(connection, 18, inserted.census2MeasurementIDs[2])).toBe(1);
  });
});
