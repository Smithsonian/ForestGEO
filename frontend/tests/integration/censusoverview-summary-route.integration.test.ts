/**
 * Integration tests for GET /api/censusoverview/summary/[schema]/[plotID]/[censusID] (#547).
 *
 * Real local MySQL. getConn is replaced by a thin double over a dedicated real
 * connection, so the snapshot's begin/rollback/release can be observed; the
 * Errors page's facets builder runs through ConnectionManager.executeQuery on a
 * second real connection, as in production.
 *
 * Prerequisites: docker compose up -d mysql
 * Run: npm run test:integration -- tests/integration/censusoverview-summary-route.integration.test.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import mysql, { type Connection } from 'mysql2/promise';
import { createTestDatabase, DEFAULT_TEST_CONFIG, loadSchema, teardownTestDatabase } from '../setup/local-db-setup';
import { loadAppDbSeed } from '../fixtures/ctfs-export/load-app-db-seed';
import { HTTPResponses } from '@/config/macros';
import { buildErrorExplorerFacets } from '@/app/api/errors/explorer/_shared';
import { DEFAULT_ERROR_EXPLORER_FILTERS } from '@/config/errorsexplorer';
import { CENSUS_OVERVIEW_ERROR_CENSUS_IDS_PARAM, TOP_ERROR_TYPE_LIMIT, type CensusOverviewSummary } from '@/config/censusoverview';
import { CENSUS_OVERVIEW_SUMMARY_REQUEST_ERRORS } from '@/lib/censusoverview/summaryrequest';

const LOCAL_HOSTS = ['127.0.0.1', 'localhost'] as const;
const DB_NAME = `forestgeo_censusoverview_route_${process.pid}_${Date.now()}`;
const AUTH_USER_EMAIL = 'integration-runner@forestgeo.test';
const FIELD_CREW_USER_EMAIL = 'field-crew@forestgeo.test';
const GLOBAL_SESSION = { user: { email: AUTH_USER_EMAIL, userStatus: 'global', sites: [] } };
const OUT_OF_SCOPE_SCHEMA = 'forestgeo_panama';
const CENSUS_NOT_FOUND_MESSAGE = 'Census not found';
const REPEATABLE_READ_STATEMENT = /SET TRANSACTION ISOLATION LEVEL REPEATABLE READ/;
const CENSUS_CHECK_STATEMENT = /SELECT CensusID FROM `[a-z0-9_]+`\.census WHERE PlotID = \?/;
const SNAPSHOT_QUERY_EVENT_PREFIX = 'snapshot-query: ';
const SNAPSHOT_BEGIN_EVENT = 'snapshot-begin';
const SNAPSHOT_ROLLBACK_EVENT = 'snapshot-rollback';
const SNAPSHOT_RELEASE_EVENT = 'snapshot-release';
const FACETS_QUERY_EVENT = 'facets-query';

const PLOT_ID = 1;
const OTHER_PLOT_ID = 2;
const CENSUS_A = 1; // app-db-seed census, PlotCensusNumber 1
const CENSUS_B = 2; // same plot, PlotCensusNumber 2 — uq_census_plot_number forbids a true duplicate
const OTHER_PLOT_CENSUS = 3;
const SEED_STEM_GUID = 1;
const FIXTURE_MEASUREMENT_DATE = '2024-06-02';
const FIXTURE_HOM = 1.3;

// Census A: row (CENSUS_A_ERROR_ROW_FIRST_ID + k - 1) carries errors 1..k, so error r is on (ERROR_TYPE_COUNT - r + 1) rows.
const ERROR_TYPE_COUNT = 7;
const FIRST_ERROR_ID = 9301;
const CENSUS_A_ERROR_ROW_FIRST_ID = 101;
const CENSUS_A_UNVALIDATED_ROW_ID = 108; // no log: the facets flag it with their fallback message
const CENSUS_A_UNKNOWN_CODE_ROW_ID = CENSUS_A_ERROR_ROW_FIRST_ID;
const CENSUS_B_ERROR_ROW_ID = 201; // carries error 1
const CENSUS_B_CLEAN_ROW_ID = 202;
const SEED_ROWS = 1;

const CENSUS_A_ACTIVE_ROWS = SEED_ROWS + ERROR_TYPE_COUNT + 1;
const CENSUS_A_EXPORTABLE_ROWS = SEED_ROWS + ERROR_TYPE_COUNT;
const CENSUS_A_AFFECTED_ROWS = ERROR_TYPE_COUNT + 1;
const CENSUS_A_MESSAGE_TYPES = ERROR_TYPE_COUNT + 1;
const CENSUS_B_ACTIVE_ROWS = 2;
const CENSUS_B_AFFECTED_ROWS = 1;
const CENSUS_B_ERROR_RANK = 1;

const ONE_RAW_ERRORS_QUERY_PER_CENSUS = 1;
const DUPLICATE_TREE_TAG = 'DUPLICATE-TAG';
const DUPLICATE_STEM_TAG = '1';
const SAME_BATCH_TREE_TAG = 'SAME-BATCH-TAG';
const SAME_BATCH_FILE_ID = 'contradiction-file';
const SAME_BATCH_ID = 'contradiction-batch';
const DUPLICATE_TAG_ROW_IDS = [CENSUS_A_ERROR_ROW_FIRST_ID, CENSUS_A_ERROR_ROW_FIRST_ID + 1];
const SAME_BATCH_ROW_IDS = [CENSUS_A_ERROR_ROW_FIRST_ID + 2, CENSUS_A_ERROR_ROW_FIRST_ID + 3];
const SAME_BATCH_SPECIES_CODES = ['AAA', 'BBB'];

const errorMessage = (rank: number) => `Overview test error ${rank}`;
const censusAErrorRows = (rank: number) => ERROR_TYPE_COUNT - rank + 1;

const EXPECTED_EXPORT_PREVIEW: CensusOverviewSummary['exportPreview'] = {
  totalActiveMeasurements: CENSUS_A_ACTIVE_ROWS,
  exportableCount: CENSUS_A_EXPORTABLE_ROWS,
  skippedCount: CENSUS_A_ACTIVE_ROWS - CENSUS_A_EXPORTABLE_ROWS,
  skipReasons: [
    { kind: 'not-validated', count: 1 },
    { kind: 'no-stem-guid', count: 0 },
    { kind: 'inactive-stem-or-tree', count: 0 },
    { kind: 'missing-link', count: 0 },
    { kind: 'other', count: 0 }
  ],
  exportedWithUnresolvedErrorCount: ERROR_TYPE_COUNT
};
const EXPECTED_BLOCKERS: CensusOverviewSummary['blockers'] = [{ kind: 'unknown-attribute-code', count: 1 }];

const shared = vi.hoisted(() => ({
  explorerConnection: null as Connection | null,
  executeQueryCalls: 0,
  events: [] as string[]
}));
const mocks = vi.hoisted(() => ({ getConn: vi.fn() }));

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => GLOBAL_SESSION)
}));
vi.mock('@/lib/db/primitives', () => ({ getConn: mocks.getConn }));
vi.mock('@/lib/db/connectionmanager', () => {
  const manager = {
    executeQuery: async (query: string, params?: unknown[]) => {
      shared.executeQueryCalls += 1;
      shared.events.push(FACETS_QUERY_EVENT);
      if (!shared.explorerConnection) throw new Error('Test DB connection not initialized');
      const [rows] = await shared.explorerConnection.query(query, params as any[]);
      return rows;
    },
    closeConnection: async () => undefined
  };
  return { default: { getInstance: () => manager } };
});
vi.mock('@/ailogger', () => ({ default: { info: () => undefined, warn: () => undefined, error: () => undefined } }));

interface SnapshotConnectionDouble {
  query: ReturnType<typeof vi.fn>;
  beginTransaction: ReturnType<typeof vi.fn>;
  rollback: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
}

function buildSnapshotDouble(real: Connection): SnapshotConnectionDouble {
  return {
    query: vi.fn((sql: string, params?: unknown[]) => {
      shared.events.push(`${SNAPSHOT_QUERY_EVENT_PREFIX}${sql}`);
      return real.query(sql, params as any[]);
    }),
    beginTransaction: vi.fn(() => {
      shared.events.push(SNAPSHOT_BEGIN_EVENT);
      return real.beginTransaction();
    }),
    rollback: vi.fn(async () => {
      shared.events.push(SNAPSHOT_ROLLBACK_EVENT);
      await real.rollback();
    }),
    release: vi.fn(() => {
      shared.events.push(SNAPSHOT_RELEASE_EVENT);
    }),
    destroy: vi.fn()
  };
}

function isSnapshotQueryEvent(event: string): boolean {
  return event.startsWith(SNAPSHOT_QUERY_EVENT_PREFIX);
}

async function insertRouteFixture(conn: Connection): Promise<void> {
  await conn.query(`INSERT INTO plots (PlotID, PlotName) VALUES (?, 'Other Plot')`, [OTHER_PLOT_ID]);
  await conn.query(
    `INSERT INTO census (CensusID, PlotID, PlotCensusNumber, StartDate, EndDate, Description, IsActive)
     VALUES (?, ?, 2, '2025-01-01', '2025-12-31', 'Second census on plot 1', 1),
            (?, ?, 1, '2024-01-01', '2024-12-31', 'Census on another plot', 1)`,
    [CENSUS_B, PLOT_ID, OTHER_PLOT_CENSUS, OTHER_PLOT_ID]
  );
  for (let rank = 1; rank <= ERROR_TYPE_COUNT; rank++) {
    await conn.query(`INSERT INTO measurement_errors (ErrorID, ErrorSource, ErrorCode, ErrorMessage) VALUES (?, 'ingestion', ?, ?)`, [
      FIRST_ERROR_ID + rank - 1,
      `OVERVIEW_TEST_${rank}`,
      errorMessage(rank)
    ]);
  }
  const rows = [
    ...Array.from({ length: ERROR_TYPE_COUNT }, (_, index) => ({
      id: CENSUS_A_ERROR_ROW_FIRST_ID + index,
      censusID: CENSUS_A,
      isValidated: true,
      dbh: 21 + index
    })),
    { id: CENSUS_A_UNVALIDATED_ROW_ID, censusID: CENSUS_A, isValidated: false, dbh: 28 },
    { id: CENSUS_B_ERROR_ROW_ID, censusID: CENSUS_B, isValidated: true, dbh: 31 },
    { id: CENSUS_B_CLEAN_ROW_ID, censusID: CENSUS_B, isValidated: true, dbh: 32 }
  ];
  for (const row of rows) {
    await conn.query(
      `INSERT INTO coremeasurements (CoreMeasurementID, CensusID, StemGUID, IsValidated, MeasurementDate, MeasuredDBH, MeasuredHOM, IsActive)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [row.id, row.censusID, SEED_STEM_GUID, row.isValidated, FIXTURE_MEASUREMENT_DATE, row.dbh, FIXTURE_HOM]
    );
    // The facets read measurementssummary. TreeTag stays NULL so no duplicate-tag contradictions form.
    await conn.query(
      `INSERT INTO measurementssummary (CoreMeasurementID, StemGUID, PlotID, CensusID, IsValidated, MeasurementDate, MeasuredDBH, MeasuredHOM)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [row.id, SEED_STEM_GUID, PLOT_ID, row.censusID, row.isValidated, FIXTURE_MEASUREMENT_DATE, row.dbh, FIXTURE_HOM]
    );
  }
  for (let rowIndex = 0; rowIndex < ERROR_TYPE_COUNT; rowIndex++) {
    for (let rank = 1; rank <= rowIndex + 1; rank++) {
      await conn.query(`INSERT INTO measurement_error_log (MeasurementID, ErrorID, IsResolved) VALUES (?, ?, 0)`, [
        CENSUS_A_ERROR_ROW_FIRST_ID + rowIndex,
        FIRST_ERROR_ID + rank - 1
      ]);
    }
  }
  await conn.query(`INSERT INTO measurement_error_log (MeasurementID, ErrorID, IsResolved) VALUES (?, ?, 0)`, [
    CENSUS_B_ERROR_ROW_ID,
    FIRST_ERROR_ID + CENSUS_B_ERROR_RANK - 1
  ]);
  await conn.query(`INSERT INTO cmattributes (CoreMeasurementID, Code) VALUES (?, 'ZZ')`, [CENSUS_A_UNKNOWN_CODE_ROW_ID]);
}

function expectedTopErrorTypes(extraRowsForRank: Record<number, number> = {}) {
  return Array.from({ length: TOP_ERROR_TYPE_LIMIT }, (_, index) => {
    const rank = index + 1;
    return { message: errorMessage(rank), count: censusAErrorRows(rank) + (extraRowsForRank[rank] ?? 0) };
  });
}

describe('GET /api/censusoverview/summary (#547)', () => {
  let setupConnection: Connection;
  let snapshotConnection: Connection;
  let lastSnapshotDouble: SnapshotConnectionDouble | null = null;
  const config = { ...DEFAULT_TEST_CONFIG, database: DB_NAME };

  async function callSummaryRoute(pathPlotID: string, pathCensusID: string, errorCensusIDs: string | null, schema: string = DB_NAME) {
    const query = errorCensusIDs === null ? '' : `?${new URLSearchParams({ [CENSUS_OVERVIEW_ERROR_CENSUS_IDS_PARAM]: errorCensusIDs }).toString()}`;
    const { GET } = await import('@/app/api/censusoverview/summary/[schema]/[plotID]/[censusID]/route');
    return GET(new NextRequest(`http://localhost/api/censusoverview/summary/${schema}/${pathPlotID}/${pathCensusID}${query}`), {
      params: Promise.resolve({ schema, plotID: pathPlotID, censusID: pathCensusID })
    });
  }

  beforeAll(async () => {
    // ConnectionManager defaults to production Azure; refuse unless the host is local.
    const host = process.env.AZURE_SQL_SERVER;
    if (!host || !LOCAL_HOSTS.includes(host as (typeof LOCAL_HOSTS)[number])) {
      throw new Error(`REFUSING TO RUN: ConnectionManager host is '${host}', not local. Aborting to avoid writing to a real database.`);
    }
    setupConnection = await createTestDatabase(config);
    await loadSchema(setupConnection);
    await loadAppDbSeed(setupConnection);
    await insertRouteFixture(setupConnection);
    snapshotConnection = await mysql.createConnection({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: DB_NAME
    });
    shared.explorerConnection = setupConnection;
  }, 90000);

  afterAll(async () => {
    shared.explorerConnection = null;
    await snapshotConnection?.end();
    await teardownTestDatabase(setupConnection, config);
  });

  beforeEach(() => {
    shared.executeQueryCalls = 0;
    shared.events = [];
    lastSnapshotDouble = null;
    mocks.getConn.mockImplementation(async () => {
      lastSnapshotDouble = buildSnapshotDouble(snapshotConnection);
      return lastSnapshotDouble;
    });
  });

  it('denies a schema outside the user scope with 403, taking no connection and running no SQL', async () => {
    const { auth } = await import('@/auth');
    vi.mocked(auth).mockResolvedValueOnce({
      user: { email: 'attacker@forestgeo.test', userStatus: 'field crew', sites: [{ schemaName: OUT_OF_SCOPE_SCHEMA }] }
    } as any);

    const response = await callSummaryRoute(String(PLOT_ID), String(CENSUS_A), String(CENSUS_A));

    expect(response.status).toBe(HTTPResponses.FORBIDDEN);
    expect(mocks.getConn).not.toHaveBeenCalled();
    expect(shared.executeQueryCalls).toBe(0);
  });

  it.each([
    ['a non-integer plot ID', 'abc', String(CENSUS_A), String(CENSUS_A), CENSUS_OVERVIEW_SUMMARY_REQUEST_ERRORS.invalidPlotOrCensusID],
    ['a non-integer census ID', String(PLOT_ID), '1.5', String(CENSUS_A), CENSUS_OVERVIEW_SUMMARY_REQUEST_ERRORS.invalidPlotOrCensusID],
    ['a missing errorCensusIDs', String(PLOT_ID), String(CENSUS_A), null, CENSUS_OVERVIEW_SUMMARY_REQUEST_ERRORS.missingErrorCensusIDs],
    ['a malformed errorCensusIDs', String(PLOT_ID), String(CENSUS_A), `${CENSUS_A},x`, CENSUS_OVERVIEW_SUMMARY_REQUEST_ERRORS.malformedErrorCensusIDs],
    [
      'an errorCensusIDs that omits the path census',
      String(PLOT_ID),
      String(CENSUS_A),
      String(CENSUS_B),
      CENSUS_OVERVIEW_SUMMARY_REQUEST_ERRORS.errorCensusIDsOmitPathCensus
    ]
  ])('rejects %s with 400 before taking a connection', async (_label, plotID, censusID, errorCensusIDs, expectedError) => {
    const response = await callSummaryRoute(plotID, censusID, errorCensusIDs);
    const body = await response.json();
    console.log(`[#547 route 400] ${plotID}/${censusID}?${errorCensusIDs} -> ${response.status} ${JSON.stringify(body)}`);

    expect(response.status).toBe(HTTPResponses.INVALID_REQUEST);
    expect(body).toEqual({ error: expectedError });
    expect(mocks.getConn).not.toHaveBeenCalled();
    expect(shared.executeQueryCalls).toBe(0);
  });

  it('returns 404 when the path census belongs to another plot, rolling back and releasing the connection', async () => {
    const response = await callSummaryRoute(String(PLOT_ID), String(OTHER_PLOT_CENSUS), String(OTHER_PLOT_CENSUS));

    expect(response.status).toBe(HTTPResponses.NOT_FOUND);
    expect(await response.json()).toEqual({ error: CENSUS_NOT_FOUND_MESSAGE });
    expect(lastSnapshotDouble?.rollback).toHaveBeenCalledTimes(1);
    expect(lastSnapshotDouble?.release).toHaveBeenCalledTimes(1);
    expect(shared.executeQueryCalls, 'no facets for a census that is not there').toBe(0);
  });

  it('returns 404 when any census in the errors scope belongs to another plot', async () => {
    const response = await callSummaryRoute(String(PLOT_ID), String(CENSUS_A), `${CENSUS_A},${OTHER_PLOT_CENSUS}`);

    expect(response.status).toBe(HTTPResponses.NOT_FOUND);
    expect(lastSnapshotDouble?.rollback).toHaveBeenCalledTimes(1);
    expect(lastSnapshotDouble?.release).toHaveBeenCalledTimes(1);
  });

  it('returns 404 when a census in the errors scope is inactive, as Publish would', async () => {
    await setupConnection.query('UPDATE census SET IsActive = 0 WHERE CensusID = ?', [CENSUS_B]);
    try {
      const response = await callSummaryRoute(String(PLOT_ID), String(CENSUS_A), `${CENSUS_A},${CENSUS_B}`);
      expect(response.status).toBe(HTTPResponses.NOT_FOUND);
    } finally {
      await setupConnection.query('UPDATE census SET IsActive = 1 WHERE CensusID = ?', [CENSUS_B]);
    }
  });

  it('serves the summary for a seeded census from one rolled-back snapshot, with facets after the rollback', async () => {
    const response = await callSummaryRoute(String(PLOT_ID), String(CENSUS_A), String(CENSUS_A));
    const summary = (await response.json()) as CensusOverviewSummary;
    console.log('[#547 route summary]', JSON.stringify(summary));
    console.log('[#547 route events]', JSON.stringify(shared.events));

    expect(response.status).toBe(HTTPResponses.OK);
    expect(summary).toEqual({
      errorOverview: {
        affectedMeasurements: CENSUS_A_AFFECTED_ROWS,
        totalActiveMeasurements: CENSUS_A_ACTIVE_ROWS,
        topErrorTypes: expectedTopErrorTypes(),
        remainingErrorTypeCount: CENSUS_A_MESSAGE_TYPES - TOP_ERROR_TYPE_LIMIT
      },
      exportPreview: EXPECTED_EXPORT_PREVIEW,
      blockers: EXPECTED_BLOCKERS
    });

    const snapshot = lastSnapshotDouble as SnapshotConnectionDouble;
    expect(snapshot.beginTransaction).toHaveBeenCalledTimes(1);
    expect(snapshot.rollback).toHaveBeenCalledTimes(1);
    expect(snapshot.release).toHaveBeenCalledTimes(1);
    expect(snapshot.destroy).not.toHaveBeenCalled();

    const events = shared.events;
    const rollbackIndex = events.indexOf(SNAPSHOT_ROLLBACK_EVENT);
    const countQueryEvents = events.slice(3, rollbackIndex);
    expect(events[0], 'the isolation level is set first').toMatch(REPEATABLE_READ_STATEMENT);
    expect(events[1], 'the transaction begins immediately after the isolation level, before any read').toBe(SNAPSHOT_BEGIN_EVENT);
    expect(events[2], 'the census check is the first read inside the snapshot').toMatch(CENSUS_CHECK_STATEMENT);
    expect(countQueryEvents.length, 'the count queries run between the census check and the rollback').toBeGreaterThan(0);
    expect(countQueryEvents.every(isSnapshotQueryEvent), 'only snapshot queries run inside the transaction').toBe(true);
    expect(events[rollbackIndex + 1], 'the connection is released right after the rollback').toBe(SNAPSHOT_RELEASE_EVENT);
    expect(events.indexOf(FACETS_QUERY_EVENT), 'facets run outside the snapshot').toBeGreaterThan(rollbackIndex);
    expect(shared.executeQueryCalls, 'one raw-errors query for the one census, and no contradiction queries').toBe(ONE_RAW_ERRORS_QUERY_PER_CENSUS);
  });

  it('serves an in-scope field-crew member, who has no export permission, the same publish-scope summary', async () => {
    const { auth } = await import('@/auth');
    const fieldCrewSession = { user: { email: FIELD_CREW_USER_EMAIL, userStatus: 'field crew', sites: [{ schemaName: DB_NAME }] } };
    // Persistent, not Once: a second session read inside the handler (the publish route's export-role gate) must also see field crew.
    vi.mocked(auth).mockResolvedValue(fieldCrewSession as any);
    try {
      const response = await callSummaryRoute(String(PLOT_ID), String(CENSUS_A), String(CENSUS_A));
      const summary = (await response.json()) as CensusOverviewSummary;
      console.log(`[#547 route field crew] ${response.status} ${JSON.stringify(summary)}`);

      expect(response.status, 'any site member may read the publish facts; no export role is required').toBe(HTTPResponses.OK);
      expect(summary.exportPreview).toEqual(EXPECTED_EXPORT_PREVIEW);
      expect(summary.blockers).toEqual(EXPECTED_BLOCKERS);
    } finally {
      vi.mocked(auth).mockResolvedValue(GLOBAL_SESSION as any);
    }
  });

  it('reports the same error counts as the Errors page when duplicate-tag and same-batch contradictions exist', async () => {
    await setupConnection.query('UPDATE measurementssummary SET TreeTag = ?, StemTag = ? WHERE CoreMeasurementID IN (?)', [
      DUPLICATE_TREE_TAG,
      DUPLICATE_STEM_TAG,
      DUPLICATE_TAG_ROW_IDS
    ]);
    await setupConnection.query('UPDATE coremeasurements SET UploadFileID = ?, UploadBatchID = ? WHERE CoreMeasurementID IN (?)', [
      SAME_BATCH_FILE_ID,
      SAME_BATCH_ID,
      SAME_BATCH_ROW_IDS
    ]);
    for (const [index, measurementID] of SAME_BATCH_ROW_IDS.entries()) {
      await setupConnection.query('UPDATE measurementssummary SET TreeTag = ?, SpeciesCode = ? WHERE CoreMeasurementID = ?', [
        SAME_BATCH_TREE_TAG,
        SAME_BATCH_SPECIES_CODES[index],
        measurementID
      ]);
    }
    try {
      shared.executeQueryCalls = 0;
      const response = await callSummaryRoute(String(PLOT_ID), String(CENSUS_A), String(CENSUS_A));
      const summary = (await response.json()) as CensusOverviewSummary;
      const overviewQueryCount = shared.executeQueryCalls;

      const { default: ConnectionManager } = await import('@/lib/db/connectionmanager');
      const errorsPageFacets = await buildErrorExplorerFacets(ConnectionManager.getInstance(), {
        schema: DB_NAME,
        plotID: PLOT_ID,
        censusID: CENSUS_A,
        censusIDs: [CENSUS_A],
        filters: DEFAULT_ERROR_EXPLORER_FILTERS
      });
      console.log('[#547 contradictions] overview', JSON.stringify(summary.errorOverview));
      console.log(
        '[#547 contradictions] errors page',
        JSON.stringify({ total: errorsPageFacets.totalMeasurements, contradictions: errorsPageFacets.contradictionCounts })
      );

      expect(errorsPageFacets.contradictionCounts.duplicateTagStem, 'the Errors page must see the duplicate-tag contradiction').toBe(
        DUPLICATE_TAG_ROW_IDS.length
      );
      expect(errorsPageFacets.contradictionCounts.sameBatchConflict, 'the Errors page must see the same-batch contradiction').toBe(SAME_BATCH_ROW_IDS.length);
      expect(response.status).toBe(HTTPResponses.OK);
      expect(summary.errorOverview.affectedMeasurements).toBe(errorsPageFacets.totalMeasurements);
      expect(summary.errorOverview.topErrorTypes).toEqual(
        errorsPageFacets.messages.slice(0, TOP_ERROR_TYPE_LIMIT).map(({ value, count }) => ({ message: value, count }))
      );
      expect(overviewQueryCount, 'the overview skips the contradiction queries the Errors page runs').toBe(ONE_RAW_ERRORS_QUERY_PER_CENSUS);
    } finally {
      await setupConnection.query('UPDATE measurementssummary SET TreeTag = NULL, StemTag = NULL, SpeciesCode = NULL WHERE CoreMeasurementID IN (?)', [
        [...DUPLICATE_TAG_ROW_IDS, ...SAME_BATCH_ROW_IDS]
      ]);
      await setupConnection.query('UPDATE coremeasurements SET UploadFileID = NULL, UploadBatchID = NULL WHERE CoreMeasurementID IN (?)', [SAME_BATCH_ROW_IDS]);
    }
  });

  it('counts errors over the whole grouped census while the export preview and blockers stay on the publish census', async () => {
    const response = await callSummaryRoute(String(PLOT_ID), String(CENSUS_A), `${CENSUS_A},${CENSUS_B}`);
    const summary = (await response.json()) as CensusOverviewSummary;
    console.log('[#547 grouped census]', JSON.stringify(summary));

    expect(response.status).toBe(HTTPResponses.OK);
    expect(summary.errorOverview).toEqual({
      affectedMeasurements: CENSUS_A_AFFECTED_ROWS + CENSUS_B_AFFECTED_ROWS,
      totalActiveMeasurements: CENSUS_A_ACTIVE_ROWS + CENSUS_B_ACTIVE_ROWS,
      topErrorTypes: expectedTopErrorTypes({ [CENSUS_B_ERROR_RANK]: CENSUS_B_AFFECTED_ROWS }),
      remainingErrorTypeCount: CENSUS_A_MESSAGE_TYPES - TOP_ERROR_TYPE_LIMIT
    });
    expect(summary.exportPreview, 'publish scope only').toEqual(EXPECTED_EXPORT_PREVIEW);
    expect(summary.blockers, 'publish scope only').toEqual(EXPECTED_BLOCKERS);
  });
});
