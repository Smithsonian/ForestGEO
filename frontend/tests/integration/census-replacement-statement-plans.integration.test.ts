/**
 * Census replacement window statement plans — Integration Tests (I1, issue #555)
 *
 * MySQL plans `DELETE ... WHERE CoreMeasurementID IN (...)` by building a range
 * tree for every index of coremeasurements. Past range_optimizer_max_mem_size it
 * raises warning 3170 and falls back to a full table scan under row locks. These
 * tests EXPLAIN the exact statements production issues for one window and prove:
 *   - a window of CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE ids stays range-optimizable,
 *     on the canonical table and at Azure's widest index count (21);
 *   - the check can see a fallback (positive control);
 *   - the window's cursor SELECT walks CENSUS_REPLACEMENT_SCAN_INDEX.
 *
 * Prerequisites: docker compose up -d mysql
 *
 * Run in isolation:
 *   npx vitest run --config vitest.integration.config.mts tests/integration/census-replacement-statement-plans.integration.test.ts
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { createAdditionalCensus, setupTestDatabase, teardownTestDatabase, type TestData } from '../setup/local-db-setup';
import {
  captureCensusReplacementWindowStatements,
  captureCoreMeasurementWindowLockStatement,
  type CapturedStatement,
  type CensusReplacementWindowScope
} from '../setup/census-replacement-statement-capture';
import { CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE, CENSUS_REPLACEMENT_SCAN_INDEX, type CoreMeasurementDeleteScope } from '@/lib/ingestion/temporary-measurements';
import { crossFileUnresolvedFailureScope, failedCensusRecoveryScope, sameFileUnresolvedFailureScope } from '@/lib/uploads/ingest-batch';
import { batchFamilyUnresolvedScope } from '@/lib/uploads/record-invalid-rows';

const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '::1'];
const RESOLVED_HOSTS = [process.env.AZURE_SQL_SERVER, process.env.TEST_DB_HOST || 'localhost'];
for (const host of RESOLVED_HOSTS) {
  if (!host || !LOCAL_HOSTS.includes(host)) {
    throw new Error(`REFUSING TO RUN: host '${host}' is not local. This suite creates and drops tables.`);
  }
}

const RANGE_OPTIMIZATION_SKIPPED_WARNING_CODE = 3170;
const RANGE_SEEK_PLAN_TYPE = 'range';
const RANGE_OPTIMIZER_POSITIVE_CONTROL_IDS = 50_000;
const AZURE_WIDEST_COREMEASUREMENTS_INDEX_COUNT = 21;
const INDEX_MARGIN_TABLE = 'coremeasurements_index_margin';
const COREMEASUREMENTS_TABLE_REFERENCE = /\.coremeasurements\b/g;

/** Columns that no canonical coremeasurements index leads with; each gets one throwaway index. */
const PADDING_INDEX_COLUMNS = [
  'RawTreeTag',
  'SourceRowIndex',
  'RawStemTag',
  'RawSpCode',
  'RawQuadrat',
  'RawX',
  'RawY',
  'RawPlotX',
  'RawPlotY',
  'RawCodes',
  'RawComments',
  'RawPublishedStemID',
  'DeletedAt',
  'IsActive'
];

const INCOMING_BATCH = 'plan-incoming-batch';
const SEEDED_PRIOR_BATCH_PREFIX = 'plan-seeded-prior-batch';
const SEEDED_PRIOR_FILE = 'plan-seeded-prior.csv';
const SEEDED_ROWS_PER_CENSUS = 5000;
const CURSOR_WINDOW_OFFSET = CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE - 1;
const TEST_CHANGED_BY = 'statement-plans-integration-test';
const OTHER_CENSUS_NUMBER = 91;
const OTHER_CENSUS_START = '2020-01-01';
const OTHER_CENSUS_END = '2020-12-31';

interface ExplainOutcome {
  planRows: RowDataPacket[];
  warningCodes: number[];
}

