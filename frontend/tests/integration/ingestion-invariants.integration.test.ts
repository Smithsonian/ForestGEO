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
import type { Connection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
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
import {
  readIngestionOutcome,
  assertIngestionOutcome,
  INGESTION_ERROR_CODE,
  INGESTION_ALERT_TYPE,
  ATTRIBUTE_CODE_VALIDATION_ERROR,
  type IngestionOutcome,
  type IngestionScope
} from '../setup/ingestion-outcome';
import { INGESTION_SCENARIOS, MEASUREMENT_DATE, type ScenarioMeasurement } from '../setup/ingestion-scenarios';

const LOCAL_HOSTS = ['127.0.0.1', 'localhost'] as const;

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

type BulkIngestionResult = Awaited<ReturnType<typeof runBulkIngestion>>;

async function ingestScenarioRows(
  connection: Connection,
  testData: TestData,
  rows: ScenarioMeasurement[]
): Promise<{ scope: IngestionScope; result: BulkIngestionResult }> {
  const censusID = testData.census[0].censusID;
  const { fileID, batchID } = await insertTestMeasurements(connection, testData, rows, { censusID });
  const result = await runBulkIngestion(connection, fileID, batchID);
  return { scope: { fileID, batchID, censusID }, result };
}

/**
 * Asserts an outcome, but first surfaces a swallowed procedure crash. runBulkIngestion
 * turns a hard bulkingestionprocess SQL error into {success:false, batch_failed:true},
 * which would otherwise degrade into a confusing "expected N got 0" outcome mismatch.
 * When rows were submitted yet NOTHING materialized (no success and no surfaced failure),
 * throw the procedure's own message so the real cause is diagnosable. Surfaced-failure
 * scenarios (failed rows > 0) are legitimate and pass straight through.
 */
function assertOutcome(outcome: IngestionOutcome, expected: Partial<IngestionOutcome>, result: BulkIngestionResult, submittedRowCount: number): void {
  if (submittedRowCount > 0 && outcome.successfulRows + outcome.failedRows === 0) {
    throw new Error(
      `bulkingestionprocess materialized no rows for ${submittedRowCount} submitted row(s) — likely a procedure error. ` +
        `runBulkIngestion reported: success=${result.success}, batch_failed=${result.batch_failed}, message="${result.message}"`
    );
  }
  assertIngestionOutcome(outcome, expected);
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
      const { scope, result } = await ingestScenarioRows(connection, testData, rows);
      const outcome = await readIngestionOutcome(connection, scope);
      // Name the scenario in the failure context for debuggability.
      try {
        assertOutcome(outcome, expected, result, rows.length);
      } catch (err) {
        throw new Error(`Scenario "${scenario.name}" failed:\n${(err as Error).message}`);
      }
    });
  });

  describe('Cross-batch duplicate preservation', () => {
    it('preserves an incoming correction as a surfaced failure when the tag pair already exists', async () => {
      const censusID = testData.census[0].censusID;
      const speciesCode = testData.species[0].SpeciesCode;
      const correctedSpeciesCode = testData.species[1].SpeciesCode;
      const quadratName = testData.quadrats[0].QuadratName;
      const original: ScenarioMeasurement = {
        treeTag: 'CROSS_BATCH_DUP',
        stemTag: '1',
        speciesCode,
        quadratName,
        x: 4,
        y: 4,
        dbh: 10,
        hom: 1.3,
        date: MEASUREMENT_DATE
      };

      const first = await insertTestMeasurements(connection, testData, [original], {
        censusID,
        fileID: 'cross_batch_original.csv',
        batchID: 'cross_batch_original'
      });
      const firstResult = await runBulkIngestion(connection, first.fileID, first.batchID);
      expect(firstResult.batch_failed, firstResult.message).toBe(false);

      const correction = await insertTestMeasurements(
        connection,
        testData,
        [{ ...original, speciesCode: correctedSpeciesCode, dbh: 22, comments: 'corrected measurement and species' }],
        {
          censusID,
          fileID: 'cross_batch_correction.csv',
          batchID: 'cross_batch_correction'
        }
      );
      const correctionResult = await runBulkIngestion(connection, correction.fileID, correction.batchID);
      expect(correctionResult.batch_failed, correctionResult.message).toBe(false);

      const correctionScope: IngestionScope = { ...correction, censusID };
      const correctionOutcome = await readIngestionOutcome(connection, correctionScope);
      assertOutcome(
        correctionOutcome,
        {
          sourceRecords: 1,
          successfulRows: 0,
          failedRows: 1,
          remainingTemporaryRows: 0,
          metricProcessedRecords: 0,
          metricFailedRecords: 1,
          metricMissingRecords: 0,
          errorCodes: [INGESTION_ERROR_CODE.DUPLICATE_TAG_CONFLICT_EXISTING],
          alertTypes: [INGESTION_ALERT_TYPE.DUPLICATE_TAG_CONFLICT_EXISTING]
        },
        correctionResult,
        1
      );

      const [preservedRows] = await connection.query<RowDataPacket[]>(
        `SELECT StemGUID, MeasuredDBH, RawTreeTag, RawStemTag, RawSpCode, RawComments, Description
         FROM coremeasurements
         WHERE CensusID = ? AND UploadFileID IN (?, ?)
         ORDER BY CoreMeasurementID`,
        [censusID, first.fileID, correction.fileID]
      );
      expect(preservedRows).toHaveLength(2);
      expect(Number(preservedRows[0].MeasuredDBH)).toBe(10);
      expect(preservedRows[0].StemGUID).not.toBeNull();
      expect(preservedRows[1].StemGUID).toBeNull();
      expect(Number(preservedRows[1].MeasuredDBH)).toBe(22);
      expect(preservedRows[1].RawTreeTag).toBe(original.treeTag);
      expect(preservedRows[1].RawStemTag).toBe(original.stemTag);
      expect(preservedRows[1].RawSpCode).toBe(correctedSpeciesCode);
      expect(preservedRows[1].RawComments).toBe('corrected measurement and species');
      expect(String(preservedRows[1].Description)).toContain('incoming row preserved for review');
    });

    it('does not delete historical successful conflicts during the collapser pass', async () => {
      const censusID = testData.census[0].censusID;
      const original: ScenarioMeasurement = {
        treeTag: 'HISTORICAL_DUP',
        stemTag: '1',
        speciesCode: testData.species[0].SpeciesCode,
        quadratName: testData.quadrats[0].QuadratName,
        x: 5,
        y: 5,
        dbh: 10,
        hom: 1.3,
        date: MEASUREMENT_DATE
      };
      const first = await insertTestMeasurements(connection, testData, [original], {
        censusID,
        fileID: 'historical_original.csv',
        batchID: 'historical_original'
      });
      const firstResult = await runBulkIngestion(connection, first.fileID, first.batchID);
      expect(firstResult.batch_failed, firstResult.message).toBe(false);

      const [existing] = await connection.query<RowDataPacket[]>(
        `SELECT StemGUID, MeasurementDate, MeasuredHOM
         FROM coremeasurements
         WHERE CensusID = ? AND UploadFileID = ? AND UploadBatchID = ? AND StemGUID IS NOT NULL`,
        [censusID, first.fileID, first.batchID]
      );
      expect(existing).toHaveLength(1);

      await connection.query(
        `INSERT INTO coremeasurements
           (CensusID, StemGUID, IsValidated, MeasurementDate, MeasuredDBH, MeasuredHOM,
            UploadFileID, UploadBatchID, SourceRowIndex, IsActive)
         VALUES (?, ?, FALSE, ?, 33, ?, 'historical_conflict.csv', 'historical_conflict', 1, 1)`,
        [censusID, existing[0].StemGUID, existing[0].MeasurementDate, existing[0].MeasuredHOM]
      );

      await connection.query('CALL bulkingestioncollapser(?)', [censusID]);
      await connection.query('CALL bulkingestioncollapser(?)', [censusID]);

      const [afterCollapse] = await connection.query<RowDataPacket[]>(
        `SELECT MeasuredDBH
         FROM coremeasurements
         WHERE CensusID = ? AND StemGUID = ?
         ORDER BY MeasuredDBH`,
        [censusID, existing[0].StemGUID]
      );
      expect(afterCollapse.map(row => Number(row.MeasuredDBH))).toEqual([10, 33]);

      const [alerts] = await connection.query<RowDataPacket[]>(
        `SELECT type, severity, message
         FROM uploadintegrityalerts
         WHERE censusID = ? AND fileID = '__collapser__'
         ORDER BY id`,
        [censusID]
      );
      expect(alerts).toHaveLength(2);
      expect(alerts.map(row => row.type).sort()).toEqual(['COLLAPSER_STEM_DATE_CONFLICT', 'COLLAPSER_TREE_STEM_TAG_CONFLICT']);
      expect(alerts.every(row => row.severity === 'warning')).toBe(true);
      expect(alerts.some(row => String(row.message).includes('preserved for user review'))).toBe(true);
    });
  });

  describe('DBH/HOM precision (Task 10A — ratified contract: round quietly to the stored scale)', () => {
    // RATIFIED 2026-07-20 by the scientific-data owner: an uploaded DBH/HOM value carrying
    // more precision than the DECIMAL(12,6) column stores is ROUNDED to 6 decimal places and
    // ingested as valid — no failure, no warning (docs/testing/regression-contracts.md).
    // This pins that behavior so a future schema/type change that silently alters it goes red.
    // Rounding happens at the DECIMAL(12,6) boundary (staging temporarymeasurements.DBH/HOM,
    // then copied to coremeasurements.MeasuredDBH/MeasuredHOM). MySQL DECIMAL rounds half away
    // from zero; the 7th-digit cases below are chosen far from .5 so binary-float noise in the
    // JS literal cannot flip the asserted result.
    //
    // SCOPE: this is the PRECISION contract only. Negative / out-of-range (>=1km) handling is a
    // SEPARATE validation concern (NEGATIVE_DBH/NEGATIVE_HOM ingestion codes) and is NOT part of
    // the round-quietly decision — do not fold it in here without its own ratified contract.
    const PRECISION_CASES = [
      { name: 'exactly 6 decimals is stored verbatim', dbh: 12.345678, hom: 1.234567, expectedDBH: 12.345678, expectedHOM: 1.234567 },
      { name: 'a 7th decimal below .5 rounds down to 6', dbh: 10.1234561, hom: 2.7654321, expectedDBH: 10.123456, expectedHOM: 2.765432 },
      { name: 'a 7th decimal above .5 rounds up to 6', dbh: 10.1234568, hom: 2.7654329, expectedDBH: 10.123457, expectedHOM: 2.765433 },
      {
        name: 'maximum in-range precision (6 integer + 6 decimal digits) is stored',
        dbh: 999999.999999,
        hom: 500000.123456,
        expectedDBH: 999999.999999,
        expectedHOM: 500000.123456
      }
    ] as const;

    it.each(PRECISION_CASES)('$name', async ({ dbh, hom, expectedDBH, expectedHOM }) => {
      const censusID = testData.census[0].censusID;
      const row: ScenarioMeasurement = {
        treeTag: 'PRECISION_A',
        stemTag: '1',
        speciesCode: testData.species[0].SpeciesCode,
        quadratName: testData.quadrats[0].QuadratName,
        x: 1,
        y: 1,
        dbh,
        hom,
        date: MEASUREMENT_DATE
      };
      const { scope, result } = await ingestScenarioRows(connection, testData, [row]);

      // The over-precise row must ingest as a normal success — never a failure or missing row.
      const outcome = await readIngestionOutcome(connection, scope);
      assertOutcome(
        outcome,
        {
          sourceRecords: 1,
          successfulRows: 1,
          failedRows: 0,
          remainingTemporaryRows: 0,
          metricProcessedRecords: 1,
          metricFailedRecords: 0,
          metricMissingRecords: 0,
          errorCodes: [],
          alertTypes: []
        },
        result,
        1
      );

      const [storedRows] = await connection.query<RowDataPacket[]>(
        `SELECT MeasuredDBH, MeasuredHOM
         FROM coremeasurements
         WHERE CensusID = ? AND UploadFileID = ? AND StemGUID IS NOT NULL`,
        [censusID, scope.fileID]
      );
      expect(storedRows, 'exactly one successful measurement materialized').toHaveLength(1);
      expect(Number(storedRows[0].MeasuredDBH), `DBH ${dbh} rounds to the stored ${expectedDBH}`).toBe(expectedDBH);
      expect(Number(storedRows[0].MeasuredHOM), `HOM ${hom} rounds to the stored ${expectedHOM}`).toBe(expectedHOM);
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

      const { scope, result } = await ingestScenarioRows(connection, testData, rows);
      const outcome = await readIngestionOutcome(connection, scope);

      assertOutcome(
        outcome,
        {
          sourceRecords: stemCount,
          successfulRows: stemCount,
          failedRows: 0,
          remainingTemporaryRows: 0,
          metricProcessedRecords: stemCount,
          metricFailedRecords: 0,
          errorCodes: [],
          alertTypes: []
        },
        result,
        rows.length
      );

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
        const { scope, result } = await ingestScenarioRows(connection, testData, rows);
        const outcome = await readIngestionOutcome(connection, scope);

        assertOutcome(
          outcome,
          {
            sourceRecords: 1,
            successfulRows: 1,
            failedRows: 0,
            remainingTemporaryRows: 0,
            metricProcessedRecords: 1,
            metricFailedRecords: 0,
            errorCodes: [],
            alertTypes: []
          },
          result,
          rows.length
        );
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
      const [plotResult] = await connection.query<ResultSetHeader>(
        `INSERT INTO plots (PlotName, LocationName, CountryName, DimensionX, DimensionY, Area, GlobalX, GlobalY, GlobalZ, PlotShape, PlotDescription)
         VALUES ('Constraint Plot 2', 'Loc', 'Panama', 500, 500, 250000, 0, 0, 0, 'square', 'second plot')`
      );
      const plot2ID = plotResult.insertId;
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

  /**
   * STAGE 9 attribute materialization: the production tokenizer (semicolon-split) is the
   * SQL itself. These prove valid codes land in cmattributes, an unknown code surfaces the
   * real validation/14 error into measurement_error_log without failing the row, and — the
   * exact ingestion incident — a comma list is treated as ONE (invalid) code, never split.
   */
  describe('Attribute-code materialization (STAGE 9)', () => {
    const VALID_CODE_A = 'A'; // seeded active attribute (Alive)
    const VALID_CODE_D = 'D'; // seeded active attribute (Dead)
    const UNKNOWN_CODE = 'ZZ'; // absent from the seeded attributes catalog

    // cmattributes rows for the batch, grouped by the measurement's resolved tree tag, so a
    // scenario can assert EXACTLY which codes each successful row materialized.
    async function materializedCodesByTreeTag(scope: IngestionScope): Promise<Map<string, string[]>> {
      const [rows] = await connection.query<RowDataPacket[]>(
        `SELECT t.TreeTag AS tag, cma.Code AS code
         FROM coremeasurements cm
         JOIN stems s ON s.StemGUID = cm.StemGUID
         JOIN trees t ON t.TreeID = s.TreeID
         JOIN cmattributes cma ON cma.CoreMeasurementID = cm.CoreMeasurementID
         WHERE cm.UploadFileID = ? AND cm.UploadBatchID = ? AND cm.CensusID = ?
         ORDER BY t.TreeTag, cma.Code`,
        [scope.fileID, scope.batchID, scope.censusID]
      );
      const byTag = new Map<string, string[]>();
      for (const row of rows) {
        const tag = String(row.tag);
        const list = byTag.get(tag) ?? [];
        list.push(String(row.code));
        byTag.set(tag, list);
      }
      return byTag;
    }

    // Count of invalid-attribute-code validation errors (validation/14) linked to each
    // successful measurement in the batch, grouped by tree tag.
    async function attributeErrorsByTreeTag(scope: IngestionScope): Promise<Map<string, number>> {
      const [rows] = await connection.query<RowDataPacket[]>(
        `SELECT t.TreeTag AS tag, COUNT(*) AS n
         FROM coremeasurements cm
         JOIN stems s ON s.StemGUID = cm.StemGUID
         JOIN trees t ON t.TreeID = s.TreeID
         JOIN measurement_error_log mel ON mel.MeasurementID = cm.CoreMeasurementID
         JOIN measurement_errors me ON me.ErrorID = mel.ErrorID
         WHERE cm.UploadFileID = ? AND cm.UploadBatchID = ? AND cm.CensusID = ?
           AND me.ErrorSource = ? AND me.ErrorCode = ?
         GROUP BY t.TreeTag`,
        [scope.fileID, scope.batchID, scope.censusID, ATTRIBUTE_CODE_VALIDATION_ERROR.source, ATTRIBUTE_CODE_VALIDATION_ERROR.code]
      );
      const byTag = new Map<string, number>();
      for (const row of rows) byTag.set(String(row.tag), Number(row.n));
      return byTag;
    }

    it('materializes one cmattributes row per valid semicolon-delimited code, with no attribute error', async () => {
      const tag = 'ATTR_VALID';
      const rows: ScenarioMeasurement[] = [
        {
          treeTag: tag,
          stemTag: '1',
          speciesCode: testData.species[0].SpeciesCode,
          quadratName: testData.quadrats[0].QuadratName,
          x: 1,
          y: 1,
          dbh: 10,
          hom: 1.3,
          date: MEASUREMENT_DATE,
          codes: `${VALID_CODE_A};${VALID_CODE_D}`
        }
      ];
      const { scope, result } = await ingestScenarioRows(connection, testData, rows);
      const outcome = await readIngestionOutcome(connection, scope);
      assertOutcome(
        outcome,
        {
          sourceRecords: 1,
          successfulRows: 1,
          failedRows: 0,
          remainingTemporaryRows: 0,
          metricProcessedRecords: 1,
          metricFailedRecords: 0,
          errorCodes: [],
          alertTypes: []
        },
        result,
        rows.length
      );

      const codes = await materializedCodesByTreeTag(scope);
      expect(codes.get(tag), `cmattributes codes for ${tag}`).toEqual([VALID_CODE_A, VALID_CODE_D]);
      const errors = await attributeErrorsByTreeTag(scope);
      expect(errors.get(tag) ?? 0, `attribute-code errors for ${tag}`).toBe(0);
    });

    it('surfaces an unknown code into measurement_error_log (validation/14) while still materializing the valid code and ingesting the row', async () => {
      const tag = 'ATTR_BADCODE';
      const rows: ScenarioMeasurement[] = [
        {
          treeTag: tag,
          stemTag: '1',
          speciesCode: testData.species[0].SpeciesCode,
          quadratName: testData.quadrats[0].QuadratName,
          x: 2,
          y: 2,
          dbh: 11,
          hom: 1.3,
          date: MEASUREMENT_DATE,
          codes: `${VALID_CODE_A};${UNKNOWN_CODE}`
        }
      ];
      const { scope, result } = await ingestScenarioRows(connection, testData, rows);
      const outcome = await readIngestionOutcome(connection, scope);
      // The row still SUCCEEDS — an invalid attribute code is a soft validation (STAGE 9),
      // logged against the resolved measurement, not a hard ingestion failure.
      assertOutcome(
        outcome,
        {
          sourceRecords: 1,
          successfulRows: 1,
          failedRows: 0,
          remainingTemporaryRows: 0,
          metricProcessedRecords: 1,
          metricFailedRecords: 0,
          errorCodes: [],
          alertTypes: []
        },
        result,
        rows.length
      );

      const codes = await materializedCodesByTreeTag(scope);
      expect(codes.get(tag), `only the valid code materializes for ${tag}`).toEqual([VALID_CODE_A]);
      const errors = await attributeErrorsByTreeTag(scope);
      expect(errors.get(tag) ?? 0, `exactly one validation/14 error for the unknown code on ${tag}`).toBe(1);
    });

    it('distinguishes a semicolon list (many codes) from a comma list (one invalid code) — the exact ingestion incident', async () => {
      const semiTag = 'ATTR_SEMI';
      const commaTag = 'ATTR_COMMA';
      const rows: ScenarioMeasurement[] = [
        {
          treeTag: semiTag,
          stemTag: '1',
          speciesCode: testData.species[0].SpeciesCode,
          quadratName: testData.quadrats[0].QuadratName,
          x: 3,
          y: 3,
          dbh: 12,
          hom: 1.3,
          date: MEASUREMENT_DATE,
          codes: `${VALID_CODE_A};${VALID_CODE_D}`
        },
        {
          treeTag: commaTag,
          stemTag: '1',
          speciesCode: testData.species[1].SpeciesCode,
          quadratName: testData.quadrats[0].QuadratName,
          x: 4,
          y: 4,
          dbh: 13,
          hom: 1.3,
          date: MEASUREMENT_DATE,
          codes: `${VALID_CODE_A},${VALID_CODE_D}`
        }
      ];
      const { scope, result } = await ingestScenarioRows(connection, testData, rows);
      const outcome = await readIngestionOutcome(connection, scope);
      assertOutcome(
        outcome,
        {
          sourceRecords: 2,
          successfulRows: 2,
          failedRows: 0,
          remainingTemporaryRows: 0,
          metricProcessedRecords: 2,
          metricFailedRecords: 0,
          errorCodes: [],
          alertTypes: []
        },
        result,
        rows.length
      );

      const codes = await materializedCodesByTreeTag(scope);
      const errors = await attributeErrorsByTreeTag(scope);

      // Semicolon list -> two valid codes, no error.
      expect(codes.get(semiTag), `semicolon list materializes both codes for ${semiTag}`).toEqual([VALID_CODE_A, VALID_CODE_D]);
      expect(errors.get(semiTag) ?? 0, `no attribute-code error for the semicolon list ${semiTag}`).toBe(0);

      // Comma list -> the whole "A,D" string is ONE code that matches no attribute, so
      // nothing materializes and it surfaces exactly one validation/14 error.
      expect(codes.get(commaTag), `comma list materializes NO cmattributes rows for ${commaTag}`).toBeUndefined();
      expect(errors.get(commaTag) ?? 0, `exactly one validation/14 error for the comma list ${commaTag}`).toBe(1);
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
    const result = await runBulkIngestion(connection, fileID, batchID);
    const scope: IngestionScope = { fileID, batchID, censusID };
    const outcome = await readIngestionOutcome(connection, scope);

    assertOutcome(
      outcome,
      {
        sourceRecords: 1,
        successfulRows: 0,
        failedRows: 1,
        remainingTemporaryRows: 0,
        metricProcessedRecords: 0,
        metricFailedRecords: 1,
        errorCodes: [INGESTION_ERROR_CODE.AMBIGUOUS_SPECIES],
        alertTypes: [INGESTION_ALERT_TYPE.INVALID_REFERENCE_DATA]
      },
      result,
      1
    );
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
    const result = await runBulkIngestion(connection, fileID, batchID);
    const scope: IngestionScope = { fileID, batchID, censusID };
    const outcome = await readIngestionOutcome(connection, scope);

    assertOutcome(
      outcome,
      {
        sourceRecords: 1,
        successfulRows: 0,
        failedRows: 1,
        remainingTemporaryRows: 0,
        metricProcessedRecords: 0,
        metricFailedRecords: 1,
        errorCodes: [INGESTION_ERROR_CODE.AMBIGUOUS_QUADRAT],
        alertTypes: [INGESTION_ALERT_TYPE.INVALID_REFERENCE_DATA]
      },
      result,
      1
    );
    expect(await failedDescription(scope)).toMatch(/Ambiguous quadrat name.*matches 2 active/);
  });
});
