import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import {
  getFailedMeasurements,
  insertTestMeasurements,
  runBulkIngestion,
  setupTestDatabase,
  teardownTestDatabase,
  type TestData
} from '../setup/local-db-setup';

// The transaction-checking ConnectionManager double of editplan-revert.integration.test.ts:11-58, with executeQuery as
// a spy so the 403 case can prove no SQL ran; auth as in refreshviews-authz.integration.test.ts.
const sharedState = vi.hoisted(() => ({
  connection: null as Connection | null,
  activeTransactionID: null as string | null,
  transactionCounter: 0
}));

const TEST_TRANSACTION_ID_PREFIX = 'refreshviews-ids-transaction-';
const AUTH_USER_EMAIL = 'integration-runner@forestgeo.test';

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { email: AUTH_USER_EMAIL, userStatus: 'global', sites: [] } }))
}));

vi.mock('@/lib/db/connectionmanager', () => {
  const executeQuery = vi.fn(async (query: string, params?: unknown[], transactionID?: string) => {
    if (!sharedState.connection) throw new Error('Test DB connection not initialized');
    if (transactionID && transactionID !== sharedState.activeTransactionID) {
      throw new Error(`ConnectionManager mock: transactionID mismatch (got "${transactionID}", active "${sharedState.activeTransactionID}")`);
    }
    const [rows] = await sharedState.connection.query(query, (params as unknown[]) ?? []);
    return rows;
  });
  const manager = {
    executeQuery,
    beginTransaction: async () => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      if (sharedState.activeTransactionID) throw new Error('ConnectionManager mock: transaction already active');
      await sharedState.connection.beginTransaction();
      sharedState.transactionCounter += 1;
      sharedState.activeTransactionID = `${TEST_TRANSACTION_ID_PREFIX}${sharedState.transactionCounter}`;
      return sharedState.activeTransactionID;
    },
    commitTransaction: async (transactionID: string) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      if (transactionID !== sharedState.activeTransactionID) throw new Error('ConnectionManager mock: commit transactionID mismatch');
      await sharedState.connection.commit();
      sharedState.activeTransactionID = null;
    },
    rollbackTransaction: async (transactionID: string) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      if (transactionID !== sharedState.activeTransactionID) throw new Error('ConnectionManager mock: rollback transactionID mismatch');
      await sharedState.connection.rollback();
      sharedState.activeTransactionID = null;
    },
    cleanupStaleTransactions: async () => undefined,
    closeConnection: async () => undefined,
    acquireApplicationLock: async () => true
  };
  return { default: { getInstance: () => manager } };
});

vi.mock('@/ailogger', () => ({ default: { info: () => undefined, warn: () => undefined, error: () => undefined } }));

import { auth } from '@/auth';
import ConnectionManager from '@/lib/db/connectionmanager';
import { HTTPResponses } from '@/config/macros';
import { applyEdit } from '@/config/editplan/apply';
import { refreshMeasurementViewsForScope } from '@/lib/measurementviewrefresh';
import { POST } from '@/app/api/refreshviews/[view]/[schema]/route';

const OUT_OF_SCOPE_SCHEMA = 'forestgeo_panama';
const CREATED_BY = 'refreshviews-ids-integration';
const PAIR_TREE_TAG = 'R4PAIR';
const CLEAN_TREE_TAG = 'R4CLEAN';
const FAILED_TREE_TAG = 'R4FAIL';
const FIRST_STEM_TAG = 'S1';
const SECOND_STEM_TAG = 'S2';
const UNKNOWN_SPECIES_CODE = 'R4NOSUCHSP';
const ALIVE_CODE = 'A';
const MEASUREMENT_DATE = '2024-06-15';
const SEEDED_HOM = 1.3;
const PAIR_FIRST_DBH = 100;
const PAIR_SECOND_DBH = 80;
const CLEAN_DBH = 60;
const FAILED_DBH = 50;
const EDITED_DBH = 91;
const FAILED_ROW_EDITED_DBH = 77;
const DBH_DECIMALS = 2;
const STALE_SENTINEL_DESCRIPTION = 'r4-stale-sentinel';
const SAME_BATCH_CONFLICT_VALIDATION_CODE = '21';
const SETUP_TIMEOUT_MS = 120_000;
const REFRESHED_VIEWS = ['measurementssummary', 'viewfulltable'] as const;
type RefreshedView = (typeof REFRESHED_VIEWS)[number];