function sequentialIDs(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index + 1);
}

describe('census replacement window statement plans (I1)', () => {
  let connection: Connection;
  let testData: TestData;
  let config: { database: string };
  let scope: CensusReplacementWindowScope;
  let targetCensusIDs: number[];

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
    config = setup.config;
    scope = {
      schema: setup.config.database,
      incomingBatchID: INCOMING_BATCH,
      plotID: testData.plots[0].plotID,
      censusID: testData.census[0].censusID,
      afterCoreMeasurementID: 0,
      changedBy: TEST_CHANGED_BY
    };
    const otherCensus = await createAdditionalCensus(connection, testData, {
      plotCensusNumber: OTHER_CENSUS_NUMBER,
      startDate: OTHER_CENSUS_START,
      endDate: OTHER_CENSUS_END
    });
    await seedPriorRows(scope.censusID);
    await seedPriorRows(otherCensus.censusID);
    await connection.query('ANALYZE TABLE coremeasurements');
    const [targetRows] = await connection.query<RowDataPacket[]>(
      `SELECT CoreMeasurementID FROM coremeasurements WHERE CensusID = ? ORDER BY CoreMeasurementID`,
      [scope.censusID]
    );
    targetCensusIDs = targetRows.map(row => Number(row.CoreMeasurementID));
    console.log(
      `[setup] schema=${scope.schema} plot=${scope.plotID} census=${scope.censusID} otherCensus=${otherCensus.censusID} ` +
        `rowsPerCensus=${SEEDED_ROWS_PER_CENSUS} targetRows=${targetCensusIDs.length}`
    );
  }, 120000);

  async function seedPriorRows(censusID: number): Promise<void> {
    await connection.query(`SET SESSION cte_max_recursion_depth = ?`, [SEEDED_ROWS_PER_CENSUS + 1]);
    await connection.query(
      `INSERT INTO coremeasurements (CensusID, StemGUID, IsValidated, MeasurementDate, MeasuredDBH, MeasuredHOM,
         UploadFileID, UploadBatchID, RawTreeTag, SourceRowIndex, IsActive)
       WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < ?)
       SELECT ?, NULL, FALSE, '2024-03-15', 1.0, 1.0, ?, ?, CONCAT('P', n), n, 1 FROM seq`,
      [SEEDED_ROWS_PER_CENSUS, censusID, SEEDED_PRIOR_FILE, `${SEEDED_PRIOR_BATCH_PREFIX}-${censusID}`]
    );
  }

  afterAll(async () => {
    await teardownTestDatabase(connection, config);
  });

  async function explainWithWarnings(statement: CapturedStatement): Promise<ExplainOutcome> {
    const [planRows] = await connection.query<RowDataPacket[]>(`EXPLAIN ${statement.sql}`, statement.params);
    const [warnings] = await connection.query<RowDataPacket[]>('SHOW WARNINGS');
    return { planRows, warningCodes: warnings.map(warning => Number(warning.Code)) };
  }

  function logOutcome(label: string, outcome: ExplainOutcome): void {
    const plans = outcome.planRows.map(row => `${row.table}:type=${row.type},key=${row.key}`).join('; ');
    console.log(`[${label}] plan=[${plans}] warningCodes=[${outcome.warningCodes.join(',')}]`);
  }

  function firstWindowOfTargetCensus(): number[] {
    return targetCensusIDs.slice(0, CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE);
  }

  async function explainWindowDeleteAndAudit(ids: number[], retarget: (sql: string) => string = sql => sql) {
    const statements = await captureCensusReplacementWindowStatements(scope, ids);
    const coreMeasurementDelete = await explainWithWarnings({ ...statements.coreMeasurementDelete, sql: retarget(statements.coreMeasurementDelete.sql) });
    const deleteAudit = await explainWithWarnings({ ...statements.deleteAudit, sql: retarget(statements.deleteAudit.sql) });
    return { coreMeasurementDelete, deleteAudit };
  }

  async function distinctIndexCount(table: string): Promise<number> {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT COUNT(DISTINCT INDEX_NAME) AS indexCount FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
      [scope.schema, table]
    );
    return Number(rows[0].indexCount);
  }

  async function leadingIndexedColumns(table: string): Promise<Set<string>> {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT COLUMN_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND SEQ_IN_INDEX = 1`,
      [scope.schema, table]
    );
    return new Set(rows.map(row => String(row.COLUMN_NAME)));
  }

  it(`the window's DELETE and audit INSERT stay range-optimizable at CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE ids (catches: window raised past the limit)`, async () => {
    const { coreMeasurementDelete, deleteAudit } = await explainWindowDeleteAndAudit(firstWindowOfTargetCensus());
    console.log(`[window size] ids=${CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE} indexes=${await distinctIndexCount('coremeasurements')}`);
    logOutcome('canonical DELETE', coreMeasurementDelete);
    logOutcome('canonical audit INSERT', deleteAudit);

    expect(coreMeasurementDelete.warningCodes).not.toContain(RANGE_OPTIMIZATION_SKIPPED_WARNING_CODE);
    expect(deleteAudit.warningCodes).not.toContain(RANGE_OPTIMIZATION_SKIPPED_WARNING_CODE);
  });

  it(`...and still at Azure's widest ${AZURE_WIDEST_COREMEASUREMENTS_INDEX_COUNT}-index coremeasurements (catches: an index added past the margin)`, async () => {
    await connection.query(`DROP TABLE IF EXISTS ${INDEX_MARGIN_TABLE}`);
    try {
      await connection.query(`CREATE TABLE ${INDEX_MARGIN_TABLE} LIKE coremeasurements`);
      const canonicalCount = await distinctIndexCount(INDEX_MARGIN_TABLE);
      const alreadyLeading = await leadingIndexedColumns(INDEX_MARGIN_TABLE);
      const paddingColumns = PADDING_INDEX_COLUMNS.filter(column => !alreadyLeading.has(column)).slice(
        0,
        AZURE_WIDEST_COREMEASUREMENTS_INDEX_COUNT - canonicalCount
      );
      for (const column of paddingColumns) {
        await connection.query(`ALTER TABLE ${INDEX_MARGIN_TABLE} ADD INDEX idx_margin_${column} (${column})`);
      }
      await connection.query(`INSERT INTO ${INDEX_MARGIN_TABLE} SELECT * FROM coremeasurements`);
      await connection.query(`ANALYZE TABLE ${INDEX_MARGIN_TABLE}`);
      const paddedCount = await distinctIndexCount(INDEX_MARGIN_TABLE);
      console.log(`[index margin] canonicalIndexes=${canonicalCount} padded=${paddingColumns.join(',')} totalIndexes=${paddedCount}`);
      expect(paddedCount).toBe(AZURE_WIDEST_COREMEASUREMENTS_INDEX_COUNT);

      const retargetToMarginTable = (sql: string) => sql.replace(COREMEASUREMENTS_TABLE_REFERENCE, `.${INDEX_MARGIN_TABLE}`);
      const { coreMeasurementDelete, deleteAudit } = await explainWindowDeleteAndAudit(firstWindowOfTargetCensus(), retargetToMarginTable);
      logOutcome(`${paddedCount}-index DELETE`, coreMeasurementDelete);
      logOutcome(`${paddedCount}-index audit INSERT`, deleteAudit);

      expect(coreMeasurementDelete.warningCodes).not.toContain(RANGE_OPTIMIZATION_SKIPPED_WARNING_CODE);
      expect(deleteAudit.warningCodes).not.toContain(RANGE_OPTIMIZATION_SKIPPED_WARNING_CODE);
    } finally {
      await connection.query(`DROP TABLE IF EXISTS ${INDEX_MARGIN_TABLE}`);
    }
  }, 60000);

  it('positive control: an id list far past any plausible limit raises warning 3170, so this suite can see a fallback', async () => {
    const { coreMeasurementDelete, deleteAudit } = await explainWindowDeleteAndAudit(sequentialIDs(RANGE_OPTIMIZER_POSITIVE_CONTROL_IDS));
    logOutcome(`${RANGE_OPTIMIZER_POSITIVE_CONTROL_IDS}-id DELETE`, coreMeasurementDelete);
    logOutcome(`${RANGE_OPTIMIZER_POSITIVE_CONTROL_IDS}-id audit INSERT`, deleteAudit);

    expect(coreMeasurementDelete.warningCodes).toContain(RANGE_OPTIMIZATION_SKIPPED_WARNING_CODE);
    expect(deleteAudit.warningCodes).toContain(RANGE_OPTIMIZATION_SKIPPED_WARNING_CODE);
  }, 60000);

  it(`the window's cursor SELECT walks ${CENSUS_REPLACEMENT_SCAN_INDEX} (catches: the hint dropped or the index renamed)`, async () => {
    const cursor = targetCensusIDs[CURSOR_WINDOW_OFFSET];
    console.log(`[cursor select] targetRows=${targetCensusIDs.length} otherCensusRows=${SEEDED_ROWS_PER_CENSUS} cursor=${cursor}`);

    const statements = await captureCensusReplacementWindowStatements({ ...scope, afterCoreMeasurementID: cursor }, sequentialIDs(1));
    const outcome = await explainWithWarnings(statements.idSelect);
    logOutcome('cursor SELECT', outcome);

    const coreMeasurementsPlan = outcome.planRows.find(row => row.table === 'coremeasurements');
    expect(coreMeasurementsPlan, `no coremeasurements row in plan: ${JSON.stringify(outcome.planRows)}`).toBeDefined();
    expect(coreMeasurementsPlan!.key).toBe(CENSUS_REPLACEMENT_SCAN_INDEX);
    // Without the hint the optimizer still picks this index but scans all of it (type=index) instead of seeking the census.
    expect(coreMeasurementsPlan!.type).toBe(RANGE_SEEK_PLAN_TYPE);
  });

  describe('#562 window lock statements seek by PRIMARY for every caller (I1)', () => {
    const LOCK_INCOMING_FILE = 'plan-lock-incoming.csv';
    const LOCK_INCOMING_BATCH = 'plan-lock-incoming-batch';
    const PRIMARY_KEY_NAME = 'PRIMARY';
    const COREMEASUREMENTS_PLAN_TABLES = ['coremeasurements', 'cm'];
    const SQL_EXCEPTION = { source: 'ingestion', code: 'SQL_EXCEPTION' } as const;
    let scopes: Array<[string, CoreMeasurementDeleteScope]>;

    beforeAll(async () => {
      const [errors] = await connection.query<RowDataPacket[]>('SELECT ErrorID FROM measurement_errors WHERE ErrorSource = ? AND ErrorCode = ?', [
        SQL_EXCEPTION.source,
        SQL_EXCEPTION.code
      ]);
      await connection.query(
        'INSERT INTO measurement_error_log (MeasurementID, ErrorID) SELECT CoreMeasurementID, ? FROM coremeasurements WHERE CensusID = ?',
        [errors[0].ErrorID, scope.censusID]
      );
      await connection.query(
        `INSERT INTO temporarymeasurements (FileID, BatchID, PlotID, CensusID, TreeTag, StemTag, SpeciesCode, QuadratName, LocalX, LocalY, DBH, HOM, MeasurementDate, Codes, Comments)
         SELECT ?, ?, ?, CensusID, RawTreeTag, RawStemTag, RawSpCode, RawQuadrat, RawX, RawY, MeasuredDBH, MeasuredHOM, MeasurementDate, RawCodes, RawComments
         FROM coremeasurements WHERE CensusID = ?`,
        [LOCK_INCOMING_FILE, LOCK_INCOMING_BATCH, scope.plotID, scope.censusID]
      );
      await connection.query('ANALYZE TABLE coremeasurements, measurement_error_log, temporarymeasurements');
      const seededBatch = `${SEEDED_PRIOR_BATCH_PREFIX}-${scope.censusID}`;
      scopes = [
        ['C1 recovery', failedCensusRecoveryScope(scope.censusID)],
        ['C2 same-file cleanup', sameFileUnresolvedFailureScope(SEEDED_PRIOR_FILE, LOCK_INCOMING_BATCH, scope.censusID)],
        ['C3 cross-file cleanup', crossFileUnresolvedFailureScope(LOCK_INCOMING_FILE, LOCK_INCOMING_BATCH, scope.censusID)],
        ['C4 batch-family cleanup', batchFamilyUnresolvedScope(SEEDED_PRIOR_FILE, seededBatch, scope.censusID, [])]
      ];
    }, 120_000);

    afterAll(async () => {
      await connection.query(
        'DELETE mel FROM measurement_error_log mel JOIN coremeasurements cm ON cm.CoreMeasurementID = mel.MeasurementID WHERE cm.CensusID = ?',
        [scope.censusID]
      );
      await connection.query('DELETE FROM temporarymeasurements WHERE FileID = ?', [LOCK_INCOMING_FILE]);
    });

    function lockPlanMismatches(label: string, outcome: ExplainOutcome): string[] {
      const first = outcome.planRows[0];
      const mismatches: string[] = [];
      if (!COREMEASUREMENTS_PLAN_TABLES.includes(String(first?.table))) mismatches.push(`${label}: first table ${first?.table}, expected coremeasurements/cm`);
      if (String(first?.key) !== PRIMARY_KEY_NAME) mismatches.push(`${label}: key ${first?.key}, expected ${PRIMARY_KEY_NAME}`);
      if (String(first?.type) !== RANGE_SEEK_PLAN_TYPE) mismatches.push(`${label}: type ${first?.type}, expected ${RANGE_SEEK_PLAN_TYPE}`);
      if (outcome.warningCodes.includes(RANGE_OPTIMIZATION_SKIPPED_WARNING_CODE))
        mismatches.push(`${label}: warning ${RANGE_OPTIMIZATION_SKIPPED_WARNING_CODE}`);
      return mismatches;
    }

    it('on fresh statistics, and after all but one window was deleted in the same open transaction, every caller\u2019s window lock plans a PRIMARY range on coremeasurements first (catches: a lock that does not seek by primary key; C3 driven from another table; a window past the limit)', async () => {
      const firstWindow = targetCensusIDs.slice(0, CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE);
      const lastWindow = targetCensusIDs.slice(-CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE);
      const mismatches: string[] = [];
      for (const [label, callerScope] of scopes) {
        const fresh = await explainWithWarnings(
          await captureCoreMeasurementWindowLockStatement(scope.schema, callerScope, firstWindow, scope.plotID, scope.censusID)
        );
        logOutcome(`${label} fresh`, fresh);
        mismatches.push(...lockPlanMismatches(`${label} fresh`, fresh));
      }
      await connection.beginTransaction();
      try {
        await connection.query('DELETE FROM coremeasurements WHERE CensusID = ? AND CoreMeasurementID NOT IN (?)', [scope.censusID, lastWindow]);
        for (const [label, callerScope] of scopes) {
          const afterMassDelete = await explainWithWarnings(
            await captureCoreMeasurementWindowLockStatement(scope.schema, callerScope, lastWindow, scope.plotID, scope.censusID)
          );
          logOutcome(`${label} after mass delete`, afterMassDelete);
          mismatches.push(...lockPlanMismatches(`${label} after mass delete`, afterMassDelete));
        }
      } finally {
        await connection.rollback();
      }
      expect(mismatches).toEqual([]);
    }, 120_000);
  });
});
