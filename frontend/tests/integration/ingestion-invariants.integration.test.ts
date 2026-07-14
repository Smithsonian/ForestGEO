/**
 * Ingestion invariants: a batch-scoped, table-driven pin of what bulkingestionprocess
 * REALLY does — successes, surfaced failures, exact error codes, integrity alerts, and
 * multi-stem cardinality. Every expectation is grounded in db/sql/storedprocedures.sql
 * and db/sql/tablestructures.sql (see tests/setup/ingestion-outcome.ts), never guessed,
 * so a future change that silently drops a duplicate, mislabels a code, or miscounts a
 * metric turns exactly one named assertion red.
 *
 * All reads go through the shared readIngestionOutcome/assertIngestionOutcome helper so
 * there is ONE outcome mechanism across the ingestion suites.
 *
 * SAFETY: the beforeAll REFUSING TO RUN guard hard-fails before any write if the host is
 * not local, so this can never touch a real database.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import {
  setupTestDatabase,
  teardownTestDatabase,
  cleanupTestMeasurements,
  insertTestMeasurements,
  runBulkIngestion,
  DEFAULT_TEST_CONFIG,
  type TestData,
  type TestDatabaseConfig
} from '../setup/local-db-setup';
import { readIngestionOutcome, assertIngestionOutcome, INGESTION_ERROR_CODE, INGESTION_ALERT_TYPE, type IngestionScope } from '../setup/ingestion-outcome';
import { INGESTION_SCENARIOS, type ScenarioMeasurement } from '../setup/ingestion-scenarios';

const LOCAL_HOSTS = ['127.0.0.1', 'localhost'] as const;
const MEASUREMENT_DATE = '2024-06-15';

function assertLocalHostOrRefuse(): void {
  // Copied verbatim (intent + message) from coreapifunctions-patch-atomicity.integration.test.ts.
  const host = process.env.AZURE_SQL_SERVER;
  if (!host || !LOCAL_HOSTS.includes(host as (typeof LOCAL_HOSTS)[number])) {
    throw new Error(`REFUSING TO RUN: ConnectionManager host is '${host}', not local. Aborting to avoid writing to a real database.`);
  }
  // Direct-connection suites use TEST_DB_HOST; refuse if that is not local either.
  const testHost = DEFAULT_TEST_CONFIG.host;
  if (!LOCAL_HOSTS.includes(testHost as (typeof LOCAL_HOSTS)[number])) {
    throw new Error(`REFUSING TO RUN: TEST_DB_HOST is '${testHost}', not local. Aborting to avoid writing to a real database.`);
  }
}

async function ingestScenarioRows(connection: Connection, testData: TestData, rows: ScenarioMeasurement[]): Promise<IngestionScope> {
  const censusID = testData.census[0].censusID;
  const { fileID, batchID } = await insertTestMeasurements(connection, testData, rows, { censusID });
  await runBulkIngestion(connection, fileID, batchID);
  return { fileID, batchID, censusID };
}

describe('Ingestion invariants (bulkingestionprocess)', () => {
  let connection: Connection;
  let testData: TestData;
  let config: TestDatabaseConfig;

  beforeAll(async () => {
    assertLocalHostOrRefuse();
    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
    config = setup.config;
  }, 90000);

  afterAll(async () => {
    await teardownTestDatabase(connection, config);
  });

  beforeEach(async () => {
    await cleanupTestMeasurements(connection, testData);
  });

  describe('Table-driven outcome scenarios', () => {
    it.each(INGESTION_SCENARIOS)('$name', async scenario => {
      const { rows, expected } = scenario.build(testData);
      const scope = await ingestScenarioRows(connection, testData, rows);
      const outcome = await readIngestionOutcome(connection, scope);
      // Name the scenario in the failure context for debuggability.
      try {
        assertIngestionOutcome(outcome, expected);
      } catch (err) {
        throw new Error(`Scenario "${scenario.name}" failed:\n${(err as Error).message}`);
      }
    });
  });

  describe('Multi-stem cardinality', () => {
    // The 5-stem case is required in the matrix: a tree with N distinct stem tags must
    // materialize exactly N stem rows (one tree, N stems, N measurements).
    it.each([1, 2, 5])('a tree with %i distinct stem(s) materializes exactly that many stem rows', async stemCount => {
      const treeTag = `MULTISTEM_${stemCount}`;
      const rows: ScenarioMeasurement[] = Array.from({ length: stemCount }, (_, i) => ({
        treeTag,
        stemTag: `S${i + 1}`,
        speciesCode: testData.species[0].SpeciesCode,
        quadratName: testData.quadrats[0].QuadratName,
        x: i + 1,
        y: i + 1,
        dbh: 10 + i,
        hom: 1.3,
        date: MEASUREMENT_DATE
      }));

      const scope = await ingestScenarioRows(connection, testData, rows);
      const outcome = await readIngestionOutcome(connection, scope);

      assertIngestionOutcome(outcome, {
        sourceRecords: stemCount,
        successfulRows: stemCount,
        failedRows: 0,
        remainingTemporaryRows: 0,
        metricProcessedRecords: stemCount,
        metricFailedRecords: 0,
        errorCodes: [],
        alertTypes: []
      });

      const [stemRows] = await connection.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS total FROM stems s JOIN trees t ON t.TreeID = s.TreeID
         WHERE t.TreeTag = ? AND s.CensusID = ?`,
        [treeTag, scope.censusID]
      );
      expect(Number(stemRows[0].total)).toBe(stemCount);
    });
  });

  describe('Active vs inactive reference rows', () => {
    it('resolves to the single ACTIVE species/quadrat when an inactive historical row of the same code/name also exists', async () => {
      const speciesCode = testData.species[0].SpeciesCode;
      const quadratName = testData.quadrats[0].QuadratName;
      const plotID = testData.plots[0].plotID;

      // Inactive historical rows sharing the same code/name (vary the sig fields so only
      // IsActive differs and the *_active_* uniques allow the second row).
      await connection.query(
        `INSERT INTO species (SpeciesCode, SpeciesName, IDLevel, IsActive)
         VALUES (?, 'Inactive historical variant', 'species', 0)`,
        [speciesCode]
      );
      await connection.query(
        `INSERT INTO quadrats (PlotID, QuadratName, StartX, StartY, DimensionX, DimensionY, Area, QuadratShape, IsActive)
         VALUES (?, ?, 480, 480, 20, 20, 400, 'square', 0)`,
        [plotID, quadratName]
      );

      try {
        const rows: ScenarioMeasurement[] = [
          { treeTag: 'ACTIVEONLY', stemTag: '1', speciesCode, quadratName, x: 3, y: 3, dbh: 10, hom: 1.3, date: MEASUREMENT_DATE }
        ];
        const scope = await ingestScenarioRows(connection, testData, rows);
        const outcome = await readIngestionOutcome(connection, scope);

        assertIngestionOutcome(outcome, {
          sourceRecords: 1,
          successfulRows: 1,
          failedRows: 0,
          remainingTemporaryRows: 0,
          metricProcessedRecords: 1,
          metricFailedRecords: 0,
          errorCodes: [],
          alertTypes: []
        });
        // No ambiguity code leaked in — the inactive rows were ignored, not counted.
        expect(outcome.errorCodes).not.toContain(INGESTION_ERROR_CODE.AMBIGUOUS_SPECIES);
        expect(outcome.errorCodes).not.toContain(INGESTION_ERROR_CODE.AMBIGUOUS_QUADRAT);
      } finally {
        await connection.query(`DELETE FROM species WHERE SpeciesCode = ? AND IsActive = 0`, [speciesCode]);
        await connection.query(`DELETE FROM quadrats WHERE QuadratName = ? AND PlotID = ? AND IsActive = 0`, [quadratName, plotID]);
      }
    });
  });

  describe('Unique active constraints PREVENT the ambiguous state in the normal schema', () => {
    // These prove why the ambiguity scenarios below need a constraint-dropped schema:
    // in the real schema the DB refuses to hold two active rows for one code/name.
    it('rejects a second ACTIVE species row with a duplicate SpeciesCode (uq_species_active_code)', async () => {
      const speciesCode = testData.species[0].SpeciesCode;
      await expect(
        connection.query(
          `INSERT INTO species (SpeciesCode, SpeciesName, IDLevel, IsActive)
           VALUES (?, 'Second active same code', 'species', 1)`,
          [speciesCode]
        )
      ).rejects.toThrow(/uq_species_active_code|Duplicate entry/);
    });

    it('rejects a second ACTIVE quadrat with a duplicate name in the same plot (uq_quadrats_active_name)', async () => {
      const quadratName = testData.quadrats[0].QuadratName;
      const plotID = testData.plots[0].plotID;
      await expect(
        connection.query(
          `INSERT INTO quadrats (PlotID, QuadratName, StartX, StartY, DimensionX, DimensionY, Area, QuadratShape, IsActive)
           VALUES (?, ?, 260, 260, 20, 20, 400, 'square', 1)`,
          [plotID, quadratName]
        )
      ).rejects.toThrow(/uq_quadrats_active_name|Duplicate entry/);
    });

    it('ALLOWS the same active quadrat name in a DIFFERENT plot', async () => {
      const quadratName = testData.quadrats[0].QuadratName;
      const [plotResult] = await connection.query<RowDataPacket[]>(
        `INSERT INTO plots (PlotName, LocationName, CountryName, DimensionX, DimensionY, Area, GlobalX, GlobalY, GlobalZ, PlotShape, PlotDescription)
         VALUES ('Constraint Plot 2', 'Loc', 'Panama', 500, 500, 250000, 0, 0, 0, 'square', 'second plot')`
      );
      const plot2ID = (plotResult as unknown as { insertId: number }).insertId;
      try {
        // Geometry differs from the seed Q01 so the (non-plot-scoped) uq_quadrats_full sig
        // passes; the plot-scoped uq_quadrats_active_name is the constraint under test and
        // it permits the same name in a different plot.
        await expect(
          connection.query(
            `INSERT INTO quadrats (PlotID, QuadratName, StartX, StartY, DimensionX, DimensionY, Area, QuadratShape, IsActive)
             VALUES (?, ?, 999, 999, 20, 20, 999, 'square', 1)`,
            [plot2ID, quadratName]
          )
        ).resolves.toBeDefined();
      } finally {
        await connection.query(`DELETE FROM plots WHERE PlotID = ?`, [plot2ID]);
      }
    });

    it('ALLOWS an inactive historical duplicate of an active species code / quadrat name', async () => {
      const speciesCode = testData.species[0].SpeciesCode;
      const quadratName = testData.quadrats[0].QuadratName;
      const plotID = testData.plots[0].plotID;
      try {
        await expect(
          connection.query(
            `INSERT INTO species (SpeciesCode, SpeciesName, IDLevel, IsActive)
             VALUES (?, 'Inactive dup allowed', 'species', 0)`,
            [speciesCode]
          )
        ).resolves.toBeDefined();
        await expect(
          connection.query(
            `INSERT INTO quadrats (PlotID, QuadratName, StartX, StartY, DimensionX, DimensionY, Area, QuadratShape, IsActive)
             VALUES (?, ?, 440, 440, 20, 20, 400, 'square', 0)`,
            [plotID, quadratName]
          )
        ).resolves.toBeDefined();
      } finally {
        await connection.query(`DELETE FROM species WHERE SpeciesCode = ? AND IsActive = 0`, [speciesCode]);
        await connection.query(`DELETE FROM quadrats WHERE QuadratName = ? AND PlotID = ? AND IsActive = 0`, [quadratName, plotID]);
      }
    });
  });
});

/**
 * Ambiguity is impossible in the normal schema (proven above), so this defensive suite
 * uses a THROWAWAY schema with the unique active constraints dropped, inserts TWO active
 * matching rows, and proves bulkingestionprocess surfaces the ambiguity (0 success, 1
 * failed, the real AMBIGUOUS_* code, MatchCount > 1) instead of silently fanning out.
 */
