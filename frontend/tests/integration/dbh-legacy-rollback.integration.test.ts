/**
 * Rehearsal fixture for the prepared legacy DBH rollback revision.  It installs
 * the rollback manifest into an isolated test schema and proves the old rule
 * predicates, rather than merely checking SQL text.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { parseStoredProceduresSQL } from '@/scripts/deploy-validations-to-all-schemas';
import {
  cleanupTestMeasurements,
  insertCrossCensusMeasurements,
  seedMeasurementErrors,
  setupTestDatabase,
  setupTwoCensusScenario,
  teardownTestDatabase,
  type TestData
} from '../setup/local-db-setup';

describe('prepared DBH legacy-rule rollback', () => {
  let connection: Connection;
  let config: { database: string };
  let testData: TestData;
  let census1ID: number;
  let census2ID: number;
  let plotID: number;
  let speciesCode: string;
  let quadratName: string;
  let serial = 0;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    config = setup.config;
    testData = setup.testData;
    ({
      census1: { censusID: census1ID },
      census2: { censusID: census2ID }
    } = await setupTwoCensusScenario(connection, testData));
    plotID = testData.plots[0].plotID;
    speciesCode = testData.species[0].SpeciesCode || testData.species[0].Mnemonic;
    quadratName = testData.quadrats[0].QuadratName || testData.quadrats[0].Quadrat;
    const rollbackRoot = path.join(process.cwd(), 'db/rollback');
    const procedures = readFileSync(path.join(rollbackRoot, '2026-09-02-dbh-legacy-rules-procedures.sql'), 'utf8');
    const seeds = readFileSync(path.join(rollbackRoot, '2026-09-02-dbh-legacy-rules-corequeries.sql'), 'utf8');
    await connection.query('DROP PROCEDURE IF EXISTS RunSharedDBHChangeValidations');
    await connection.query('DROP PROCEDURE IF EXISTS BuildDBHChangePairs');
    for (const statement of parseStoredProceduresSQL(procedures)) {
      if (/^DROP\s+PROCEDURE/i.test(statement)) continue;
      if (/\bCREATE\s+PROCEDURE\s+(?:`?)(?:BuildDBHChangePairs|RunSharedDBHChangeValidations)/i.test(statement)) await connection.query(statement);
    }
    await connection.query(seeds);
    await seedMeasurementErrors(connection);
  }, 90000);

  afterAll(async () => teardownTestDatabase(connection, config));
  beforeEach(async () => {
    await cleanupTestMeasurements(connection, testData);
    await connection.query("UPDATE plots SET DefaultDBHUnits = 'mm' WHERE PlotID = ?", [plotID]);
  });

  async function seed(tag: string, prior: number, present: number, priorDate = '2015-01-01', presentDate = '2025-01-01', codes = 'A') {
    serial += 1;
    const inserted = await insertCrossCensusMeasurements(connection, testData, census1ID, census2ID, [
      {
        treeTag: `${tag.slice(0, 7)}${serial}`,
        stemTag: `S${serial}`,
        speciesCode,
        quadratName,
        x: serial,
        y: serial,
        census1DBH: prior,
        census2DBH: present,
        hom: 1.3,
        census1Date: priorDate,
        census2Date: presentDate,
        codes
      }
    ]);
    return { priorID: inserted.census1MeasurementIDs[0], presentID: inserted.census2MeasurementIDs[0] };
  }

  async function codesFor(measurementID: number): Promise<string[]> {
    await connection.query('CALL RunSharedDBHChangeValidations(?, ?, 1, 1)', [census2ID, plotID]);
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT me.ErrorCode FROM measurement_error_log mel JOIN measurement_errors me ON me.ErrorID = mel.ErrorID
       WHERE mel.MeasurementID = ? AND mel.IsResolved = FALSE AND me.ErrorSource = 'validation' ORDER BY me.ErrorCode`,
      [measurementID]
    );
    return rows.map(row => String(row.ErrorCode));
  }

  it('uses absolute growth even over a ten-year interval', async () => {
    const { presentID } = await seed('ABSOLUTE', 100, 170);
    expect(await codesFor(presentID)).toContain('1');
  });

  it('does not apply the new DBH floor, HOM, or measurement-date gates', async () => {
    const floor = await seed('FLOOR', 5, 80);
    const hom = await seed('HOM', 100, 170);
    const missing = await seed('MISSING', 100, 170);
    const zero = await seed('ZERO', 100, 170, '2024-01-01', '2024-01-01');
    const reversed = await seed('REVERSED', 100, 170, '2025-01-01', '2024-01-01');
    await connection.query('UPDATE coremeasurements SET MeasuredHOM = 2 WHERE CoreMeasurementID = ?', [hom.presentID]);
    await connection.query('UPDATE coremeasurements SET MeasurementDate = NULL WHERE CoreMeasurementID = ?', [missing.presentID]);
    for (const id of [floor.presentID, hom.presentID, missing.presentID, zero.presentID, reversed.presentID]) expect(await codesFor(id)).toContain('1');
  });

  it('keeps the strict old shrinkage boundary and positive-prior requirement', async () => {
    const atBoundary = await seed('BOUNDARY', 100, 95);
    const beyondBoundary = await seed('BEYOND', 100, 94.999);
    const zeroPrior = await seed('ZERO_PRIOR', 0, -1);
    expect(await codesFor(atBoundary.presentID)).not.toContain('2');
    expect(await codesFor(beyondBoundary.presentID)).toContain('2');
    expect(await codesFor(zeroPrior.presentID)).not.toContain('2');
  });

  it('retains active, prior-validated, pending, and status-exempt selection rules', async () => {
    const dead = await seed('DEAD', 100, 170, undefined, undefined, 'D');
    const inactive = await seed('INACTIVE', 100, 170);
    const priorUnvalidated = await seed('PRIOR_UNVALIDATED', 100, 170);
    const completed = await seed('COMPLETED', 100, 170);
    await connection.query('UPDATE coremeasurements SET IsActive = FALSE WHERE CoreMeasurementID = ?', [inactive.presentID]);
    await connection.query('UPDATE coremeasurements SET IsValidated = FALSE WHERE CoreMeasurementID = ?', [priorUnvalidated.priorID]);
    await connection.query('UPDATE coremeasurements SET IsValidated = TRUE WHERE CoreMeasurementID = ?', [completed.presentID]);
    for (const id of [dead.presentID, inactive.presentID, priorUnvalidated.presentID, completed.presentID]) expect(await codesFor(id)).not.toContain('1');
  });

  it('cleans temporary tables and leaves a caller transaction rollback-safe after a runner failure', async () => {
    const { presentID } = await seed('ATOMIC', 100, 170);
    const [before] = await connection.query<RowDataPacket[]>('SELECT COUNT(*) AS count FROM measurement_error_log WHERE MeasurementID = ?', [presentID]);
    const [saved] = await connection.query<RowDataPacket[]>('SHOW CREATE PROCEDURE RunSharedDBHChangeValidations');
    const savedDefinition = String(saved[0]['Create Procedure']);
    const failingDefinition = savedDefinition.replace(
      /    DROP TEMPORARY TABLE IF EXISTS dbh_change_candidates;\s+    DROP TEMPORARY TABLE IF EXISTS dbh_change_pairs;\s+END$/m,
      "    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'rollback fixture failure after upsert';\n    DROP TEMPORARY TABLE IF EXISTS dbh_change_candidates;\n    DROP TEMPORARY TABLE IF EXISTS dbh_change_pairs;\nEND"
    );
    expect(failingDefinition).not.toBe(savedDefinition);
    try {
      await connection.query('DROP PROCEDURE RunSharedDBHChangeValidations');
      await connection.query(failingDefinition);
      await connection.beginTransaction();
      await expect(connection.query('CALL RunSharedDBHChangeValidations(?, ?, 1, 1)', [census2ID, plotID])).rejects.toThrow(/fixture failure/);
      await connection.rollback();
    } finally {
      await connection.query('DROP PROCEDURE IF EXISTS RunSharedDBHChangeValidations');
      await connection.query(savedDefinition);
    }
    const [after] = await connection.query<RowDataPacket[]>('SELECT COUNT(*) AS count FROM measurement_error_log WHERE MeasurementID = ?', [presentID]);
    expect(after[0].count).toBe(before[0].count);
    await expect(connection.query('SELECT * FROM dbh_change_pairs')).rejects.toThrow();
    await expect(connection.query('SELECT * FROM dbh_change_candidates')).rejects.toThrow();
  });
});