describe('POST /api/refreshviews/[view]/[schema] with coreMeasurementIDs (#544 remedy R4)', () => {
  let connection: Connection;
  let testData: TestData;
  let schema: string;
  let plotID: number;
  let censusID: number;
  let loggedPairID: number;
  let unloggedPairID: number;
  let cleanID: number;
  let failedID: number;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
    schema = setup.config.database;
    sharedState.connection = connection;
    plotID = testData.plots[0].plotID;
    censusID = testData.census[0].censusID;
    const [firstSpecies, secondSpecies] = testData.species;
    const quadratName = testData.quadrats[0].QuadratName;
    const seeded = { quadratName, hom: SEEDED_HOM, date: MEASUREMENT_DATE, codes: ALIVE_CODE };

    const linked = await insertTestMeasurements(connection, testData, [
      { ...seeded, treeTag: PAIR_TREE_TAG, stemTag: FIRST_STEM_TAG, speciesCode: firstSpecies.SpeciesCode, x: 10, y: 10, dbh: PAIR_FIRST_DBH },
      { ...seeded, treeTag: PAIR_TREE_TAG, stemTag: SECOND_STEM_TAG, speciesCode: secondSpecies.SpeciesCode, x: 10, y: 10.5, dbh: PAIR_SECOND_DBH },
      { ...seeded, treeTag: CLEAN_TREE_TAG, stemTag: FIRST_STEM_TAG, speciesCode: firstSpecies.SpeciesCode, x: 12, y: 12, dbh: CLEAN_DBH }
    ]);
    const linkedIngestion = await runBulkIngestion(connection, linked.fileID, linked.batchID);
    expect(linkedIngestion.success, linkedIngestion.message).toBe(true);

    const failed = await insertTestMeasurements(connection, testData, [
      { ...seeded, treeTag: FAILED_TREE_TAG, stemTag: FIRST_STEM_TAG, speciesCode: UNKNOWN_SPECIES_CODE, x: 14, y: 14, dbh: FAILED_DBH }
    ]);
    const failedIngestion = await runBulkIngestion(connection, failed.fileID, failed.batchID);
    expect(failedIngestion.batch_failed, JSON.stringify(failedIngestion)).toBe(false);

    const [linkedRows] = await connection.query<RowDataPacket[]>(
      `SELECT cm.CoreMeasurementID, t.TreeTag, s.StemTag,
              EXISTS (SELECT 1 FROM measurement_error_log mel JOIN measurement_errors me ON me.ErrorID = mel.ErrorID
                       WHERE mel.MeasurementID = cm.CoreMeasurementID AND me.ErrorSource = 'validation'
                         AND me.ErrorCode = ? AND mel.IsResolved = FALSE) AS SameBatchConflictLogged
         FROM coremeasurements cm
         JOIN stems s ON s.StemGUID = cm.StemGUID
         JOIN trees t ON t.TreeID = s.TreeID
        WHERE cm.UploadBatchID = ?
        ORDER BY cm.CoreMeasurementID`,
      [SAME_BATCH_CONFLICT_VALIDATION_CODE, linked.batchID]
    );
    console.log('[view-errors refreshviews ids seed]', JSON.stringify(linkedRows));
    const pairRows = linkedRows.filter(row => row.TreeTag === PAIR_TREE_TAG);
    const loggedPairRows = pairRows.filter(row => Number(row.SameBatchConflictLogged) === 1);
    expect(pairRows, 'both pair rows were linked').toHaveLength(2);
    expect(loggedPairRows, 'validation 21 logs exactly one row of the pair').toHaveLength(1);
    loggedPairID = Number(loggedPairRows[0].CoreMeasurementID);
    unloggedPairID = Number(pairRows.find(row => Number(row.CoreMeasurementID) !== loggedPairID)?.CoreMeasurementID);
    const cleanRow = linkedRows.find(row => row.TreeTag === CLEAN_TREE_TAG);
    if (!cleanRow) throw new Error(`seed: no linked ${CLEAN_TREE_TAG} row in ${JSON.stringify(linkedRows)}`);
    cleanID = Number(cleanRow.CoreMeasurementID);

    const failedRows = await getFailedMeasurements(connection, { fileID: failed.fileID, batchID: failed.batchID });
    expect(failedRows, 'the unknown species parks exactly one row').toHaveLength(1);
    failedID = failedRows[0].FailedMeasurementID;

    await refreshMeasurementViewsForScope(ConnectionManager.getInstance(), schema, plotID, censusID);
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    sharedState.connection = null;
    sharedState.activeTransactionID = null;
    await teardownTestDatabase(connection);
  });

  async function storedRows(view: RefreshedView, coreMeasurementIDs: number[]): Promise<RowDataPacket[]> {
    const [rows] = await connection.query<RowDataPacket[]>('SELECT * FROM ?? WHERE CoreMeasurementID IN (?) ORDER BY CoreMeasurementID', [
      view,
      coreMeasurementIDs
    ]);
    return rows;
  }

  async function snapshot(coreMeasurementIDs: number[]): Promise<Record<RefreshedView, string>> {
    return {
      measurementssummary: JSON.stringify(await storedRows('measurementssummary', coreMeasurementIDs)),
      viewfulltable: JSON.stringify(await storedRows('viewfulltable', coreMeasurementIDs))
    };
  }

  /** Makes one row of each view visibly stale, so a request that rebuilds more than it names is caught. */
  async function markStale(coreMeasurementID: number): Promise<void> {
    for (const view of REFRESHED_VIEWS) {
      await connection.query('UPDATE ?? SET Description = ? WHERE CoreMeasurementID = ?', [view, STALE_SENTINEL_DESCRIPTION, coreMeasurementID]);
    }
  }

  async function storedDescriptions(coreMeasurementID: number): Promise<Record<RefreshedView, unknown>> {
    const [summary] = await storedRows('measurementssummary', [coreMeasurementID]);
    const [fullTable] = await storedRows('viewfulltable', [coreMeasurementID]);
    return { measurementssummary: summary?.Description, viewfulltable: fullTable?.Description };
  }

  async function postRefresh(view: RefreshedView, body: unknown): Promise<{ status: number; body: unknown }> {
    const request = new Request(`http://localhost/api/refreshviews/${view}/${schema}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const response = await POST(request as never, { params: Promise.resolve({ view, schema }) } as never);
    return { status: response.status, body: await response.json() };
  }

  /** The explorer's two client rebuilds after a save or an undo (Task 19's requestMeasurementViewRebuilds). */
  async function requestMeasurementRebuilds(coreMeasurementIDs: number[]): Promise<void> {
    for (const view of REFRESHED_VIEWS) {
      const response = await postRefresh(view, { coreMeasurementIDs });
      console.log('[view-errors refreshviews ids request]', view, JSON.stringify({ coreMeasurementIDs, ...response }));
      expect(response.status, `${view}: ${JSON.stringify(response.body)}`).toBe(HTTPResponses.OK);
    }
  }

  it("rebuilds a validation-21 pair's edited row, leaves the unlogged partner as it was, and matches a whole-scope rebuild", async () => {
    const partnerBeforeEdit = await snapshot([unloggedPairID]);
    await applyEdit(ConnectionManager.getInstance(), {
      dataType: 'measurementssummary',
      schema,
      plotID,
      censusID,
      targetID: loggedPairID,
      newRow: { MeasuredDBH: EDITED_DBH },
      expectedPlanHash: null,
      createdBy: CREATED_BY
    });
    const partnerAfterEdit = await snapshot([unloggedPairID]);
    await markStale(cleanID);
    await requestMeasurementRebuilds([loggedPairID]);
    const afterRequests = await snapshot([unloggedPairID, loggedPairID]);
    const sentinel = await storedDescriptions(cleanID);
    const [editedSummary] = await storedRows('measurementssummary', [loggedPairID]);
    console.log(
      '[view-errors refreshviews ids pair]',
      JSON.stringify({ loggedPairID, unloggedPairID, cleanID, sentinel, editedDBH: editedSummary?.MeasuredDBH, editedErrors: editedSummary?.Errors })
    );
    expect(sentinel, 'a row outside coreMeasurementIDs is not rebuilt').toEqual({
      measurementssummary: STALE_SENTINEL_DESCRIPTION,
      viewfulltable: STALE_SENTINEL_DESCRIPTION
    });
    expect(partnerAfterEdit, "the edit leaves the unlogged partner's stored rows as they were").toEqual(partnerBeforeEdit);
    expect(Number(editedSummary?.MeasuredDBH)).toBeCloseTo(EDITED_DBH, DBH_DECIMALS);
    await refreshMeasurementViewsForScope(ConnectionManager.getInstance(), schema, plotID, censusID);
    expect(afterRequests, 'the pair rows equal a whole-scope rebuild of them').toEqual(await snapshot([unloggedPairID, loggedPairID]));
  });

  it('rebuilds a failed row, whose writer refreshes no view, and matches a whole-scope rebuild', async () => {
    await applyEdit(ConnectionManager.getInstance(), {
      dataType: 'failedmeasurements',
      schema,
      plotID,
      censusID,
      targetID: failedID,
      newRow: { DBH: FAILED_ROW_EDITED_DBH },
      expectedPlanHash: null,
      createdBy: CREATED_BY
    });
    const [staleSummary] = await storedRows('measurementssummary', [failedID]);
    console.log('[view-errors refreshviews ids failed row after apply]', JSON.stringify({ failedID, storedDBH: staleSummary?.MeasuredDBH }));
    expect(staleSummary, "beforeAll's scope rebuild stored the failed row").toBeDefined();
    expect(Number(staleSummary?.MeasuredDBH), 'writeFailedMeasurements leaves its own stored row stale').not.toBeCloseTo(FAILED_ROW_EDITED_DBH, DBH_DECIMALS);
    await markStale(cleanID);
    await requestMeasurementRebuilds([failedID]);
    const afterRequests = await snapshot([failedID]);
    const [summary] = await storedRows('measurementssummary', [failedID]);
    const [fullTable] = await storedRows('viewfulltable', [failedID]);
    const sentinel = await storedDescriptions(cleanID);
    console.log(
      '[view-errors refreshviews ids failed row]',
      JSON.stringify({ sentinel, summaryDBH: summary?.MeasuredDBH, fullTableDBH: fullTable?.MeasuredDBH })
    );
    expect(sentinel, 'a row outside coreMeasurementIDs is not rebuilt').toEqual({
      measurementssummary: STALE_SENTINEL_DESCRIPTION,
      viewfulltable: STALE_SENTINEL_DESCRIPTION
    });
    expect(Number(summary?.MeasuredDBH)).toBeCloseTo(FAILED_ROW_EDITED_DBH, DBH_DECIMALS);
    expect(Number(fullTable?.MeasuredDBH)).toBeCloseTo(FAILED_ROW_EDITED_DBH, DBH_DECIMALS);
    await refreshMeasurementViewsForScope(ConnectionManager.getInstance(), schema, plotID, censusID);
    expect(afterRequests, 'the failed row equals a whole-scope rebuild of it').toEqual(await snapshot([failedID]));
  });

  it('denies an out-of-scope schema with 403 for a coreMeasurementIDs body and runs no SQL', async () => {
    vi.mocked(auth).mockResolvedValueOnce({
      user: { email: 'attacker@forestgeo.test', userStatus: 'field crew', sites: [{ schemaName: OUT_OF_SCOPE_SCHEMA }] }
    } as never);
    const executeQuery = vi.mocked(ConnectionManager.getInstance().executeQuery);
    executeQuery.mockClear();
    const response = await postRefresh('measurementssummary', { coreMeasurementIDs: [loggedPairID] });
    console.log('[view-errors refreshviews ids 403]', JSON.stringify({ ...response, statements: executeQuery.mock.calls.length }));
    expect(response.status).toBe(HTTPResponses.FORBIDDEN);
    expect(executeQuery).not.toHaveBeenCalled();
  });
});