describe('Ambiguity (constraint-dropped throwaway schema)', () => {
  const AMBIGUOUS_SPECIES_CODE = 'AMBSP';
  const AMBIGUOUS_QUADRAT_NAME = 'AMBQ';

  let connection: Connection;
  let testData: TestData;
  let config: TestDatabaseConfig;
  let plotID: number;

  beforeAll(async () => {
    assertLocalHostOrRefuse();
    const throwawayConfig: TestDatabaseConfig = {
      ...DEFAULT_TEST_CONFIG,
      database: `${DEFAULT_TEST_CONFIG.database}_ambiguity`
    };
    const setup = await setupTestDatabase(throwawayConfig);
    connection = setup.connection;
    testData = setup.testData;
    config = setup.config;
    plotID = testData.plots[0].plotID;

    // Drop the constraints that normally make an ambiguous active state impossible.
    await connection.query('ALTER TABLE species DROP INDEX uq_species_active_code');
    await connection.query('ALTER TABLE quadrats DROP INDEX uq_quadrats_active_name');

    // TWO active species rows for one code (a single row cannot be ambiguous). Names differ
    // so the sig-based unique still passes; only the active-code unique was removed.
    await connection.query(
      `INSERT INTO species (SpeciesCode, SpeciesName, IDLevel, IsActive) VALUES
         (?, 'Ambiguous species one', 'species', 1),
         (?, 'Ambiguous species two', 'species', 1)`,
      [AMBIGUOUS_SPECIES_CODE, AMBIGUOUS_SPECIES_CODE]
    );
    // TWO active quadrats for one name in one plot; geometry differs to pass the full-row uniques.
    await connection.query(
      `INSERT INTO quadrats (PlotID, QuadratName, StartX, StartY, DimensionX, DimensionY, Area, QuadratShape, IsActive) VALUES
         (?, ?, 300, 300, 20, 20, 400, 'square', 1),
         (?, ?, 340, 340, 20, 20, 400, 'square', 1)`,
      [plotID, AMBIGUOUS_QUADRAT_NAME, plotID, AMBIGUOUS_QUADRAT_NAME]
    );
  }, 90000);

  afterAll(async () => {
    await teardownTestDatabase(connection, config);
  });

  afterEach(async () => {
    await cleanupTestMeasurements(connection, testData);
  });

  async function failedDescription(scope: IngestionScope): Promise<string> {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT Description FROM coremeasurements
       WHERE UploadFileID = ? AND UploadBatchID = ? AND CensusID = ? AND StemGUID IS NULL
       LIMIT 1`,
      [scope.fileID, scope.batchID, scope.censusID]
    );
    return String(rows[0]?.Description ?? '');
  }

  it('surfaces AMBIGUOUS_SPECIES (MatchCount > 1) when a code resolves to two active species', async () => {
    const censusID = testData.census[0].censusID;
    const { fileID, batchID } = await insertTestMeasurements(
      connection,
      testData,
      [
        {
          treeTag: 'AMB_SP_ROW',
          stemTag: '1',
          speciesCode: AMBIGUOUS_SPECIES_CODE,
          quadratName: testData.quadrats[0].QuadratName, // valid quadrat: quadrat is checked first
          x: 1,
          y: 1,
          dbh: 10,
          hom: 1.3,
          date: MEASUREMENT_DATE
        }
      ],
      { censusID }
    );
    await runBulkIngestion(connection, fileID, batchID);
    const scope: IngestionScope = { fileID, batchID, censusID };
    const outcome = await readIngestionOutcome(connection, scope);

    assertIngestionOutcome(outcome, {
      sourceRecords: 1,
      successfulRows: 0,
      failedRows: 1,
      remainingTemporaryRows: 0,
      metricProcessedRecords: 0,
      metricFailedRecords: 1,
      errorCodes: [INGESTION_ERROR_CODE.AMBIGUOUS_SPECIES],
      alertTypes: [INGESTION_ALERT_TYPE.INVALID_REFERENCE_DATA]
    });
    // MatchCount > 1 is recorded verbatim in the failure reason.
    expect(await failedDescription(scope)).toMatch(/Ambiguous species code.*matches 2 active/);
  });

  it('surfaces AMBIGUOUS_QUADRAT (MatchCount > 1) when a name resolves to two active quadrats', async () => {
    const censusID = testData.census[0].censusID;
    const { fileID, batchID } = await insertTestMeasurements(
      connection,
      testData,
      [
        {
          treeTag: 'AMB_Q_ROW',
          stemTag: '1',
          speciesCode: testData.species[0].SpeciesCode, // valid species
          quadratName: AMBIGUOUS_QUADRAT_NAME,
          x: 1,
          y: 1,
          dbh: 10,
          hom: 1.3,
          date: MEASUREMENT_DATE
        }
      ],
      { censusID }
    );
    await runBulkIngestion(connection, fileID, batchID);
    const scope: IngestionScope = { fileID, batchID, censusID };
    const outcome = await readIngestionOutcome(connection, scope);

    assertIngestionOutcome(outcome, {
      sourceRecords: 1,
      successfulRows: 0,
      failedRows: 1,
      remainingTemporaryRows: 0,
      metricProcessedRecords: 0,
      metricFailedRecords: 1,
      errorCodes: [INGESTION_ERROR_CODE.AMBIGUOUS_QUADRAT],
      alertTypes: [INGESTION_ALERT_TYPE.INVALID_REFERENCE_DATA]
    });
    expect(await failedDescription(scope)).toMatch(/Ambiguous quadrat name.*matches 2 active/);
  });
});
