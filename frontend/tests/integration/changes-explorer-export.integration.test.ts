/**
 * POST /api/changes/explorer/export (#592) against real local MySQL: the route, above the reader.
 *
 * What the reader reads, in what order and from which snapshot is proven in
 * changes-explorer-export-snapshot.integration.test.ts. This file proves what the route adds:
 * authorization before any connection is taken, request validation, the CSV response, the status
 * and body of every failure, what the export's own logs may contain, and the success telemetry.
 *
 * Prerequisites: docker compose up -d mysql
 * Run: ~/dev/ForestGEO/docs/relay-integration.sh <checkout> -- tests/integration/changes-explorer-export.integration.test.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import Papa from 'papaparse';
import mysql, { type Connection } from 'mysql2/promise';
import { setupTestDatabase, teardownTestDatabase, type TestDatabaseConfig } from '../setup/local-db-setup';
import type { ExportColumn } from './helpers/changeexportprobe';
import { createChangeExportSeeder, SEED_CHANGED_BY, type ChangeExportSeeder } from './helpers/changeexportseed';
import { HTTPResponses } from '@/config/macros';
import { EXPORT_COLUMNS, SUMMARY_COLUMN_MARKER } from '@/config/changelogexport';
import { CHANGE_EXPORT_ERROR_CODES, DEFAULT_RECENT_CHANGES_FILTERS, type RecentChangesFilters } from '@/config/recentchangesexplorer';
import { ChangelogOperation } from '@/lib/changelog/record-mutation';
import type { ChangeExportLimits } from '@/lib/changes/exportsnapshot';
import { ROUTE_POLICIES } from '@/lib/route-policy';
import { fromBody, withRouteAuthz } from '@/lib/route-authz';
import { createChangeExportHandler } from '@/app/api/changes/explorer/export/handler';

const LOCAL_HOSTS = ['127.0.0.1', 'localhost'] as const;
const AUTH_USER_EMAIL = 'change-export-runner@forestgeo.test';
const GLOBAL_SESSION = { user: { email: AUTH_USER_EMAIL, userStatus: 'global', sites: [] } };
const OUT_OF_SCOPE_SCHEMA = 'forestgeo_panama';
const ROUTE_KEY = 'changes/explorer/export';
const ROUTE_CONTEXT = { params: Promise.resolve({}) };
const CSV_CONTENT_TYPE = 'text/csv; charset=utf-8';
const EXPORT_SUCCEEDED_EVENT = 'RecentChangesCsvExported';
const GENEROUS_LIMITS: ChangeExportLimits = { maxRows: 10_000, pageSize: 2 };

const UPLOAD_FILE = 'export-route-census.csv';
const UPLOAD_BATCH = 'routebatch__sub001';
const UPLOAD_BASE_BATCH = 'routebatch';
/** Three bytes per character in UTF-8, so the CSV's byte length differs from its character count. */
const NON_ASCII_QUADRAT_NAME = 'EXPORT-Q-森林';
const TIME_FIRST = '2026-03-10 09:00:00';
const TIME_SECOND = '2026-03-10 10:00:00';
const TIME_THIRD = '2026-03-10 11:00:00';
const DETAIL_PAGE_ORDER = 'ORDER BY uc.ChangeTimestamp, uc.ChangeID';

const SECRET_FILTER_TERM = 'SECRET-FILTER-TERM';
const SECRET_CELL_VALUE = 'SECRET-CELL-VALUE';
const SECRET_DRIVER_TEXT = 'SECRET-DRIVER-TEXT';
const DRIVER_CODE = 'ER_LOCK_DEADLOCK';

const shared = vi.hoisted(() => ({ connection: null as Connection | null }));
const mocks = vi.hoisted(() => ({ getConn: vi.fn(), logError: vi.fn(), logWarn: vi.fn(), logEvent: vi.fn() }));

