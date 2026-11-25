/**
 * #574: a route that fails on the database must not send the exception text to the browser.
 * Every database call below rejects with a MySQL-style message naming a schema, a table and a
 * column. Each route must answer with its failure status, keep that text out of the body, and
 * still log it through ailogger.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import ailogger from '@/ailogger';
import { HTTPResponses } from '@/config/macros';
import { INTERNAL_SERVER_ERROR_MESSAGE } from '@/lib/errorhelpers';

const SECRET_SCHEMA = 'forestgeo_secretsite';
const SECRET_COLUMN = 'secret_column_574';
const SECRET_DATABASE_MESSAGE = `You have an error in your SQL syntax near 'SELECT ${SECRET_COLUMN} FROM ${SECRET_SCHEMA}.coremeasurements'`;
const SECRET_FRAGMENTS = [SECRET_SCHEMA, SECRET_COLUMN, 'SQL syntax'];
const MYSQL_PARSE_ERROR_CODE = 'ER_PARSE_ERROR';

const SCHEMA = 'forestgeo_testing';
const PLOT_ID = 1;
const CENSUS_ID = 2;
const BASE_URL = 'http://localhost/api';
const METHOD_GET = 'GET';
const METHOD_POST = 'POST';
const METHOD_PATCH = 'PATCH';

/** Cleanup calls run in finally blocks; a rejection there would replace the response under test. */
const CLEANUP_METHODS = new Set(['closeConnection', 'rollbackTransaction', 'releaseApplicationLock']);

function databaseFailure(): Error {
  return Object.assign(new Error(SECRET_DATABASE_MESSAGE), { code: MYSQL_PARSE_ERROR_CODE, sqlMessage: SECRET_DATABASE_MESSAGE });
}

const failingConnectionManager = vi.hoisted(() => ({ calls: [] as string[] }));

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { userStatus: 'global', sites: [], email: 'tester@example.org', name: 'Test User' } }))
}));

vi.mock('@/ailogger', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
}));

vi.mock('@/lib/schema-quarantine', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/schema-quarantine')>()),
  findSchemaQuarantine: vi.fn(async () => null)
}));

vi.mock('@/lib/db/connectionmanager', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/db/connectionmanager')>();
  const instance = new Proxy(
    {},
    {
      get(_target, property) {
        if (typeof property !== 'string' || property === 'then') return undefined;
        return (..._args: unknown[]) => {
          failingConnectionManager.calls.push(property);
          if (CLEANUP_METHODS.has(property)) return Promise.resolve();
          return Promise.reject(databaseFailure());
        };
      }
    }
  );
  return { ...actual, default: { ...actual.default, getInstance: () => instance } };
});

vi.mock('@/config/uploadsessiontracker', async importOriginal => ({
  ...(await importOriginal<typeof import('@/config/uploadsessiontracker')>()),
  requireUploadSessionOwnership: vi.fn(async () => undefined)
}));

type RouteHandler = (request: NextRequest, context: { params: Promise<Record<string, string | string[]>> }) => Promise<Response>;

interface RouteCase {
  name: string;
  load: () => Promise<Record<string, unknown>>;
  method: typeof METHOD_GET | typeof METHOD_POST | typeof METHOD_PATCH;
  path: string;
  params?: Record<string, string | string[]>;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
  expectedStatus: number;
  expectedError: string;
}

