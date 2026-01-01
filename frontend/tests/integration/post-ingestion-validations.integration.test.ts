/**
 * Post-Ingestion Validation Integration Tests
 *
 * These tests verify validations that run AFTER data ingestion via the API layer.
 * The validation SQL is loaded from sitespecificvalidations.Definition and executed
 * via runValidationForTest helper (mirrors runValidation in processorhelperfunctions.tsx).
 *
 * Key requirements for validation queries:
 * - Measurements must have IsValidated = NULL (not yet validated)
 * - Cross-census validations require same StemGUID across censuses
 * - cmattributes entries may be required for certain validations
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  setupTestDatabase,
  teardownTestDatabase,
  insertDirectMeasurements,
  insertCrossCensusMeasurements,
  setupTwoCensusScenario,
  getValidationErrors,
  seedStatusAttributes,
  seedSpeciesWithLimits,
  runValidationForTest,
  runAllValidationsForTest,
  type TestData,
  type CensusInfo
} from '../setup/local-db-setup';
import type { Connection, RowDataPacket } from 'mysql2/promise';

const VALIDATION_IDS = {
  DBH_GROWTH_EXCEEDS_MAX: 1,
  DBH_SHRINKAGE_EXCEEDS_MAX: 2,
  OUTSIDE_CENSUS_DATE_BOUNDS: 6,
  STEMS_OUTSIDE_PLOTS: 8,
  DBH_OUTSIDE_SPECIES_LIMITS: 11,
  ABNORMALLY_HIGH_DBH: 15
} as const;

const DBH_GROWTH_THRESHOLD_MM = 65;
const DBH_SHRINKAGE_THRESHOLD_PERCENT = 5;
const ABSOLUTE_MAX_DBH_MM = 3500;

describe('Post-Ingestion Validation Tests', () => {
  let connection: Connection;
  let testData: TestData;
  let config: { database: string };
  let census1: CensusInfo;
  let census2: CensusInfo;
  let plotID: number;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
    config = setup.config;
    plotID = testData.plots[0].plotID;

    const scenario = await setupTwoCensusScenario(connection, testData);
    census1 = scenario.census1;
    census2 = scenario.census2;

    await seedStatusAttributes(connection);

    await seedSpeciesWithLimits(
      connection,
      [
        { speciesCode: 'TESTSP01', speciesName: 'Test Species 1', minDBH: 10, maxDBH: 500 },
        { speciesCode: 'TESTSP02', speciesName: 'Test Species 2', minDBH: 20, maxDBH: 300 }
      ],
      testData
    );
  }, 90000);

  afterAll(async () => {
    await teardownTestDatabase(connection, config as any);
  });

  beforeEach(async () => {
    await connection.query('DELETE FROM cmverrors');
    await connection.query('DELETE FROM cmattributes');
    await connection.query('DELETE FROM coremeasurements');
    await connection.query('DELETE FROM stems');
    await connection.query('DELETE FROM trees');
    await connection.query('DELETE FROM failedmeasurements');
    await connection.query('DELETE FROM temporarymeasurements');
  });

  describe('Validation Framework', () => {
    it('should load validation definitions from sitespecificvalidations table', async () => {
      const [rows] = await connection.query<RowDataPacket[]>(
        'SELECT ValidationID, ProcedureName, IsEnabled FROM sitespecificvalidations ORDER BY ValidationID'
      );

      expect(rows.length).toBeGreaterThan(0);

      const enabledValidations = rows.filter((r) => r.IsEnabled);
      expect(enabledValidations.length).toBeGreaterThanOrEqual(10);

      console.log('Loaded validations:', rows.map((r) => `${r.ValidationID}: ${r.ProcedureName}`));
    });

    it('should successfully run all enabled validations', async () => {
      const ranValidations = await runAllValidationsForTest(connection, {
        censusID: census1.censusID,
        plotID
      });

      expect(ranValidations.length).toBeGreaterThan(0);
      console.log('Successfully executed validations:', ranValidations);

      expect(ranValidations).toContain(VALIDATION_IDS.DBH_GROWTH_EXCEEDS_MAX);
      expect(ranValidations).toContain(VALIDATION_IDS.DBH_SHRINKAGE_EXCEEDS_MAX);
      expect(ranValidations).toContain(VALIDATION_IDS.ABNORMALLY_HIGH_DBH);
    });
  });

  describe('ValidationID 1: DBH Growth Exceeds Maximum', () => {
    it('should flag DBH growth exceeding 65mm between censuses', async () => {
      const speciesCode = testData.species[0]?.SpeciesCode || testData.species[0]?.Mnemonic;
      const quadratName = testData.quadrats[0]?.QuadratName || testData.quadrats[0]?.Quadrat;

      if (!speciesCode || !quadratName) {
        throw new Error('Test setup failed: missing species or quadrat data');
      }

      const census1DBH = 100;
      const census2DBH = 200; // 100mm growth exceeds 65mm threshold
      const expectedGrowth = census2DBH - census1DBH;

      await insertCrossCensusMeasurements(connection, testData, census1.censusID, census2.censusID, [
        {
          treeTag: 'GROWTH001',
          stemTag: 'S001',
          speciesCode,
          quadratName,
          x: 5.0,
          y: 5.0,
          census1DBH,
          census2DBH,
          hom: 1.3,
          census1Date: '2024-06-15',
          census2Date: '2025-06-15',
          codes: 'A'
        }
      ]);

      const validationRan = await runValidationForTest(
        connection,
        VALIDATION_IDS.DBH_GROWTH_EXCEEDS_MAX,
        { censusID: census2.censusID, plotID }
      );

      expect(validationRan).toBe(true);

      const errors = await getValidationErrors(connection, {
        validationID: VALIDATION_IDS.DBH_GROWTH_EXCEEDS_MAX
      });

      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].ValidationErrorID).toBe(VALIDATION_IDS.DBH_GROWTH_EXCEEDS_MAX);

      console.log(
        `ValidationID ${VALIDATION_IDS.DBH_GROWTH_EXCEEDS_MAX}: Detected ${expectedGrowth}mm growth (threshold: ${DBH_GROWTH_THRESHOLD_MM}mm)`
      );
    });

    it('should NOT flag normal DBH growth under 65mm', async () => {
      const speciesCode = testData.species[0]?.SpeciesCode || testData.species[0]?.Mnemonic;
      const quadratName = testData.quadrats[0]?.QuadratName || testData.quadrats[0]?.Quadrat;

      if (!speciesCode || !quadratName) {
        throw new Error('Test setup failed: missing species or quadrat data');
      }

      const normalGrowth = 30; // Under 65mm threshold

      await insertCrossCensusMeasurements(connection, testData, census1.censusID, census2.censusID, [
        {
          treeTag: 'NORMGROW001',
          stemTag: 'S001',
          speciesCode,
          quadratName,
          x: 8.0,
          y: 8.0,
          census1DBH: 100,
          census2DBH: 100 + normalGrowth,
          hom: 1.3,
          census1Date: '2024-06-15',
          census2Date: '2025-06-15',
          codes: 'A'
        }
      ]);

      await runValidationForTest(connection, VALIDATION_IDS.DBH_GROWTH_EXCEEDS_MAX, {
        censusID: census2.censusID,
        plotID
      });

      const errors = await getValidationErrors(connection, {
        validationID: VALIDATION_IDS.DBH_GROWTH_EXCEEDS_MAX
      });

      expect(errors.length).toBe(0);
    });
  });

  describe('ValidationID 2: DBH Shrinkage Exceeds Maximum', () => {
    it('should flag DBH shrinkage exceeding 5% between censuses', async () => {
      const speciesCode = testData.species[0]?.SpeciesCode || testData.species[0]?.Mnemonic;
      const quadratName = testData.quadrats[0]?.QuadratName || testData.quadrats[0]?.Quadrat;

      if (!speciesCode || !quadratName) {
        throw new Error('Test setup failed: missing species or quadrat data');
      }

      const census1DBH = 200;
      const census2DBH = 100; // 50% shrinkage exceeds 5% threshold
      const shrinkagePercent = ((census1DBH - census2DBH) / census1DBH) * 100;

      await insertCrossCensusMeasurements(connection, testData, census1.censusID, census2.censusID, [
        {
          treeTag: 'SHRINK001',
          stemTag: 'S001',
          speciesCode,
          quadratName,
          x: 10.0,
          y: 10.0,
          census1DBH,
          census2DBH,
          hom: 1.3,
          census1Date: '2024-06-15',
          census2Date: '2025-06-15',
          codes: 'A'
        }
      ]);

      const validationRan = await runValidationForTest(
        connection,
        VALIDATION_IDS.DBH_SHRINKAGE_EXCEEDS_MAX,
        { censusID: census2.censusID, plotID }
      );

      expect(validationRan).toBe(true);

      const errors = await getValidationErrors(connection, {
        validationID: VALIDATION_IDS.DBH_SHRINKAGE_EXCEEDS_MAX
      });

      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].ValidationErrorID).toBe(VALIDATION_IDS.DBH_SHRINKAGE_EXCEEDS_MAX);

      console.log(
        `ValidationID ${VALIDATION_IDS.DBH_SHRINKAGE_EXCEEDS_MAX}: Detected ${shrinkagePercent}% shrinkage (threshold: ${DBH_SHRINKAGE_THRESHOLD_PERCENT}%)`
      );
    });
  });

  describe('ValidationID 6: Measurements Outside Census Date Bounds', () => {
    it('should flag measurements with dates outside census bounds', async () => {
      const speciesCode = testData.species[0]?.SpeciesCode || testData.species[0]?.Mnemonic;
      const quadratName = testData.quadrats[0]?.QuadratName || testData.quadrats[0]?.Quadrat;

      if (!speciesCode || !quadratName) {
        throw new Error('Test setup failed: missing species or quadrat data');
      }

      // Census 1 bounds: 2024-01-01 to 2024-12-31
      await insertDirectMeasurements(connection, testData, census1.censusID, [
        {
          treeTag: 'DATEOUT001',
          stemTag: 'S001',
          speciesCode,
          quadratName,
          x: 5.0,
          y: 5.0,
          dbh: 100,
          hom: 1.3,
          date: '1999-01-01', // Way outside census bounds
          codes: 'A'
        }
      ]);

      // Set IsValidated = NULL so validation query can find it
      await connection.query('UPDATE coremeasurements SET IsValidated = NULL');

      const validationRan = await runValidationForTest(connection, VALIDATION_IDS.OUTSIDE_CENSUS_DATE_BOUNDS, {
        censusID: census1.censusID,
        plotID
      });

      expect(validationRan).toBe(true);

      const errors = await getValidationErrors(connection, {
        validationID: VALIDATION_IDS.OUTSIDE_CENSUS_DATE_BOUNDS
      });

      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].ValidationErrorID).toBe(VALIDATION_IDS.OUTSIDE_CENSUS_DATE_BOUNDS);
    });
  });

  describe('ValidationID 15: Abnormally High DBH', () => {
    it('should flag DBH exceeding absolute maximum of 3500mm', async () => {
      const speciesCode = testData.species[0]?.SpeciesCode || testData.species[0]?.Mnemonic;
      const quadratName = testData.quadrats[0]?.QuadratName || testData.quadrats[0]?.Quadrat;

      if (!speciesCode || !quadratName) {
        throw new Error('Test setup failed: missing species or quadrat data');
      }

      const extremeDBH = 5000;

      await insertDirectMeasurements(connection, testData, census1.censusID, [
        {
          treeTag: 'BIGDBH001',
          stemTag: 'S001',
          speciesCode,
          quadratName,
          x: 5.0,
          y: 5.0,
          dbh: extremeDBH,
          hom: 1.3,
          date: '2024-06-15',
          codes: 'A'
        }
      ]);

      // Set IsValidated = NULL so validation query can find it
      await connection.query('UPDATE coremeasurements SET IsValidated = NULL');

      const validationRan = await runValidationForTest(connection, VALIDATION_IDS.ABNORMALLY_HIGH_DBH, {
        censusID: census1.censusID,
        plotID
      });

      expect(validationRan).toBe(true);

      const errors = await getValidationErrors(connection, {
        validationID: VALIDATION_IDS.ABNORMALLY_HIGH_DBH
      });

      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].ValidationErrorID).toBe(VALIDATION_IDS.ABNORMALLY_HIGH_DBH);

      console.log(
        `ValidationID ${VALIDATION_IDS.ABNORMALLY_HIGH_DBH}: Detected DBH=${extremeDBH}mm (threshold: ${ABSOLUTE_MAX_DBH_MM}mm)`
      );
    });

    it('should NOT flag DBH under 3500mm absolute maximum', async () => {
      const speciesCode = testData.species[0]?.SpeciesCode || testData.species[0]?.Mnemonic;
      const quadratName = testData.quadrats[0]?.QuadratName || testData.quadrats[0]?.Quadrat;

      if (!speciesCode || !quadratName) {
        throw new Error('Test setup failed: missing species or quadrat data');
      }

      const largeButValidDBH = 3000;

      await insertDirectMeasurements(connection, testData, census1.censusID, [
        {
          treeTag: 'OKDBH001',
          stemTag: 'S001',
          speciesCode,
          quadratName,
          x: 12.0,
          y: 12.0,
          dbh: largeButValidDBH,
          hom: 1.3,
          date: '2024-06-15',
          codes: 'A'
        }
      ]);

      await connection.query('UPDATE coremeasurements SET IsValidated = NULL');

      await runValidationForTest(connection, VALIDATION_IDS.ABNORMALLY_HIGH_DBH, {
        censusID: census1.censusID,
        plotID
      });

      const errors = await getValidationErrors(connection, {
        validationID: VALIDATION_IDS.ABNORMALLY_HIGH_DBH
      });

      expect(errors.length).toBe(0);
    });
  });

  describe('ValidationID 11: DBH Outside Species Limits', () => {
    it('should flag DBH below species minimum', async () => {
      const quadratName = testData.quadrats[0]?.QuadratName || testData.quadrats[0]?.Quadrat;

      if (!quadratName) {
        throw new Error('Test setup failed: missing quadrat data');
      }

      // TESTSP02 has minDBH=20, maxDBH=300
      await insertDirectMeasurements(connection, testData, census1.censusID, [
        {
          treeTag: 'DBHLIM01',
          stemTag: 'S001',
          speciesCode: 'TESTSP02',
          quadratName,
          x: 5.0,
          y: 5.0,
          dbh: 5, // Below minDBH of 20
          hom: 1.3,
          date: '2024-06-15',
          codes: 'A'
        }
      ]);

      await connection.query('UPDATE coremeasurements SET IsValidated = NULL');

      const validationRan = await runValidationForTest(connection, VALIDATION_IDS.DBH_OUTSIDE_SPECIES_LIMITS, {
        censusID: census1.censusID,
        plotID
      });

      expect(validationRan).toBe(true);

      const errors = await getValidationErrors(connection, {
        validationID: VALIDATION_IDS.DBH_OUTSIDE_SPECIES_LIMITS
      });

      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].ValidationErrorID).toBe(VALIDATION_IDS.DBH_OUTSIDE_SPECIES_LIMITS);
    });
  });

  describe('ValidationID 8: Stems Outside Plots', () => {
    it('should flag stems with negative coordinates', async () => {
      const speciesCode = testData.species[0]?.SpeciesCode || testData.species[0]?.Mnemonic;
      const quadratName = testData.quadrats[0]?.QuadratName || testData.quadrats[0]?.Quadrat;

      if (!speciesCode || !quadratName) {
        throw new Error('Test setup failed: missing species or quadrat data');
      }

      await insertDirectMeasurements(connection, testData, census1.censusID, [
        {
          treeTag: 'OUTSIDE01',
          stemTag: 'S001',
          speciesCode,
          quadratName,
          x: -50.0, // Negative X coordinate
          y: 10.0,
          dbh: 100,
          hom: 1.3,
          date: '2024-06-15',
          codes: 'A'
        }
      ]);

      await connection.query('UPDATE coremeasurements SET IsValidated = NULL');

      const validationRan = await runValidationForTest(connection, VALIDATION_IDS.STEMS_OUTSIDE_PLOTS, {
        censusID: census1.censusID,
        plotID
      });

      expect(validationRan).toBe(true);

      const errors = await getValidationErrors(connection, {
        validationID: VALIDATION_IDS.STEMS_OUTSIDE_PLOTS
      });

      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].ValidationErrorID).toBe(VALIDATION_IDS.STEMS_OUTSIDE_PLOTS);
    });
  });
});
