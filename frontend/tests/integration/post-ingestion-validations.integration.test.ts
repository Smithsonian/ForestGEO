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
  cleanupTestMeasurements,
  insertDirectMeasurements,
  insertCrossCensusMeasurements,
  setupTwoCensusScenario,
  getValidationErrors,
  seedStatusAttributes,
  seedSpeciesWithLimits,
  runValidationForTest,
  runAllValidationsForTest,
  log,
  type TestData,
  type CensusInfo
} from '../setup/local-db-setup';
import type { Connection, RowDataPacket } from 'mysql2/promise';

const VALIDATION_IDS = {
  DBH_GROWTH_EXCEEDS_MAX: 1,
  DBH_SHRINKAGE_EXCEEDS_MAX: 2,
  DUPLICATE_QUADRAT_NAMES: 4,
  DUPLICATE_TREE_STEM_TAGS: 5,
  OUTSIDE_CENSUS_DATE_BOUNDS: 6,
  DIFFERENT_SPECIES_SAME_TREE: 7,
  STEMS_OUTSIDE_PLOTS: 8,
  STEMS_IN_DIFFERENT_QUADRATS: 9,
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
    await teardownTestDatabase(connection, config);
  });

  beforeEach(async () => {
    await cleanupTestMeasurements(connection, testData);
  });

  describe('Validation Framework', () => {
    it('should load validation definitions from sitespecificvalidations table', async () => {
      const [rows] = await connection.query<RowDataPacket[]>(
        'SELECT ValidationID, ProcedureName, IsEnabled FROM sitespecificvalidations ORDER BY ValidationID'
      );

      expect(rows.length).toBeGreaterThan(0);

      const enabledValidations = rows.filter((r) => r.IsEnabled);
      expect(enabledValidations.length).toBeGreaterThanOrEqual(10);

      log.debug('Loaded validations:', rows.map((r) => `${r.ValidationID}: ${r.ProcedureName}`));
    });

    it('should successfully run all enabled validations', async () => {
      const ranValidations = await runAllValidationsForTest(connection, {
        censusID: census1.censusID,
        plotID
      });

      expect(ranValidations.length).toBeGreaterThan(0);
      log.debug('Successfully executed validations:', ranValidations);

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

      log.debug(
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

    /**
     * BOUNDARY TEST: Exactly 65mm growth
     * This tests the threshold boundary to verify > vs >= behavior.
     * Expected: Exactly 65mm should NOT trigger (validation is for >65mm)
     */
    it('should NOT flag DBH growth of exactly 65mm (boundary test)', async () => {
      const speciesCode = testData.species[0]?.SpeciesCode || testData.species[0]?.Mnemonic;
      const quadratName = testData.quadrats[0]?.QuadratName || testData.quadrats[0]?.Quadrat;

      if (!speciesCode || !quadratName) {
        throw new Error('Test setup failed: missing species or quadrat data');
      }

      const exactThresholdGrowth = DBH_GROWTH_THRESHOLD_MM; // Exactly 65mm

      await insertCrossCensusMeasurements(connection, testData, census1.censusID, census2.censusID, [
        {
          treeTag: 'EXACT65MM',
          stemTag: 'S001',
          speciesCode,
          quadratName,
          x: 3.0,
          y: 3.0,
          census1DBH: 100,
          census2DBH: 100 + exactThresholdGrowth,
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
        validationID: VALIDATION_IDS.DBH_GROWTH_EXCEEDS_MAX,
        treeTag: 'EXACT65MM'
      });

      // Exactly 65mm should NOT trigger - validation is for EXCEEDS (>65mm)
      expect(errors.length).toBe(0);
    });

    /**
     * BOUNDARY TEST: 65.1mm growth (just over threshold)
     * This confirms the validation triggers at the boundary.
     */
    it('should flag DBH growth of 65.1mm (just over boundary)', async () => {
      const speciesCode = testData.species[0]?.SpeciesCode || testData.species[0]?.Mnemonic;
      const quadratName = testData.quadrats[0]?.QuadratName || testData.quadrats[0]?.Quadrat;

      if (!speciesCode || !quadratName) {
        throw new Error('Test setup failed: missing species or quadrat data');
      }

      const justOverThreshold = 65.1;

      await insertCrossCensusMeasurements(connection, testData, census1.censusID, census2.censusID, [
        {
          treeTag: 'OVER65MM',
          stemTag: 'S001',
          speciesCode,
          quadratName,
          x: 4.0,
          y: 4.0,
          census1DBH: 100,
          census2DBH: 100 + justOverThreshold,
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
        validationID: VALIDATION_IDS.DBH_GROWTH_EXCEEDS_MAX,
        treeTag: 'OVER65MM'
      });

      // 65.1mm SHOULD trigger - just over threshold
      expect(errors.length).toBeGreaterThan(0);
    });

    it('should NOT flag growth when the current measurement also has a dead status code', async () => {
      const speciesCode = testData.species[0]?.SpeciesCode || testData.species[0]?.Mnemonic;
      const quadratName = testData.quadrats[0]?.QuadratName || testData.quadrats[0]?.Quadrat;

      if (!speciesCode || !quadratName) {
        throw new Error('Test setup failed: missing species or quadrat data');
      }

      const inserted = await insertCrossCensusMeasurements(connection, testData, census1.censusID, census2.censusID, [
        {
          treeTag: 'GROWTHDEAD01',
          stemTag: 'S001',
          speciesCode,
          quadratName,
          x: 6.0,
          y: 6.0,
          census1DBH: 100,
          census2DBH: 200,
          hom: 1.3,
          census1Date: '2024-06-15',
          census2Date: '2025-06-15',
          codes: 'A'
        }
      ]);

      await connection.query(
        'INSERT INTO cmattributes (CoreMeasurementID, Code) VALUES (?, ?)',
        [inserted.census2MeasurementIDs[0], 'D']
      );

      await runValidationForTest(connection, VALIDATION_IDS.DBH_GROWTH_EXCEEDS_MAX, {
        censusID: census2.censusID,
        plotID
      });

      const errors = await getValidationErrors(connection, {
        validationID: VALIDATION_IDS.DBH_GROWTH_EXCEEDS_MAX,
        treeTag: 'GROWTHDEAD01'
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

      log.debug(
        `ValidationID ${VALIDATION_IDS.DBH_SHRINKAGE_EXCEEDS_MAX}: Detected ${shrinkagePercent}% shrinkage (threshold: ${DBH_SHRINKAGE_THRESHOLD_PERCENT}%)`
      );
    });

    it('should NOT flag normal DBH shrinkage under 5%', async () => {
      const speciesCode = testData.species[0]?.SpeciesCode || testData.species[0]?.Mnemonic;
      const quadratName = testData.quadrats[0]?.QuadratName || testData.quadrats[0]?.Quadrat;

      if (!speciesCode || !quadratName) {
        throw new Error('Test setup failed: missing species or quadrat data');
      }

      const census1DBH = 100;
      const census2DBH = 97; // 3% shrinkage - under 5% threshold

      await insertCrossCensusMeasurements(connection, testData, census1.censusID, census2.censusID, [
        {
          treeTag: 'SMALLSHRINK001',
          stemTag: 'S001',
          speciesCode,
          quadratName,
          x: 11.0,
          y: 11.0,
          census1DBH,
          census2DBH,
          hom: 1.3,
          census1Date: '2024-06-15',
          census2Date: '2025-06-15',
          codes: 'A'
        }
      ]);

      await runValidationForTest(connection, VALIDATION_IDS.DBH_SHRINKAGE_EXCEEDS_MAX, {
        censusID: census2.censusID,
        plotID
      });

      const errors = await getValidationErrors(connection, {
        validationID: VALIDATION_IDS.DBH_SHRINKAGE_EXCEEDS_MAX
      });

      expect(errors.length).toBe(0);
    });

    /**
     * BOUNDARY TEST: Exactly 5% shrinkage
     * This tests the threshold boundary to verify > vs >= behavior.
     * Expected: Exactly 5% should NOT trigger (validation is for >5%)
     */
    it('should NOT flag DBH shrinkage of exactly 5% (boundary test)', async () => {
      const speciesCode = testData.species[0]?.SpeciesCode || testData.species[0]?.Mnemonic;
      const quadratName = testData.quadrats[0]?.QuadratName || testData.quadrats[0]?.Quadrat;

      if (!speciesCode || !quadratName) {
        throw new Error('Test setup failed: missing species or quadrat data');
      }

      // Exactly 5% shrinkage: 100 -> 95
      const census1DBH = 100;
      const census2DBH = 95; // Exactly 5% shrinkage

      await insertCrossCensusMeasurements(connection, testData, census1.censusID, census2.censusID, [
        {
          treeTag: 'EXACT5PCT',
          stemTag: 'S001',
          speciesCode,
          quadratName,
          x: 12.0,
          y: 12.0,
          census1DBH,
          census2DBH,
          hom: 1.3,
          census1Date: '2024-06-15',
          census2Date: '2025-06-15',
          codes: 'A'
        }
      ]);

      await runValidationForTest(connection, VALIDATION_IDS.DBH_SHRINKAGE_EXCEEDS_MAX, {
        censusID: census2.censusID,
        plotID
      });

      const errors = await getValidationErrors(connection, {
        validationID: VALIDATION_IDS.DBH_SHRINKAGE_EXCEEDS_MAX,
        treeTag: 'EXACT5PCT'
      });

      // Exactly 5% should NOT trigger - validation is for EXCEEDS (>5%)
      expect(errors.length).toBe(0);
    });

    /**
     * BOUNDARY TEST: 5.1% shrinkage (just over threshold)
     * This confirms the validation triggers at the boundary.
     */
    it('should flag DBH shrinkage of 5.1% (just over boundary)', async () => {
      const speciesCode = testData.species[0]?.SpeciesCode || testData.species[0]?.Mnemonic;
      const quadratName = testData.quadrats[0]?.QuadratName || testData.quadrats[0]?.Quadrat;

      if (!speciesCode || !quadratName) {
        throw new Error('Test setup failed: missing species or quadrat data');
      }

      // 5.1% shrinkage: 100 -> 94.9
      const census1DBH = 100;
      const census2DBH = 94.9; // 5.1% shrinkage

      await insertCrossCensusMeasurements(connection, testData, census1.censusID, census2.censusID, [
        {
          treeTag: 'OVER5PCT',
          stemTag: 'S001',
          speciesCode,
          quadratName,
          x: 13.0,
          y: 13.0,
          census1DBH,
          census2DBH,
          hom: 1.3,
          census1Date: '2024-06-15',
          census2Date: '2025-06-15',
          codes: 'A'
        }
      ]);

      await runValidationForTest(connection, VALIDATION_IDS.DBH_SHRINKAGE_EXCEEDS_MAX, {
        censusID: census2.censusID,
        plotID
      });

      const errors = await getValidationErrors(connection, {
        validationID: VALIDATION_IDS.DBH_SHRINKAGE_EXCEEDS_MAX,
        treeTag: 'OVER5PCT'
      });

      // 5.1% SHOULD trigger - just over threshold
      expect(errors.length).toBeGreaterThan(0);
    });

    it('should NOT flag shrinkage when the previous-census measurement has a dead status code', async () => {
      const speciesCode = testData.species[0]?.SpeciesCode || testData.species[0]?.Mnemonic;
      const quadratName = testData.quadrats[0]?.QuadratName || testData.quadrats[0]?.Quadrat;

      if (!speciesCode || !quadratName) {
        throw new Error('Test setup failed: missing species or quadrat data');
      }

      const inserted = await insertCrossCensusMeasurements(connection, testData, census1.censusID, census2.censusID, [
        {
          treeTag: 'SHRINKDEAD01',
          stemTag: 'S001',
          speciesCode,
          quadratName,
          x: 14.0,
          y: 14.0,
          census1DBH: 200,
          census2DBH: 100,
          hom: 1.3,
          census1Date: '2024-06-15',
          census2Date: '2025-06-15',
          codes: 'A'
        }
      ]);

      await connection.query(
        'INSERT INTO cmattributes (CoreMeasurementID, Code) VALUES (?, ?)',
        [inserted.census1MeasurementIDs[0], 'D']
      );

      await runValidationForTest(connection, VALIDATION_IDS.DBH_SHRINKAGE_EXCEEDS_MAX, {
        censusID: census2.censusID,
        plotID
      });

      const errors = await getValidationErrors(connection, {
        validationID: VALIDATION_IDS.DBH_SHRINKAGE_EXCEEDS_MAX,
        treeTag: 'SHRINKDEAD01'
      });

      expect(errors.length).toBe(0);
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

    it('should NOT flag measurements with dates within census bounds', async () => {
      const speciesCode = testData.species[0]?.SpeciesCode || testData.species[0]?.Mnemonic;
      const quadratName = testData.quadrats[0]?.QuadratName || testData.quadrats[0]?.Quadrat;

      if (!speciesCode || !quadratName) {
        throw new Error('Test setup failed: missing species or quadrat data');
      }

      // Census 1 bounds: 2024-01-01 to 2024-12-31
      await insertDirectMeasurements(connection, testData, census1.censusID, [
        {
          treeTag: 'DATEIN001',
          stemTag: 'S001',
          speciesCode,
          quadratName,
          x: 6.0,
          y: 6.0,
          dbh: 100,
          hom: 1.3,
          date: '2024-06-15', // Within census bounds
          codes: 'A'
        }
      ]);

      await connection.query('UPDATE coremeasurements SET IsValidated = NULL');

      await runValidationForTest(connection, VALIDATION_IDS.OUTSIDE_CENSUS_DATE_BOUNDS, {
        censusID: census1.censusID,
        plotID
      });

      const errors = await getValidationErrors(connection, {
        validationID: VALIDATION_IDS.OUTSIDE_CENSUS_DATE_BOUNDS
      });

      expect(errors.length).toBe(0);
    });

    /**
     * BOUNDARY TEST: Date exactly on census start date
     * Census 1 bounds: 2024-01-01 to 2024-12-31
     * Expected: Date exactly on start boundary should be valid
     */
    it('should NOT flag measurement on exactly census start date (boundary test)', async () => {
      const speciesCode = testData.species[0]?.SpeciesCode || testData.species[0]?.Mnemonic;
      const quadratName = testData.quadrats[0]?.QuadratName || testData.quadrats[0]?.Quadrat;

      if (!speciesCode || !quadratName) {
        throw new Error('Test setup failed: missing species or quadrat data');
      }

      await insertDirectMeasurements(connection, testData, census1.censusID, [
        {
          treeTag: 'STARTDATE01',
          stemTag: 'S001',
          speciesCode,
          quadratName,
          x: 7.0,
          y: 7.0,
          dbh: 100,
          hom: 1.3,
          date: '2024-01-01', // Exactly on census start date
          codes: 'A'
        }
      ]);

      await connection.query('UPDATE coremeasurements SET IsValidated = NULL');

      await runValidationForTest(connection, VALIDATION_IDS.OUTSIDE_CENSUS_DATE_BOUNDS, {
        censusID: census1.censusID,
        plotID
      });

      const errors = await getValidationErrors(connection, {
        validationID: VALIDATION_IDS.OUTSIDE_CENSUS_DATE_BOUNDS,
        treeTag: 'STARTDATE01'
      });

      // Exactly on start date should be valid
      expect(errors.length).toBe(0);
    });

    /**
     * BOUNDARY TEST: Date exactly on census end date
     * Census 1 bounds: 2024-01-01 to 2024-12-31
     * Expected: Date exactly on end boundary should be valid
     */
    it('should NOT flag measurement on exactly census end date (boundary test)', async () => {
      const speciesCode = testData.species[0]?.SpeciesCode || testData.species[0]?.Mnemonic;
      const quadratName = testData.quadrats[0]?.QuadratName || testData.quadrats[0]?.Quadrat;

      if (!speciesCode || !quadratName) {
        throw new Error('Test setup failed: missing species or quadrat data');
      }

      await insertDirectMeasurements(connection, testData, census1.censusID, [
        {
          treeTag: 'ENDDATE01',
          stemTag: 'S001',
          speciesCode,
          quadratName,
          x: 8.0,
          y: 8.0,
          dbh: 100,
          hom: 1.3,
          date: '2024-12-31', // Exactly on census end date
          codes: 'A'
        }
      ]);

      await connection.query('UPDATE coremeasurements SET IsValidated = NULL');

      await runValidationForTest(connection, VALIDATION_IDS.OUTSIDE_CENSUS_DATE_BOUNDS, {
        censusID: census1.censusID,
        plotID
      });

      const errors = await getValidationErrors(connection, {
        validationID: VALIDATION_IDS.OUTSIDE_CENSUS_DATE_BOUNDS,
        treeTag: 'ENDDATE01'
      });

      // Exactly on end date should be valid
      expect(errors.length).toBe(0);
    });

    /**
     * BOUNDARY TEST: Date one day before census start
     * Census 1 bounds: 2024-01-01 to 2024-12-31
     * Expected: 2023-12-31 should be flagged as outside bounds
     */
    it('should flag measurement one day before census start (boundary test)', async () => {
      const speciesCode = testData.species[0]?.SpeciesCode || testData.species[0]?.Mnemonic;
      const quadratName = testData.quadrats[0]?.QuadratName || testData.quadrats[0]?.Quadrat;

      if (!speciesCode || !quadratName) {
        throw new Error('Test setup failed: missing species or quadrat data');
      }

      await insertDirectMeasurements(connection, testData, census1.censusID, [
        {
          treeTag: 'PRESTART01',
          stemTag: 'S001',
          speciesCode,
          quadratName,
          x: 9.0,
          y: 9.0,
          dbh: 100,
          hom: 1.3,
          date: '2023-12-31', // One day before census start
          codes: 'A'
        }
      ]);

      await connection.query('UPDATE coremeasurements SET IsValidated = NULL');

      await runValidationForTest(connection, VALIDATION_IDS.OUTSIDE_CENSUS_DATE_BOUNDS, {
        censusID: census1.censusID,
        plotID
      });

      const errors = await getValidationErrors(connection, {
        validationID: VALIDATION_IDS.OUTSIDE_CENSUS_DATE_BOUNDS,
        treeTag: 'PRESTART01'
      });

      // One day before start should be flagged
      expect(errors.length).toBeGreaterThan(0);
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

      log.debug(
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

    it('should NOT flag DBH within species limits', async () => {
      const quadratName = testData.quadrats[0]?.QuadratName || testData.quadrats[0]?.Quadrat;

      if (!quadratName) {
        throw new Error('Test setup failed: missing quadrat data');
      }

      // TESTSP02 has minDBH=20, maxDBH=300
      await insertDirectMeasurements(connection, testData, census1.censusID, [
        {
          treeTag: 'DBHOK01',
          stemTag: 'S001',
          speciesCode: 'TESTSP02',
          quadratName,
          x: 7.0,
          y: 7.0,
          dbh: 150, // Within limits (20-300)
          hom: 1.3,
          date: '2024-06-15',
          codes: 'A'
        }
      ]);

      await connection.query('UPDATE coremeasurements SET IsValidated = NULL');

      await runValidationForTest(connection, VALIDATION_IDS.DBH_OUTSIDE_SPECIES_LIMITS, {
        censusID: census1.censusID,
        plotID
      });

      const errors = await getValidationErrors(connection, {
        validationID: VALIDATION_IDS.DBH_OUTSIDE_SPECIES_LIMITS
      });

      expect(errors.length).toBe(0);
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

    it('should NOT flag stems with valid coordinates within plot bounds', async () => {
      const speciesCode = testData.species[0]?.SpeciesCode || testData.species[0]?.Mnemonic;
      const quadratName = testData.quadrats[0]?.QuadratName || testData.quadrats[0]?.Quadrat;

      if (!speciesCode || !quadratName) {
        throw new Error('Test setup failed: missing species or quadrat data');
      }

      await insertDirectMeasurements(connection, testData, census1.censusID, [
        {
          treeTag: 'INSIDE01',
          stemTag: 'S001',
          speciesCode,
          quadratName,
          x: 5.0, // Valid positive coordinate
          y: 5.0, // Valid positive coordinate
          dbh: 100,
          hom: 1.3,
          date: '2024-06-15',
          codes: 'A'
        }
      ]);

      await connection.query('UPDATE coremeasurements SET IsValidated = NULL');

      await runValidationForTest(connection, VALIDATION_IDS.STEMS_OUTSIDE_PLOTS, {
        censusID: census1.censusID,
        plotID
      });

      const errors = await getValidationErrors(connection, {
        validationID: VALIDATION_IDS.STEMS_OUTSIDE_PLOTS
      });

      expect(errors.length).toBe(0);
    });
  });

  describe('ValidationID 4: Duplicate Quadrat Names', () => {
    it('should flag measurements in quadrats with duplicate names', async () => {
      const speciesCode = testData.species[0]?.SpeciesCode || testData.species[0]?.Mnemonic;

      if (!speciesCode) {
        throw new Error('Test setup failed: missing species data');
      }

      // Get the original quadrat
      const duplicateQuadratName = testData.quadrats[0]?.QuadratName || testData.quadrats[0]?.Quadrat;
      const [origQuadratRows] = await connection.query<RowDataPacket[]>(
        'SELECT QuadratID FROM quadrats WHERE QuadratName = ? AND PlotID = ?',
        [duplicateQuadratName, plotID]
      );
      const origQuadratID = origQuadratRows[0].QuadratID;

      // Create a SECOND quadrat with the SAME name but different ID
      await connection.query(
        `INSERT INTO quadrats (PlotID, QuadratName, StartX, StartY, DimensionX, DimensionY, Area, QuadratShape, IsActive)
         VALUES (?, ?, 100, 100, 20, 20, 400, 'square', 1)`,
        [plotID, duplicateQuadratName]
      );
      const [newQuadratRows] = await connection.query<RowDataPacket[]>(
        'SELECT QuadratID FROM quadrats WHERE PlotID = ? AND StartX = 100 AND StartY = 100',
        [plotID]
      );
      const newQuadratID = newQuadratRows[0].QuadratID;

      const [speciesRows] = await connection.query<RowDataPacket[]>(
        'SELECT SpeciesID FROM species WHERE SpeciesCode = ?',
        [speciesCode]
      );
      const speciesID = speciesRows[0].SpeciesID;

      // Create measurement in ORIGINAL quadrat (needed for validation to detect duplicate names)
      await connection.query(
        'INSERT INTO trees (TreeTag, SpeciesID, CensusID, IsActive) VALUES (?, ?, ?, 1)',
        ['DUPQUAD01', speciesID, census1.censusID]
      );
      const [tree1Rows] = await connection.query<RowDataPacket[]>('SELECT LAST_INSERT_ID() as TreeID');
      const tree1ID = tree1Rows[0].TreeID;

      await connection.query(
        `INSERT INTO stems (TreeID, QuadratID, CensusID, StemTag, LocalX, LocalY, IsActive)
         VALUES (?, ?, ?, 'S001', 5.0, 5.0, 1)`,
        [tree1ID, origQuadratID, census1.censusID]
      );
      const [stem1Rows] = await connection.query<RowDataPacket[]>('SELECT LAST_INSERT_ID() as StemGUID');
      await connection.query(
        `INSERT INTO coremeasurements (StemGUID, CensusID, MeasuredDBH, MeasuredHOM, MeasurementDate, IsValidated, IsActive)
         VALUES (?, ?, 100, 1.3, '2024-06-15', NULL, 1)`,
        [stem1Rows[0].StemGUID, census1.censusID]
      );

      // Create measurement in DUPLICATE quadrat (same name, different QuadratID)
      await connection.query(
        'INSERT INTO trees (TreeTag, SpeciesID, CensusID, IsActive) VALUES (?, ?, ?, 1)',
        ['DUPQUAD02', speciesID, census1.censusID]
      );
      const [tree2Rows] = await connection.query<RowDataPacket[]>('SELECT LAST_INSERT_ID() as TreeID');
      const tree2ID = tree2Rows[0].TreeID;

      await connection.query(
        `INSERT INTO stems (TreeID, QuadratID, CensusID, StemTag, LocalX, LocalY, IsActive)
         VALUES (?, ?, ?, 'S001', 5.0, 5.0, 1)`,
        [tree2ID, newQuadratID, census1.censusID]
      );
      const [stem2Rows] = await connection.query<RowDataPacket[]>('SELECT LAST_INSERT_ID() as StemGUID');
      await connection.query(
        `INSERT INTO coremeasurements (StemGUID, CensusID, MeasuredDBH, MeasuredHOM, MeasurementDate, IsValidated, IsActive)
         VALUES (?, ?, 110, 1.3, '2024-06-15', NULL, 1)`,
        [stem2Rows[0].StemGUID, census1.censusID]
      );

      const validationRan = await runValidationForTest(connection, VALIDATION_IDS.DUPLICATE_QUADRAT_NAMES, {
        censusID: census1.censusID,
        plotID
      });

      expect(validationRan).toBe(true);

      const errors = await getValidationErrors(connection, {
        validationID: VALIDATION_IDS.DUPLICATE_QUADRAT_NAMES
      });

      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].ValidationErrorID).toBe(VALIDATION_IDS.DUPLICATE_QUADRAT_NAMES);

      log.debug(`ValidationID ${VALIDATION_IDS.DUPLICATE_QUADRAT_NAMES}: Detected duplicate quadrat name '${duplicateQuadratName}' (QuadratIDs: ${origQuadratID}, ${newQuadratID})`);
    });

    it('should NOT flag measurements when all quadrat names are unique', async () => {
      const speciesCode = testData.species[0]?.SpeciesCode || testData.species[0]?.Mnemonic;
      const quadratName = testData.quadrats[0]?.QuadratName || testData.quadrats[0]?.Quadrat;

      if (!speciesCode || !quadratName) {
        throw new Error('Test setup failed: missing species or quadrat data');
      }

      // Just insert a normal measurement with a unique quadrat name
      await insertDirectMeasurements(connection, testData, census1.censusID, [
        {
          treeTag: 'UNIQQUAD01',
          stemTag: 'S001',
          speciesCode,
          quadratName,
          x: 5.0,
          y: 5.0,
          dbh: 100,
          hom: 1.3,
          date: '2024-06-15',
          codes: 'A'
        }
      ]);

      await connection.query('UPDATE coremeasurements SET IsValidated = NULL');

      await runValidationForTest(connection, VALIDATION_IDS.DUPLICATE_QUADRAT_NAMES, {
        censusID: census1.censusID,
        plotID
      });

      const errors = await getValidationErrors(connection, {
        validationID: VALIDATION_IDS.DUPLICATE_QUADRAT_NAMES
      });

      expect(errors.length).toBe(0);
    });
  });

  describe('ValidationID 5: Duplicate Tree/Stem Tag Combinations', () => {
    it('should flag duplicate TreeTag+StemTag combinations in same census', async () => {
      // Use two different species to avoid unique constraint on trees table
      // (ux_trees_treetag_speciesid_censusid allows same TreeTag with different SpeciesID)
      const species1Code = testData.species[0]?.SpeciesCode || testData.species[0]?.Mnemonic;
      const species2Code = testData.species[1]?.SpeciesCode || testData.species[1]?.Mnemonic;
      const quadratName = testData.quadrats[0]?.QuadratName || testData.quadrats[0]?.Quadrat;

      if (!species1Code || !species2Code || !quadratName) {
        throw new Error('Test setup failed: need at least 2 species and 1 quadrat');
      }

      const [quadratRows] = await connection.query<RowDataPacket[]>(
        'SELECT QuadratID FROM quadrats WHERE QuadratName = ? AND PlotID = ?',
        [quadratName, plotID]
      );
      const quadratID = quadratRows[0].QuadratID;

      const [species1Rows] = await connection.query<RowDataPacket[]>(
        'SELECT SpeciesID FROM species WHERE SpeciesCode = ?',
        [species1Code]
      );
      const species1ID = species1Rows[0].SpeciesID;

      const [species2Rows] = await connection.query<RowDataPacket[]>(
        'SELECT SpeciesID FROM species WHERE SpeciesCode = ?',
        [species2Code]
      );
      const species2ID = species2Rows[0].SpeciesID;

      // Create first tree with TreeTag='DUPTAG01', species1
      await connection.query(
        'INSERT INTO trees (TreeTag, SpeciesID, CensusID, IsActive) VALUES (?, ?, ?, 1)',
        ['DUPTAG01', species1ID, census1.censusID]
      );
      const [tree1Rows] = await connection.query<RowDataPacket[]>('SELECT LAST_INSERT_ID() as TreeID');
      const tree1ID = tree1Rows[0].TreeID;

      // Create first stem with StemTag='S001'
      await connection.query(
        `INSERT INTO stems (TreeID, QuadratID, CensusID, StemTag, LocalX, LocalY, IsActive)
         VALUES (?, ?, ?, 'S001', 5.0, 5.0, 1)`,
        [tree1ID, quadratID, census1.censusID]
      );
      const [stem1Rows] = await connection.query<RowDataPacket[]>('SELECT LAST_INSERT_ID() as StemGUID');
      const stem1GUID = stem1Rows[0].StemGUID;

      // Create first measurement
      await connection.query(
        `INSERT INTO coremeasurements (StemGUID, CensusID, MeasuredDBH, MeasuredHOM, MeasurementDate, IsValidated, IsActive)
         VALUES (?, ?, 100, 1.3, '2024-06-15', NULL, 1)`,
        [stem1GUID, census1.censusID]
      );

      // Create second tree with SAME TreeTag='DUPTAG01' but different species (allowed by unique constraint)
      await connection.query(
        'INSERT INTO trees (TreeTag, SpeciesID, CensusID, IsActive) VALUES (?, ?, ?, 1)',
        ['DUPTAG01', species2ID, census1.censusID]
      );
      const [tree2Rows] = await connection.query<RowDataPacket[]>('SELECT LAST_INSERT_ID() as TreeID');
      const tree2ID = tree2Rows[0].TreeID;

      // Create second stem with SAME StemTag='S001'
      await connection.query(
        `INSERT INTO stems (TreeID, QuadratID, CensusID, StemTag, LocalX, LocalY, IsActive)
         VALUES (?, ?, ?, 'S001', 6.0, 6.0, 1)`,
        [tree2ID, quadratID, census1.censusID]
      );
      const [stem2Rows] = await connection.query<RowDataPacket[]>('SELECT LAST_INSERT_ID() as StemGUID');
      const stem2GUID = stem2Rows[0].StemGUID;

      // Create second measurement - now we have 2 measurements with same TreeTag+StemTag
      await connection.query(
        `INSERT INTO coremeasurements (StemGUID, CensusID, MeasuredDBH, MeasuredHOM, MeasurementDate, IsValidated, IsActive)
         VALUES (?, ?, 110, 1.3, '2024-07-15', NULL, 1)`,
        [stem2GUID, census1.censusID]
      );

      const validationRan = await runValidationForTest(connection, VALIDATION_IDS.DUPLICATE_TREE_STEM_TAGS, {
        censusID: census1.censusID,
        plotID
      });

      expect(validationRan).toBe(true);

      const errors = await getValidationErrors(connection, {
        validationID: VALIDATION_IDS.DUPLICATE_TREE_STEM_TAGS
      });

      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].ValidationErrorID).toBe(VALIDATION_IDS.DUPLICATE_TREE_STEM_TAGS);

      log.debug(`ValidationID ${VALIDATION_IDS.DUPLICATE_TREE_STEM_TAGS}: Detected duplicate TreeTag='DUPTAG01' + StemTag='S001' (species: ${species1Code}, ${species2Code})`);
    });

    it('should NOT flag when TreeTag+StemTag combinations are unique', async () => {
      const speciesCode = testData.species[0]?.SpeciesCode || testData.species[0]?.Mnemonic;
      const quadratName = testData.quadrats[0]?.QuadratName || testData.quadrats[0]?.Quadrat;

      if (!speciesCode || !quadratName) {
        throw new Error('Test setup failed: missing species or quadrat data');
      }

      // Insert two measurements with DIFFERENT tag combinations
      await insertDirectMeasurements(connection, testData, census1.censusID, [
        {
          treeTag: 'UNIQTAG01',
          stemTag: 'S001',
          speciesCode,
          quadratName,
          x: 5.0,
          y: 5.0,
          dbh: 100,
          hom: 1.3,
          date: '2024-06-15',
          codes: 'A'
        },
        {
          treeTag: 'UNIQTAG02', // Different tree tag
          stemTag: 'S001',
          speciesCode,
          quadratName,
          x: 6.0,
          y: 6.0,
          dbh: 110,
          hom: 1.3,
          date: '2024-06-15',
          codes: 'A'
        }
      ]);

      await connection.query('UPDATE coremeasurements SET IsValidated = NULL');

      await runValidationForTest(connection, VALIDATION_IDS.DUPLICATE_TREE_STEM_TAGS, {
        censusID: census1.censusID,
        plotID
      });

      const errors = await getValidationErrors(connection, {
        validationID: VALIDATION_IDS.DUPLICATE_TREE_STEM_TAGS
      });

      expect(errors.length).toBe(0);
    });
  });

  describe('ValidationID 7: Different Species on Same Tree', () => {
    it('should flag when stems of same tree have different species', async () => {
      const species1Code = testData.species[0]?.SpeciesCode || testData.species[0]?.Mnemonic;
      const species2Code = testData.species[1]?.SpeciesCode || testData.species[1]?.Mnemonic;
      const quadratName = testData.quadrats[0]?.QuadratName || testData.quadrats[0]?.Quadrat;

      if (!species1Code || !species2Code || !quadratName) {
        throw new Error('Test setup failed: need at least 2 species and 1 quadrat');
      }

      const [quadratRows] = await connection.query<RowDataPacket[]>(
        'SELECT QuadratID FROM quadrats WHERE QuadratName = ? AND PlotID = ?',
        [quadratName, plotID]
      );
      const quadratID = quadratRows[0].QuadratID;

      const [species1Rows] = await connection.query<RowDataPacket[]>(
        'SELECT SpeciesID FROM species WHERE SpeciesCode = ?',
        [species1Code]
      );
      const species1ID = species1Rows[0].SpeciesID;

      const [species2Rows] = await connection.query<RowDataPacket[]>(
        'SELECT SpeciesID FROM species WHERE SpeciesCode = ?',
        [species2Code]
      );
      const species2ID = species2Rows[0].SpeciesID;

      // Create first tree with species1
      await connection.query(
        'INSERT INTO trees (TreeTag, SpeciesID, CensusID, IsActive) VALUES (?, ?, ?, 1)',
        ['DIFFSP01', species1ID, census1.censusID]
      );
      const [tree1Rows] = await connection.query<RowDataPacket[]>('SELECT LAST_INSERT_ID() as TreeID');
      const tree1ID = tree1Rows[0].TreeID;

      // Create stem on first tree
      await connection.query(
        `INSERT INTO stems (TreeID, QuadratID, CensusID, StemTag, LocalX, LocalY, IsActive)
         VALUES (?, ?, ?, 'S001', 5.0, 5.0, 1)`,
        [tree1ID, quadratID, census1.censusID]
      );
      const [stem1Rows] = await connection.query<RowDataPacket[]>('SELECT LAST_INSERT_ID() as StemGUID');
      const stem1GUID = stem1Rows[0].StemGUID;

      // Create measurement for first stem
      await connection.query(
        `INSERT INTO coremeasurements (StemGUID, CensusID, MeasuredDBH, MeasuredHOM, MeasurementDate, IsValidated, IsActive)
         VALUES (?, ?, 100, 1.3, '2024-06-15', NULL, 1)`,
        [stem1GUID, census1.censusID]
      );

      // Create second tree with SAME TreeTag but DIFFERENT species
      await connection.query(
        'INSERT INTO trees (TreeTag, SpeciesID, CensusID, IsActive) VALUES (?, ?, ?, 1)',
        ['DIFFSP01', species2ID, census1.censusID]
      );
      const [tree2Rows] = await connection.query<RowDataPacket[]>('SELECT LAST_INSERT_ID() as TreeID');
      const tree2ID = tree2Rows[0].TreeID;

      // Create stem on second tree
      await connection.query(
        `INSERT INTO stems (TreeID, QuadratID, CensusID, StemTag, LocalX, LocalY, IsActive)
         VALUES (?, ?, ?, 'S002', 5.5, 5.5, 1)`,
        [tree2ID, quadratID, census1.censusID]
      );
      const [stem2Rows] = await connection.query<RowDataPacket[]>('SELECT LAST_INSERT_ID() as StemGUID');
      const stem2GUID = stem2Rows[0].StemGUID;

      // Create measurement for second stem
      await connection.query(
        `INSERT INTO coremeasurements (StemGUID, CensusID, MeasuredDBH, MeasuredHOM, MeasurementDate, IsValidated, IsActive)
         VALUES (?, ?, 95, 1.3, '2024-06-15', NULL, 1)`,
        [stem2GUID, census1.censusID]
      );

      const validationRan = await runValidationForTest(connection, VALIDATION_IDS.DIFFERENT_SPECIES_SAME_TREE, {
        censusID: census1.censusID,
        plotID
      });

      expect(validationRan).toBe(true);

      const errors = await getValidationErrors(connection, {
        validationID: VALIDATION_IDS.DIFFERENT_SPECIES_SAME_TREE
      });

      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].ValidationErrorID).toBe(VALIDATION_IDS.DIFFERENT_SPECIES_SAME_TREE);

      log.debug(`ValidationID ${VALIDATION_IDS.DIFFERENT_SPECIES_SAME_TREE}: Detected TreeTag='DIFFSP01' with species '${species1Code}' and '${species2Code}'`);
    });

    it('should NOT flag when all stems of same tree have same species', async () => {
      const speciesCode = testData.species[0]?.SpeciesCode || testData.species[0]?.Mnemonic;
      const quadratName = testData.quadrats[0]?.QuadratName || testData.quadrats[0]?.Quadrat;

      if (!speciesCode || !quadratName) {
        throw new Error('Test setup failed: missing species or quadrat data');
      }

      // Insert a tree with one species (normal case)
      await insertDirectMeasurements(connection, testData, census1.censusID, [
        {
          treeTag: 'SAMESP01',
          stemTag: 'S001',
          speciesCode,
          quadratName,
          x: 5.0,
          y: 5.0,
          dbh: 100,
          hom: 1.3,
          date: '2024-06-15',
          codes: 'A'
        }
      ]);

      await connection.query('UPDATE coremeasurements SET IsValidated = NULL');

      await runValidationForTest(connection, VALIDATION_IDS.DIFFERENT_SPECIES_SAME_TREE, {
        censusID: census1.censusID,
        plotID
      });

      const errors = await getValidationErrors(connection, {
        validationID: VALIDATION_IDS.DIFFERENT_SPECIES_SAME_TREE
      });

      expect(errors.length).toBe(0);
    });
  });

  describe('ValidationID 9: Stems in Different Quadrats', () => {
    it('should flag when stems of same tree are in different quadrats', async () => {
      const speciesCode = testData.species[0]?.SpeciesCode || testData.species[0]?.Mnemonic;
      const quadrat1Name = testData.quadrats[0]?.QuadratName || testData.quadrats[0]?.Quadrat;
      const quadrat2Name = testData.quadrats[1]?.QuadratName || testData.quadrats[1]?.Quadrat;

      if (!speciesCode || !quadrat1Name || !quadrat2Name) {
        throw new Error('Test setup failed: need species and at least 2 quadrats');
      }

      const [quadrat1Rows] = await connection.query<RowDataPacket[]>(
        'SELECT QuadratID FROM quadrats WHERE QuadratName = ? AND PlotID = ?',
        [quadrat1Name, plotID]
      );
      const quadrat1ID = quadrat1Rows[0].QuadratID;

      const [quadrat2Rows] = await connection.query<RowDataPacket[]>(
        'SELECT QuadratID FROM quadrats WHERE QuadratName = ? AND PlotID = ?',
        [quadrat2Name, plotID]
      );
      const quadrat2ID = quadrat2Rows[0].QuadratID;

      const [speciesRows] = await connection.query<RowDataPacket[]>(
        'SELECT SpeciesID FROM species WHERE SpeciesCode = ?',
        [speciesCode]
      );
      const speciesID = speciesRows[0].SpeciesID;

      // Create one tree
      await connection.query(
        'INSERT INTO trees (TreeTag, SpeciesID, CensusID, IsActive) VALUES (?, ?, ?, 1)',
        ['CROSSQUAD01', speciesID, census1.censusID]
      );
      const [treeRows] = await connection.query<RowDataPacket[]>('SELECT LAST_INSERT_ID() as TreeID');
      const treeID = treeRows[0].TreeID;

      // Create first stem in quadrat 1
      await connection.query(
        `INSERT INTO stems (TreeID, QuadratID, CensusID, StemTag, LocalX, LocalY, IsActive)
         VALUES (?, ?, ?, 'S001', 5.0, 5.0, 1)`,
        [treeID, quadrat1ID, census1.censusID]
      );
      const [stem1Rows] = await connection.query<RowDataPacket[]>('SELECT LAST_INSERT_ID() as StemGUID');
      const stem1GUID = stem1Rows[0].StemGUID;

      // Create measurement for first stem
      await connection.query(
        `INSERT INTO coremeasurements (StemGUID, CensusID, MeasuredDBH, MeasuredHOM, MeasurementDate, IsValidated, IsActive)
         VALUES (?, ?, 100, 1.3, '2024-06-15', NULL, 1)`,
        [stem1GUID, census1.censusID]
      );

      // Create second stem in DIFFERENT quadrat (quadrat 2)
      await connection.query(
        `INSERT INTO stems (TreeID, QuadratID, CensusID, StemTag, LocalX, LocalY, IsActive)
         VALUES (?, ?, ?, 'S002', 5.0, 5.0, 1)`,
        [treeID, quadrat2ID, census1.censusID]
      );
      const [stem2Rows] = await connection.query<RowDataPacket[]>('SELECT LAST_INSERT_ID() as StemGUID');
      const stem2GUID = stem2Rows[0].StemGUID;

      // Create measurement for second stem
      await connection.query(
        `INSERT INTO coremeasurements (StemGUID, CensusID, MeasuredDBH, MeasuredHOM, MeasurementDate, IsValidated, IsActive)
         VALUES (?, ?, 95, 1.3, '2024-06-15', NULL, 1)`,
        [stem2GUID, census1.censusID]
      );

      const validationRan = await runValidationForTest(connection, VALIDATION_IDS.STEMS_IN_DIFFERENT_QUADRATS, {
        censusID: census1.censusID,
        plotID
      });

      expect(validationRan).toBe(true);

      const errors = await getValidationErrors(connection, {
        validationID: VALIDATION_IDS.STEMS_IN_DIFFERENT_QUADRATS
      });

      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].ValidationErrorID).toBe(VALIDATION_IDS.STEMS_IN_DIFFERENT_QUADRATS);

      log.debug(`ValidationID ${VALIDATION_IDS.STEMS_IN_DIFFERENT_QUADRATS}: Detected TreeID=${treeID} with stems in '${quadrat1Name}' and '${quadrat2Name}'`);
    });

    it('should NOT flag when all stems of same tree are in same quadrat', async () => {
      const speciesCode = testData.species[0]?.SpeciesCode || testData.species[0]?.Mnemonic;
      const quadratName = testData.quadrats[0]?.QuadratName || testData.quadrats[0]?.Quadrat;

      if (!speciesCode || !quadratName) {
        throw new Error('Test setup failed: missing species or quadrat data');
      }

      // Insert a tree with stem in one quadrat (normal case)
      await insertDirectMeasurements(connection, testData, census1.censusID, [
        {
          treeTag: 'SAMEQUAD01',
          stemTag: 'S001',
          speciesCode,
          quadratName,
          x: 5.0,
          y: 5.0,
          dbh: 100,
          hom: 1.3,
          date: '2024-06-15',
          codes: 'A'
        }
      ]);

      await connection.query('UPDATE coremeasurements SET IsValidated = NULL');

      await runValidationForTest(connection, VALIDATION_IDS.STEMS_IN_DIFFERENT_QUADRATS, {
        censusID: census1.censusID,
        plotID
      });

      const errors = await getValidationErrors(connection, {
        validationID: VALIDATION_IDS.STEMS_IN_DIFFERENT_QUADRATS
      });

      expect(errors.length).toBe(0);
    });
  });
});