const ROUTE_CASES: RouteCase[] = [
  {
    name: 'catalog user lookup',
    load: () => import('./catalog/[firstName]/[lastName]/route'),
    method: METHOD_GET,
    path: '/catalog/Jane/Doe',
    params: { firstName: 'Jane', lastName: 'Doe' },
    expectedStatus: HTTPResponses.INTERNAL_SERVER_ERROR,
    expectedError: INTERNAL_SERVER_ERROR_MESSAGE
  },
  {
    name: 'clear census',
    load: () => import('./clearcensus/route'),
    method: METHOD_POST,
    path: '/clearcensus',
    body: { schema: SCHEMA, censusID: CENSUS_ID, type: 'full' },
    expectedStatus: HTTPResponses.INTERNAL_SERVER_ERROR,
    expectedError: INTERNAL_SERVER_ERROR_MESSAGE
  },
  {
    name: 'post-validation query list',
    load: () => import('./postvalidation/route'),
    method: METHOD_GET,
    path: `/postvalidation?schema=${SCHEMA}`,
    expectedStatus: HTTPResponses.INTERNAL_SERVER_ERROR,
    expectedError: INTERNAL_SERVER_ERROR_MESSAGE
  },
  {
    name: 'validation list',
    load: () => import('./validations/validationlist/route'),
    method: METHOD_GET,
    path: `/validations/validationlist?schema=${SCHEMA}`,
    expectedStatus: HTTPResponses.INTERNAL_SERVER_ERROR,
    expectedError: INTERNAL_SERVER_ERROR_MESSAGE
  },
  {
    name: 'validation run create',
    load: () => import('./validations/run/route'),
    method: METHOD_POST,
    path: '/validations/run',
    body: { schema: SCHEMA, plotID: PLOT_ID, censusID: CENSUS_ID, totalSteps: 3 },
    expectedStatus: HTTPResponses.INTERNAL_SERVER_ERROR,
    expectedError: INTERNAL_SERVER_ERROR_MESSAGE
  },
  {
    name: 'validation run read',
    load: () => import('./validations/run/route'),
    method: METHOD_GET,
    path: `/validations/run?schema=${SCHEMA}&plotID=${PLOT_ID}&censusID=${CENSUS_ID}`,
    expectedStatus: HTTPResponses.INTERNAL_SERVER_ERROR,
    expectedError: INTERNAL_SERVER_ERROR_MESSAGE
  },
  {
    name: 'validation run update',
    load: () => import('./validations/run/route'),
    method: METHOD_PATCH,
    path: '/validations/run',
    body: { schema: SCHEMA, runID: 7, completedSteps: 1 },
    expectedStatus: HTTPResponses.INTERNAL_SERVER_ERROR,
    expectedError: INTERNAL_SERVER_ERROR_MESSAGE
  },
  {
    name: 'validation error display',
    load: () => import('./validations/validationerrordisplay/route'),
    method: METHOD_GET,
    path: `/validations/validationerrordisplay?schema=${SCHEMA}&plotIDParam=${PLOT_ID}&censusPCNParam=1`,
    expectedStatus: HTTPResponses.INTERNAL_SERVER_ERROR,
    expectedError: INTERNAL_SERVER_ERROR_MESSAGE
  },
  {
    name: 'validate failed measurements',
    load: () => import('./validatefailed/[schema]/[plotID]/[censusID]/route'),
    method: METHOD_GET,
    path: `/validatefailed/${SCHEMA}/${PLOT_ID}/${CENSUS_ID}`,
    params: { schema: SCHEMA, plotID: String(PLOT_ID), censusID: String(CENSUS_ID) },
    expectedStatus: HTTPResponses.INTERNAL_SERVER_ERROR,
    expectedError: INTERNAL_SERVER_ERROR_MESSAGE
  },
  {
    name: 'reingest one failed row',
    load: () => import('./reingestsinglefailure/[schema]/[targetRowID]/route'),
    method: METHOD_GET,
    path: `/reingestsinglefailure/${SCHEMA}/11`,
    params: { schema: SCHEMA, targetRowID: '11' },
    expectedStatus: HTTPResponses.INTERNAL_SERVER_ERROR,
    expectedError: INTERNAL_SERVER_ERROR_MESSAGE
  },
  {
    name: 'changelog overview',
    load: () => import('./changelog/overview/[changelogType]/[[...options]]/route'),
    method: METHOD_GET,
    path: `/changelog/overview/unifiedchangelog/${PLOT_ID}/1?schema=${SCHEMA}`,
    params: { changelogType: 'unifiedchangelog', options: [String(PLOT_ID), '1'] },
    expectedStatus: HTTPResponses.INTERNAL_SERVER_ERROR,
    expectedError: 'Failed to fetch changelog data'
  },
  {
    name: 'aggregated dashboard metrics',
    load: () => import('./dashboardmetrics/all/[schema]/[plotID]/[censusID]/route'),
    method: METHOD_GET,
    path: `/dashboardmetrics/all/${SCHEMA}/${PLOT_ID}/${CENSUS_ID}`,
    params: { schema: SCHEMA, plotID: String(PLOT_ID), censusID: String(CENSUS_ID) },
    expectedStatus: HTTPResponses.INTERNAL_SERVER_ERROR,
    expectedError: 'Failed to retrieve aggregated dashboard metrics'
  },
  {
    name: 'recent changes query',
    load: () => import('./changes/explorer/query/route'),
    method: METHOD_POST,
    path: '/changes/explorer/query',
    body: { schema: SCHEMA, plotID: PLOT_ID, page: 0, pageSize: 25, filters: {} },
    expectedStatus: HTTPResponses.INTERNAL_SERVER_ERROR,
    expectedError: INTERNAL_SERVER_ERROR_MESSAGE
  },
  {
    name: 'recent changes facets',
    load: () => import('./changes/explorer/facets/route'),
    method: METHOD_POST,
    path: '/changes/explorer/facets',
    body: { schema: SCHEMA, plotID: PLOT_ID },
    expectedStatus: HTTPResponses.INTERNAL_SERVER_ERROR,
    expectedError: INTERNAL_SERVER_ERROR_MESSAGE
  },
  {
    name: 'form search',
    load: () => import('./formsearch/[dataType]/route'),
    method: METHOD_GET,
    path: `/formsearch/species?schema=${SCHEMA}&searchfor=Ac`,
    params: { dataType: 'species' },
    expectedStatus: HTTPResponses.INTERNAL_SERVER_ERROR,
    expectedError: INTERNAL_SERVER_ERROR_MESSAGE
  },
  {
    name: 'verify upload',
    load: () => import('./verifyupload/route'),
    method: METHOD_GET,
    path: `/verifyupload?schema=${SCHEMA}&fileName=a.csv&batchID=b1&plotID=${PLOT_ID}&censusID=${CENSUS_ID}`,
    expectedStatus: HTTPResponses.INTERNAL_SERVER_ERROR,
    expectedError: 'Failed to verify upload'
  },
  {
    name: 'verify processing',
    load: () => import('./verifyprocessing/route'),
    method: METHOD_GET,
    path: `/verifyprocessing?schema=${SCHEMA}&plotID=${PLOT_ID}&censusID=${CENSUS_ID}`,
    expectedStatus: HTTPResponses.INTERNAL_SERVER_ERROR,
    expectedError: 'Failed to verify processing'
  },
  {
    name: 'verify upload session',
    load: () => import('./verifysession/route'),
    method: METHOD_GET,
    path: `/verifysession?schema=${SCHEMA}&plotID=${PLOT_ID}&censusID=${CENSUS_ID}`,
    expectedStatus: HTTPResponses.INTERNAL_SERVER_ERROR,
    expectedError: 'Failed to verify upload session'
  },
  {
    name: 'staged batch discovery',
    load: () => import('./setupbulkprocessor/[schema]/[plotID]/[censusID]/route'),
    method: METHOD_GET,
    path: `/setupbulkprocessor/${SCHEMA}/${PLOT_ID}/${CENSUS_ID}`,
    params: { schema: SCHEMA, plotID: String(PLOT_ID), censusID: String(CENSUS_ID) },
    headers: { 'x-upload-session-id': 'session-574' },
    expectedStatus: HTTPResponses.INTERNAL_SERVER_ERROR,
    expectedError: 'Failed to fetch batches'
  },
  {
    name: 'census collapser',
    load: () => import('./setupbulkcollapser/[censusID]/route'),
    method: METHOD_GET,
    path: `/setupbulkcollapser/${CENSUS_ID}?schema=${SCHEMA}`,
    params: { censusID: String(CENSUS_ID) },
    headers: { 'x-upload-session-id': 'session-574' },
    expectedStatus: HTTPResponses.INTERNAL_SERVER_ERROR,
    expectedError: INTERNAL_SERVER_ERROR_MESSAGE
  },
  {
    name: 'raw query',
    load: () => import('./query/route'),
    method: METHOD_POST,
    path: '/query',
    body: { query: `SELECT * FROM ${SCHEMA}.species` },
    expectedStatus: HTTPResponses.INTERNAL_SERVER_ERROR,
    expectedError: 'Failed to execute query'
  }
];