vi.mock('@/auth', () => ({ auth: vi.fn(async () => GLOBAL_SESSION) }));
vi.mock('@/lib/db/primitives', () => ({ getConn: mocks.getConn }));
vi.mock('@/lib/db/connectionmanager', () => {
  const manager = {
    executeQuery: async (query: string, params?: unknown[]) => {
      if (!shared.connection) throw new Error('Test DB connection not initialized');
      const [rows] = await shared.connection.query(query, params);
      return rows;
    },
    closeConnection: async () => undefined
  };
  return { default: { getInstance: () => manager } };
});
vi.mock('@/ailogger', () => ({ default: { info: () => undefined, warn: mocks.logWarn, error: mocks.logError, event: mocks.logEvent } }));

type CsvRow = Record<ExportColumn, string>;

describe('POST /api/changes/explorer/export', () => {
  let connection: Connection;
  let ownedConnection: Connection;
  let config: TestDatabaseConfig;
  let schema: string;
  let plotID: number;
  let censusID: number;
  let seed: ChangeExportSeeder;
  let ownedQuery: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    // ConnectionManager and getConn default to production Azure; refuse unless the host is local.
    const host = process.env.AZURE_SQL_SERVER;
    if (!host || !LOCAL_HOSTS.includes(host as (typeof LOCAL_HOSTS)[number])) {
      throw new Error(`REFUSING TO RUN: ConnectionManager host is '${host}', not local. Aborting to avoid writing to a real database.`);
    }
    const setup = await setupTestDatabase();
    connection = setup.connection;
    config = setup.config;
    schema = config.database;
    plotID = setup.testData.plots[0].plotID;
    censusID = setup.testData.census[0].censusID;
    shared.connection = connection;
    seed = createChangeExportSeeder({ connection, schema, plotID, censusID });
    ownedConnection = await mysql.createConnection({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database
    });
  }, 90_000);

  afterAll(async () => {
    shared.connection = null;
    await ownedConnection?.end();
    await teardownTestDatabase(connection, config);
  });

  beforeEach(async () => {
    await connection.query('DELETE FROM unifiedchangelog');
    await connection.query('DELETE FROM coremeasurements WHERE UploadFileID = ?', [UPLOAD_FILE]);
    ownedQuery = vi.fn((sql: string, params?: unknown[]) => ownedConnection.query(sql, params));
    mocks.getConn.mockImplementation(async () => ({
      query: ownedQuery,
      beginTransaction: () => ownedConnection.beginTransaction(),
      rollback: () => ownedConnection.rollback(),
      release: () => undefined,
      destroy: () => undefined
    }));
  });

  function postExport(body: Record<string, unknown>, limits: ChangeExportLimits = GENEROUS_LIMITS): Promise<Response> {
    const POST = withRouteAuthz(ROUTE_KEY, createChangeExportHandler(limits), { schema: fromBody('schema') });
    const request = new NextRequest('http://localhost/api/changes/explorer/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return Promise.resolve(POST(request, ROUTE_CONTEXT));
  }

  function exportBody(filters: Partial<RecentChangesFilters> = {}): Record<string, unknown> {
    return { schema, plotID, filters: { ...DEFAULT_RECENT_CHANGES_FILTERS, ...filters } };
  }

  function loggedText(): string {
    return [...mocks.logError.mock.calls, ...mocks.logWarn.mock.calls]
      .flat()
      .map(argument => (argument instanceof Error ? `${argument.message}\n${argument.stack}` : JSON.stringify(argument)))
      .join('\n');
  }

  async function seedQuadratInsert(recordID: number, state: Record<string, unknown>, changeTime: string): Promise<number> {
    return seed.recordGridChange({ tableName: 'quadrats', recordID, operation: ChangelogOperation.INSERT, newRowState: state, plotID, changeTime });
  }

  async function expectExportFailed(response: Response): Promise<void> {
    expect(response.status).toBe(HTTPResponses.INTERNAL_SERVER_ERROR);
    expect(await response.json(), 'a fixed body with no driver text').toEqual({
      error: 'Unable to export the change log',
      code: CHANGE_EXPORT_ERROR_CODES.failed
    });
    expect(mocks.logEvent, 'a failed export emits no success event').not.toHaveBeenCalled();
  }

  describe('the CSV response', () => {
    it('returns the change log as CSV and reports what it wrote', async () => {
      const quadratInsert = await seedQuadratInsert(701, { QuadratID: 701, QuadratName: NON_ASCII_QUADRAT_NAME }, TIME_FIRST);
      await seed.recordGridChange({
        tableName: 'trees',
        recordID: 7102,
        operation: ChangelogOperation.UPDATE,
        oldRowState: { TreeID: 7102, UpdatedAt: '2026-03-01 00:00:00' },
        newRowState: { TreeID: 7102, UpdatedAt: '2026-03-10 10:00:00' },
        plotID,
        changeTime: TIME_SECOND
      });
      await seed.insertMeasurement(UPLOAD_FILE, UPLOAD_BATCH, 'ROUTE-T1', 11);
      await seed.insertMeasurement(UPLOAD_FILE, UPLOAD_BATCH, 'ROUTE-T2', 12);
      const uploadMembers = await seed.auditCommittedUpload(UPLOAD_FILE, UPLOAD_BATCH, plotID, TIME_THIRD);

      const response = await postExport(exportBody());
      const text = await response.text();
      console.log(`[change-export route] status=${response.status}\n${text}`);

      expect(response.status, `export must succeed; body: ${text.slice(0, 500)}`).toBe(HTTPResponses.OK);
      expect(response.headers.get('Content-Type')).toBe(CSV_CONTENT_TYPE);
      expect(response.headers.get('Content-Disposition')).toMatch(
        new RegExp(`^attachment; filename="changelog-${schema}-plot${plotID}-\\d{4}-\\d{2}-\\d{2}\\.csv"$`)
      );

      const parsed = Papa.parse<CsvRow>(text, { header: true });
      expect(parsed.errors, `CSV parse errors: ${JSON.stringify(parsed.errors)}`).toEqual([]);
      expect(parsed.meta.fields, 'header row').toEqual([...EXPORT_COLUMNS]);
      const changeDate = TIME_FIRST.slice(0, 'YYYY-MM-DD'.length);
      expect(parsed.data, 'every cell of every row').toEqual([
        {
          LogID: String(quadratInsert),
          ChangedBy: SEED_CHANGED_BY,
          ChangedTable: 'quadrats',
          PrimaryKey: '701',
          ChangedColumn: 'QuadratID',
          ChangeDate: changeDate,
          ChangeTime: TIME_FIRST,
          Description: 'Added quadrats 701',
          Action: 'I',
          Old: '',
          New: '701',
          PlotID: String(plotID),
          CensusID: ''
        },
        {
          LogID: String(quadratInsert),
          ChangedBy: SEED_CHANGED_BY,
          ChangedTable: 'quadrats',
          PrimaryKey: '701',
          ChangedColumn: 'QuadratName',
          ChangeDate: changeDate,
          ChangeTime: TIME_FIRST,
          Description: 'Added quadrats 701',
          Action: 'I',
          Old: '',
          New: NON_ASCII_QUADRAT_NAME,
          PlotID: String(plotID),
          CensusID: ''
        },
        {
          LogID: String(Math.min(...uploadMembers)),
          ChangedBy: SEED_CHANGED_BY,
          ChangedTable: 'coremeasurements',
          PrimaryKey: UPLOAD_FILE,
          ChangedColumn: SUMMARY_COLUMN_MARKER,
          ChangeDate: changeDate,
          ChangeTime: TIME_THIRD,
          Description: `Upload ${UPLOAD_FILE}: added ${uploadMembers.length} measurement rows (batch ${UPLOAD_BASE_BATCH})`,
          Action: 'I',
          Old: '',
          New: '',
          PlotID: String(plotID),
          CensusID: String(censusID)
        }
      ]);

      expect(mocks.getConn, 'one owned connection per export').toHaveBeenCalledTimes(1);
      expect(mocks.logEvent, 'one success event').toHaveBeenCalledTimes(1);
      const [eventName, eventProperties] = mocks.logEvent.mock.calls[0];
      expect(eventName).toBe(EXPORT_SUCCEEDED_EVENT);
      expect(eventProperties, 'changeCount = 2 detail changes read + 2 rollup members; the no-difference update is suppressed').toMatchObject({
        schema,
        plotID,
        changeCount: 2 + uploadMembers.length,
        suppressedChangeCount: 1,
        rowCount: parsed.data.length
      });
      expect(eventProperties.outputBytes, 'bytes of the CSV actually sent').toBe(Buffer.byteLength(text, 'utf8'));
      expect(eventProperties.outputBytes, 'a multi-byte value makes bytes exceed characters, so a character count would fail here').toBeGreaterThan(
        text.length
      );
      expect(eventProperties.durationMs).toEqual(expect.any(Number));
    });

    it('answers a body with no filters, and an empty change log is the header alone', async () => {
      const response = await postExport({ schema, plotID });

      expect(response.status, 'a body with no filters is a supported request').toBe(HTTPResponses.OK);
      expect(await response.text()).toBe(EXPORT_COLUMNS.join(','));
    });
  });

  describe('failures', () => {
    it('answers 413 EXPORT_TOO_LARGE with no CSV when the ceiling is passed', async () => {
      await seedQuadratInsert(702, { QuadratID: 702, QuadratName: 'CEILING-Q', Area: 400 }, TIME_FIRST);

      const response = await postExport(exportBody(), { maxRows: 2, pageSize: 2 });

      expect(response.status).toBe(HTTPResponses.PAYLOAD_TOO_LARGE);
      expect(response.headers.get('Content-Type'), 'a JSON error, never a partial CSV').toContain('application/json');
      expect(await response.json()).toMatchObject({ code: CHANGE_EXPORT_ERROR_CODES.tooLarge });
      expect(mocks.logEvent, 'a rejected export emits no success event').not.toHaveBeenCalled();
    });

    it('answers CHANGE_EXPORT_FAILED when a read fails and logs the stage, the driver code and the error class only', async () => {
      for (const recordID of [711, 712, 713]) {
        await seedQuadratInsert(recordID, { QuadratName: `${SECRET_FILTER_TERM}-${recordID}`, Note: SECRET_CELL_VALUE }, TIME_FIRST);
      }
      let detailPagesRead = 0;
      ownedQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
        if (sql.includes(DETAIL_PAGE_ORDER)) {
          detailPagesRead += 1;
          if (detailPagesRead === 2) throw Object.assign(new Error(`Deadlock found near ${SECRET_DRIVER_TEXT}`), { code: DRIVER_CODE });
        }
        return ownedConnection.query(sql, params);
      });

      await expectExportFailed(await postExport(exportBody({ quickSearch: SECRET_FILTER_TERM })));

      expect(mocks.logError).toHaveBeenCalledTimes(1);
      expect(mocks.logError.mock.calls[0][2]).toEqual({ schema, plotID, stage: 'detail', driverCode: DRIVER_CODE, errorName: 'ChangeExportReadError' });
      const logged = loggedText();
      for (const secret of [SECRET_FILTER_TERM, SECRET_CELL_VALUE, SECRET_DRIVER_TEXT, 'unifiedchangelog']) {
        expect(logged, `the export’s own logs must not contain ${secret}`).not.toContain(secret);
      }
    });

    it('answers CHANGE_EXPORT_FAILED at stage acquire when no connection can be had', async () => {
      mocks.getConn.mockRejectedValue(new Error('connect ETIMEDOUT 10.0.0.5:3306'));

      await expectExportFailed(await postExport(exportBody()));

      expect(mocks.logError.mock.calls[0][2]).toEqual({ schema, plotID, stage: 'acquire', driverCode: undefined, errorName: 'ChangeExportReadError' });
      expect(loggedText()).not.toContain('10.0.0.5');
    });

    it('labels a failure after the read as stage handler and logs its class name, never its message', async () => {
      await seedQuadratInsert(721, { QuadratName: 'HANDLER-Q' }, TIME_FIRST);
      mocks.logEvent.mockImplementation(() => {
        throw new TypeError(`telemetry sink rejected ${SECRET_CELL_VALUE}`);
      });

      const response = await postExport(exportBody());

      expect(response.status).toBe(HTTPResponses.INTERNAL_SERVER_ERROR);
      expect(await response.json()).toEqual({ error: 'Unable to export the change log', code: CHANGE_EXPORT_ERROR_CODES.failed });
      expect(mocks.logError.mock.calls[0][2], 'not a read failure, so not a reader stage').toEqual({
        schema,
        plotID,
        stage: 'handler',
        driverCode: undefined,
        errorName: 'TypeError'
      });
      expect(loggedText()).not.toContain(SECRET_CELL_VALUE);
    });
  });

  describe('authorization and request validation', () => {
    it('registers the route as site-scoped and loads its real POST export', async () => {
      expect(ROUTE_POLICIES[ROUTE_KEY]).toBe('site-scoped');
      const route = await import('@/app/api/changes/explorer/export/route');
      expect(typeof route.POST).toBe('function');
    });

    it('denies a schema outside the user’s sites with 403 and takes no connection', async () => {
      const { auth } = await import('@/auth');
      vi.mocked(auth).mockResolvedValueOnce({
        user: { email: 'outsider@forestgeo.test', userStatus: 'field crew', sites: [{ schemaName: OUT_OF_SCOPE_SCHEMA }] }
      } as never);

      const response = await postExport(exportBody());

      expect(response.status).toBe(HTTPResponses.FORBIDDEN);
      expect(mocks.getConn, 'no connection for a denied request').not.toHaveBeenCalled();
    });

    it('answers 503 with no code when the session’s permissions are unavailable', async () => {
      const { auth } = await import('@/auth');
      vi.mocked(auth).mockResolvedValueOnce({ user: { email: AUTH_USER_EMAIL, permissionsUnavailable: true } } as never);

      const response = await postExport(exportBody());

      expect(response.status).toBe(HTTPResponses.SERVICE_UNAVAILABLE);
      expect(await response.json()).toEqual({ error: 'permissions unavailable' });
      expect(mocks.getConn).not.toHaveBeenCalled();
    });

    it.each([
      { label: 'a non-positive plotID', body: () => ({ schema, plotID: 0 }), code: CHANGE_EXPORT_ERROR_CODES.invalidRequest },
      {
        label: 'an object where a filter string belongs',
        body: () => ({ schema, plotID, filters: { changedBy: { $ne: '' } } }),
        code: CHANGE_EXPORT_ERROR_CODES.invalidRequest
      },
      { label: 'an impossible date', body: () => ({ schema, plotID, filters: { changedFrom: '2026-02-30' } }), code: CHANGE_EXPORT_ERROR_CODES.invalidRequest },
      {
        label: 'From after To',
        body: () => ({ schema, plotID, filters: { changedFrom: '2026-03-11', changedTo: '2026-03-10' } }),
        code: CHANGE_EXPORT_ERROR_CODES.invalidRequest
      },
      { label: 'a malformed schema', body: () => ({ schema: 'not a schema!', plotID }), code: 'INVALID_SCHEMA' }
    ])('rejects $label with 400 $code and takes no connection', async ({ body, code }) => {
      const response = await postExport(body());

      expect(response.status).toBe(HTTPResponses.INVALID_REQUEST);
      expect(await response.json()).toMatchObject({ code });
      expect(mocks.getConn).not.toHaveBeenCalled();
    });
  });
});
