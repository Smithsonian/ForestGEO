/**
 * View Data → Add measurements → "Manual entry form" submit, proven against real MySQL.
 *
 * MultilineMeasurementsDataGrid renders IsolatedMultilineDataGridCommons with
 * gridType="measurements", and its Finalize button POSTs that gridType to /api/bulkcrud
 * with every cell stringified and the grid's own isNew/_error flags still on each row.
 * This suite sends that exact payload to the real route handler and lets the real
 * temporarymeasurements staging, bulkingestionprocess CALL and coremeasurements audit run
 * on a local schema, so a gridType the route does not route to the measurement path shows
 * up as a failed submit here rather than in the browser.
 *
 * Only @/auth, @/ailogger and ConnectionManager are mocked; the ConnectionManager stub
 * proxies every call onto one real mysql2 connection, as in
 * recent-changes-route-audit.integration.test.ts.
 *
 * Prerequisites: docker compose up -d mysql
 *
 * Run in isolation:
 *   npx vitest run --config vitest.integration.config.mts tests/integration/bulkcrud-manual-measurements.integration.test.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { cleanupTestMeasurements, setupTestDatabase, teardownTestDatabase, type TestData, type TestDatabaseConfig } from '../setup/local-db-setup';
import { HTTPResponses } from '@/config/macros';
import { classifyChangesAfter, describeExportedRows, exportedRowsForPlot } from './helpers/changeexportprobe';
import { SUMMARY_COLUMN_MARKER } from '@/config/changelogexport';

const TEST_DB_HOST = process.env.TEST_DB_HOST || 'localhost';
if (!['localhost', '127.0.0.1', '::1'].includes(TEST_DB_HOST)) {
  throw new Error(
    `[bulkcrud-manual-measurements] Refusing to run: TEST_DB_HOST="${TEST_DB_HOST}" is not a local address. ` +
      `This suite drops and recreates its test schema and must only run against a local test database.`
  );
}

const AUTH_USER_EMAIL = 'manual-entry-runner@forestgeo.test';
const BULK_CRUD_FILE_ID = 'sample_bulk_insert.csv';
const MANUAL_ENTRY_GRID_TYPE = 'measurements';
const MANUAL_ENTRY_TREE_TAG = 'MANUAL_ENTRY_01';
const MANUAL_ENTRY_STEM_TAG = '1';
const MANUAL_ENTRY_DBH = 12.5;
const MANUAL_ENTRY_HOM = 1.3;
const MANUAL_ENTRY_LOCAL_X = 5;
const MANUAL_ENTRY_LOCAL_Y = 7;
const MANUAL_ENTRY_DATE = '2024-06-15';
const TRANSACTION_ID = 'bulkcrud-manual-measurements-tx';
const NO_EARLIER_CHANGE = 0;

const sharedState = vi.hoisted(() => ({
  connection: null as Connection | null,
  activeTransactionID: null as string | null,
  batchCounter: 0,
  lastBatchID: null as string | null
}));

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({
    user: {
      email: AUTH_USER_EMAIL,
      userStatus: 'global',
      sites: []
    }
  }))
}));

vi.mock('@/ailogger', () => ({
  default: {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined
  }
}));

vi.mock('@/config/utils', async importOriginal => {
  const actual = await importOriginal<typeof import('@/config/utils')>();
  return {
    ...actual,
    generateShortBatchID: () => {
      sharedState.batchCounter += 1;
      const batchID = `manual-entry-batch-${sharedState.batchCounter}`;
      sharedState.lastBatchID = batchID;
      return batchID;
    }
  };
});

vi.mock('@/lib/db/connectionmanager', () => {
  function requireConnection(): Connection {
    if (!sharedState.connection) throw new Error('Test DB connection not initialized');
    return sharedState.connection;
  }

  const manager = {
    executeQuery: async (sql: string, params?: unknown[], transactionID?: string) => {
      // Production sends a query without the active transaction ID to another pooled
      // connection; on this single shared connection it would silently join the
      // transaction, so reject it instead of hiding the difference.
      if (sharedState.activeTransactionID && transactionID !== sharedState.activeTransactionID) {
        throw new Error(`Query ran outside the route's transaction ${sharedState.activeTransactionID}: ${sql.slice(0, 160)}`);
      }
      const [rows] = await requireConnection().query(sql, params as any[]);
      return rows;
    },
    discardTransaction: (transactionID: string, reason: string) => {
      throw new Error(`discardTransaction must not run in this suite (transaction ${transactionID}: ${reason})`);
    },
    closeConnection: async () => undefined,
    beginTransaction: async () => {
      await requireConnection().beginTransaction();
      sharedState.activeTransactionID = TRANSACTION_ID;
      return TRANSACTION_ID;
    },
    commitTransaction: async () => {
      await requireConnection().commit();
      sharedState.activeTransactionID = null;
    },
    rollbackTransaction: async () => {
      await requireConnection().rollback();
      sharedState.activeTransactionID = null;
    }
  };

  return { default: { getInstance: () => manager } };
});

import { POST } from '@/app/api/bulkcrud/route';

describe('POST /api/bulkcrud from the View Data manual measurement entry form', () => {
  let connection: Connection;
  let testData: TestData;
  let config: TestDatabaseConfig;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
    config = setup.config;
    sharedState.connection = connection;
  }, 90_000);

  afterAll(async () => {
    sharedState.connection = null;
    await teardownTestDatabase(connection, config);
  });

  beforeEach(async () => {
    sharedState.activeTransactionID = null;
    sharedState.lastBatchID = null;
    await cleanupTestMeasurements(connection, testData);
    vi.clearAllMocks();
  });

  /** The body IsolatedMultilineDataGridCommons.handleFinalize sends: String(value) per cell, keyed by row id. */
  function buildManualEntryRequest() {
    const plot = testData.plots[0];
    const census = testData.census[0];
    const manualEntryRow = {
      tag: MANUAL_ENTRY_TREE_TAG,
      stemtag: MANUAL_ENTRY_STEM_TAG,
      spcode: testData.species[0].SpeciesCode,
      quadrat: testData.quadrats[0].QuadratName,
      lx: String(MANUAL_ENTRY_LOCAL_X),
      ly: String(MANUAL_ENTRY_LOCAL_Y),
      dbh: String(MANUAL_ENTRY_DBH),
      hom: String(MANUAL_ENTRY_HOM),
      date: MANUAL_ENTRY_DATE,
      codes: '',
      description: '',
      isNew: 'false',
      _error: 'false'
    };
    const body = {
      gridType: MANUAL_ENTRY_GRID_TYPE,
      schema: config.database,
      plot: { plotID: plot.plotID, plotName: plot.plotName },
      census: { plotCensusNumber: census.plotCensusNumber, dateRanges: [{ censusID: census.censusID }] },
      fileRowSet: { '0': manualEntryRow }
    };
    console.log(`[manual-entry] request body: ${JSON.stringify(body)}`);
    return new Request('http://localhost/api/bulkcrud', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }) as any;
  }

  async function coreMeasurementsForBatch(batchID: string): Promise<RowDataPacket[]> {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT cm.CoreMeasurementID, cm.StemGUID, cm.CensusID, cm.MeasuredDBH, cm.MeasuredHOM, cm.MeasurementDate, t.TreeTag, s.StemTag, s.LocalX, s.LocalY
       FROM coremeasurements cm
       LEFT JOIN stems s ON s.StemGUID = cm.StemGUID
       LEFT JOIN trees t ON t.TreeID = s.TreeID
       WHERE cm.UploadFileID = ? AND cm.UploadBatchID = ?`,
      [BULK_CRUD_FILE_ID, batchID]
    );
    return rows;
  }

  async function auditChangedByFor(coreMeasurementID: number): Promise<string[]> {
    const [rows] = await connection.query<RowDataPacket[]>(`SELECT ChangedBy FROM unifiedchangelog WHERE TableName = 'coremeasurements' AND RecordID = ?`, [
      coreMeasurementID
    ]);
    return rows.map(row => String(row.ChangedBy));
  }

  it('ingests the submitted row as a measurement of the selected census and audits it under the signed-in user', async () => {
    const response = await POST(buildManualEntryRequest());
    const responseBody = await response.json();
    console.log(`[manual-entry] status=${response.status} body=${JSON.stringify(responseBody)} batchID=${sharedState.lastBatchID}`);

    expect(response.status, `the manual entry submit must succeed; route said: ${JSON.stringify(responseBody)}`).toBe(HTTPResponses.OK);
    expect(sharedState.lastBatchID, 'the route must stage the rows under a generated batch').not.toBeNull();

    const ingestedRows = await coreMeasurementsForBatch(sharedState.lastBatchID!);
    console.log(`[manual-entry] coremeasurements for batch: ${JSON.stringify(ingestedRows)}`);
    expect(ingestedRows, 'exactly one coremeasurements row for the one submitted grid row').toHaveLength(1);

    const [ingested] = ingestedRows;
    expect(ingested.StemGUID, 'the row must resolve to a stem, not be parked as a failed measurement').not.toBeNull();
    expect(ingested.CensusID).toBe(testData.census[0].censusID);
    expect(ingested.TreeTag).toBe(MANUAL_ENTRY_TREE_TAG);
    expect(ingested.StemTag).toBe(MANUAL_ENTRY_STEM_TAG);
    expect(Number(ingested.MeasuredDBH)).toBe(MANUAL_ENTRY_DBH);
    expect(Number(ingested.MeasuredHOM)).toBe(MANUAL_ENTRY_HOM);
    expect(Number(ingested.LocalX)).toBe(MANUAL_ENTRY_LOCAL_X);
    expect(Number(ingested.LocalY)).toBe(MANUAL_ENTRY_LOCAL_Y);

    const [stagedLeft] = await connection.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM temporarymeasurements WHERE FileID = ? AND BatchID = ?`, [
      BULK_CRUD_FILE_ID,
      sharedState.lastBatchID
    ]);
    expect(Number(stagedLeft[0].total), 'ingestion must consume the staged row').toBe(0);

    const changedBy = await auditChangedByFor(Number(ingested.CoreMeasurementID));
    expect(changedBy, 'one Recent Changes entry attributed to the signed-in user').toEqual([AUTH_USER_EMAIL]);

    // #592 D5: manual entry has the ingestion-snapshot shape and must still export field by field.
    const [manualEntryChange] = (await classifyChangesAfter(connection, config.database, NO_EARLIER_CHANGE)).filter(
      change => change.tableName === 'coremeasurements' && change.recordID === String(ingested.CoreMeasurementID)
    );
    expect(manualEntryChange, 'the manual-entry audit row').toMatchObject({ operation: 'INSERT', isUploadPipelineRow: false, isDetailRow: true });
    const manualEntryRows = (await exportedRowsForPlot(connection, config.database, testData.plots[0].plotID)).filter(
      row => row.LogID === manualEntryChange.changeID
    );
    console.log(`[manual-entry] exported rows:\n${describeExportedRows(manualEntryRows)}`);
    expect(manualEntryRows.length, 'one CSV row per recorded field of the measurement').toBeGreaterThan(1);
    expect(
      manualEntryRows.every(row => row.Action === 'I' && row.ChangedColumn !== SUMMARY_COLUMN_MARKER && row.Old === ''),
      'field-level I rows, never a rollup'
    ).toBe(true);
    expect(manualEntryRows.find(row => row.ChangedColumn === 'MeasuredDBH')?.New).toBe(MANUAL_ENTRY_DBH);
    expect(manualEntryRows.find(row => row.ChangedColumn === 'UploadFileID')?.New).toBe(BULK_CRUD_FILE_ID);
  });
});