function buildRequest(routeCase: RouteCase): NextRequest {
  const headers = { 'Content-Type': 'application/json', ...routeCase.headers };
  const body = routeCase.body === undefined ? undefined : JSON.stringify(routeCase.body);
  return new NextRequest(`${BASE_URL}${routeCase.path}`, { method: routeCase.method, headers, body });
}

/**
 * ailogger.error(message, exception) keeps the cause only when the exception slot holds an Error (or the message
 * itself names it); a bare string in the exception slot loses the stack in production.
 */
function loggedTextContainsTheDatabaseMessage(): boolean {
  return vi
    .mocked(ailogger.error)
    .mock.calls.some(
      ([message, exception]) =>
        (typeof message === 'string' && message.includes(SECRET_DATABASE_MESSAGE)) ||
        (exception instanceof Error && exception.message.includes(SECRET_DATABASE_MESSAGE))
    );
}

beforeEach(() => {
  vi.clearAllMocks();
  failingConnectionManager.calls.length = 0;
});

describe('#574 API routes keep database error text out of failure responses', () => {
  it.each(ROUTE_CASES)('$name answers $expectedStatus without the database message', async routeCase => {
    const routeModule = await routeCase.load();
    const handler = routeModule[routeCase.method] as RouteHandler;
    expect(handler, `${routeCase.name} exports ${routeCase.method}`).toBeTypeOf('function');

    const response = await handler(buildRequest(routeCase), { params: Promise.resolve(routeCase.params ?? {}) });
    const text = await response.text();
    console.log(`[${routeCase.name}] ${response.status} ${text}`);
    console.log(`[${routeCase.name}] database calls: ${failingConnectionManager.calls.join(', ')}`);

    expect(failingConnectionManager.calls.length, 'the request reached the failing database').toBeGreaterThan(0);
    expect(response.status, `body: ${text}`).toBe(routeCase.expectedStatus);
    for (const fragment of SECRET_FRAGMENTS) {
      expect(text, `the response must not contain "${fragment}"`).not.toContain(fragment);
    }
    expect(JSON.parse(text).error).toBe(routeCase.expectedError);
    expect(loggedTextContainsTheDatabaseMessage(), 'the database message is still logged for the team').toBe(true);
  });
});

