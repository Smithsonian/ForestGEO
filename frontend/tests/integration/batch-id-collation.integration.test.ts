/**
 * Batch id collation aliases — Integration Test (#561 H2)
 *
 * temporarymeasurements.BatchID compares under utf8mb4_0900_ai_ci (case- and accent-insensitive), so a CSV upload
 * could name a batch that SQL treats as equal to an ArcGIS commit batch (`arc` + base-36 of the import session id)
 * and have an ArcGIS commit's leftover clearing (F0) take its rows. This proves the threat is real for every alias
 * the unit tests refuse, and that `assertCallerBatchIDAllowed` closes it.
 *
 * Prerequisites: docker compose up -d mysql
 *
 * Run in isolation (through the shared lock script while other relays use the database):
 *   npx vitest run --config vitest.integration.config.mts tests/integration/batch-id-collation.integration.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { setupTestDatabase, teardownTestDatabase, type TestData, type TestDatabaseConfig } from '../setup/local-db-setup';
import { assertCallerBatchIDAllowed, deriveArcgisCommitBatchID, ReservedBatchIDError } from '@/lib/uploads/batch-family';

const TEST_DB_HOST = process.env.TEST_DB_HOST || 'localhost';

if (!['localhost', '127.0.0.1', '::1'].includes(TEST_DB_HOST)) {
  throw new Error(
    `[batch-id-collation] Refusing to run: TEST_DB_HOST="${TEST_DB_HOST}" is not a local address. ` +
      `This suite drops and recreates its test schema and must only run against a local test database.`
  );
}

const IMPORT_SESSION_ID = '6f1c2d3e-4a5b-4c6d-8e7f-901234567890';
const STAGED_FILE_ID = 'arcgis-collation-fixture.csv';
const BATCH_COLLATION = 'utf8mb4_0900_ai_ci';
const SQL_TRUE = 1;
const FULL_WIDTH_OFFSET = 0xfee0;
const ARCGIS_PREFIX_LENGTH = 'arc'.length;

const derivedBatchID = deriveArcgisCommitBatchID(IMPORT_SESSION_ID);
const toFullWidth = (value: string) => [...value].map(character => String.fromCharCode(character.charCodeAt(0) + FULL_WIDTH_OFFSET)).join('');

const COLLATION_ALIASES: Array<[string, string]> = [
  ['all uppercase', derivedBatchID.toUpperCase()],
  ['mixed-case prefix', `Arc${derivedBatchID.slice(ARCGIS_PREFIX_LENGTH)}`],
  ['uppercase body letter', `${derivedBatchID.slice(0, 5)}${derivedBatchID.charAt(5).toUpperCase()}${derivedBatchID.slice(6)}`],
  ['accented prefix', `àrc${derivedBatchID.slice(ARCGIS_PREFIX_LENGTH)}`],
  ['full-width prefix', `${toFullWidth('arc')}${derivedBatchID.slice(ARCGIS_PREFIX_LENGTH)}`],
  ['full-width body', `arc${toFullWidth(derivedBatchID.slice(ARCGIS_PREFIX_LENGTH))}`]
];

describe('batch id collation aliases of the ArcGIS commit batch (#561 H2)', () => {
  let connection: Connection;
  let config: TestDatabaseConfig;
  let testData: TestData;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    config = setup.config;
    testData = setup.testData;

    await connection.query(`INSERT INTO temporarymeasurements (FileID, BatchID, PlotID, CensusID, TreeTag, StemTag) VALUES (?, ?, ?, ?, 'TREE1', '1')`, [
      STAGED_FILE_ID,
      derivedBatchID,
      testData.plots[0].plotID,
      testData.census[0].censusID
    ]);
    const [columnRows] = await connection.query<RowDataPacket[]>(
      `SELECT COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'temporarymeasurements' AND COLUMN_NAME = 'BatchID'`
    );
    console.log(`[collation] derived=${derivedBatchID} temporarymeasurements.BatchID collation=${columnRows[0]?.COLLATION_NAME}`);
  }, 90000);

  afterAll(async () => {
    await teardownTestDatabase(connection, config);
  });

  it('stores the staged batch under the column collation the threat depends on', async () => {
    const [columnRows] = await connection.query<RowDataPacket[]>(
      `SELECT COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'temporarymeasurements' AND COLUMN_NAME = 'BatchID'`
    );
    expect(columnRows[0]?.COLLATION_NAME).toBe(BATCH_COLLATION);
  });

  it.each(COLLATION_ALIASES)('%s equals the derived id in SQL, finds the staged row, and is refused by assertCallerBatchIDAllowed', async (_label, alias) => {
    const [comparisonRows] = await connection.query<RowDataPacket[]>(`SELECT ? = ? COLLATE ${BATCH_COLLATION} AS same`, [alias, derivedBatchID]);
    const [stagedRows] = await connection.query<RowDataPacket[]>(`SELECT COUNT(*) AS stagedCount FROM temporarymeasurements WHERE BatchID = ?`, [alias]);
    console.log(`[collation] ${JSON.stringify(alias)} equalsDerived=${comparisonRows[0]?.same} stagedRowsFoundByAlias=${stagedRows[0]?.stagedCount}`);

    expect(Number(comparisonRows[0]?.same), `${alias} must equal ${derivedBatchID} under ${BATCH_COLLATION}`).toBe(SQL_TRUE);
    expect(Number(stagedRows[0]?.stagedCount), `WHERE BatchID = ${alias} must find the row staged under ${derivedBatchID}`).toBe(1);
    expect(() => assertCallerBatchIDAllowed(alias)).toThrow(ReservedBatchIDError);
  });

  it('does not match a batch that is genuinely different, so the staged-row lookup is discriminating', async () => {
    const [stagedRows] = await connection.query<RowDataPacket[]>(`SELECT COUNT(*) AS stagedCount FROM temporarymeasurements WHERE BatchID = ?`, [
      `${derivedBatchID.slice(0, -1)}${derivedBatchID.endsWith('0') ? '1' : '0'}`
    ]);
    expect(Number(stagedRows[0]?.stagedCount)).toBe(0);
  });
});