interface StreamedValidationCase {
  name: string;
  load: () => Promise<Record<string, unknown>>;
  path: string;
  procedureFlags: string[];
}

const STREAMED_VALIDATION_CASES: StreamedValidationCase[] = [
  {
    name: 'combined DBH validations',
    load: () => import('./validations/procedures/shared-dbh/route'),
    path: '/validations/procedures/shared-dbh',
    procedureFlags: ['ranGrowth', 'ranShrinkage']
  },
  {
    name: 'combined cross-census location validations',
    load: () => import('./validations/procedures/shared-cross-census-location/route'),
    path: '/validations/procedures/shared-cross-census-location',
    procedureFlags: ['ranQuadratMismatch', 'ranCoordinateDrift']
  }
];

describe('#574 streamed validations keep database error text out of the NDJSON body', () => {
  it.each(STREAMED_VALIDATION_CASES)('$name reports failure without the database message', async streamedCase => {
    const routeModule = await streamedCase.load();
    const handler = routeModule[METHOD_POST] as RouteHandler;
    const request = new NextRequest(`${BASE_URL}${streamedCase.path}`, {
      method: METHOD_POST,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schema: SCHEMA, p_CensusID: CENSUS_ID, p_PlotID: PLOT_ID })
    });

    const response = await handler(request, { params: Promise.resolve({}) });
    const text = await response.text();
    console.log(`[${streamedCase.name}] ${response.status} ${text}`);
    console.log(`[${streamedCase.name}] database calls: ${failingConnectionManager.calls.join(', ')}`);

    expect(failingConnectionManager.calls.length, 'the validation reached the failing database').toBeGreaterThan(0);
    const lines = text
      .split('\n')
      .filter(line => line.trim().length > 0)
      .map(line => JSON.parse(line));
    const finalLine = lines.at(-1);
    expect(finalLine?.type, `the helper resolves a failure result instead of throwing: ${JSON.stringify(finalLine)}`).toBe('result');
    expect(finalLine.data.success).toBe(false);
    for (const flag of streamedCase.procedureFlags) {
      expect(finalLine.data[flag], `${flag} reports that the procedure did not run`).toBe(false);
    }
    expect(finalLine.data.error).toBe(INTERNAL_SERVER_ERROR_MESSAGE);
    for (const fragment of SECRET_FRAGMENTS) {
      expect(text, `the stream must not contain "${fragment}"`).not.toContain(fragment);
    }
    expect(loggedTextContainsTheDatabaseMessage(), 'the database message is still logged for the team').toBe(true);
  });
});
