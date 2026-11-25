import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import ailogger from '@/ailogger';
import { HTTPResponses } from '@/config/macros';
import { DEFAULT_ERROR_EXPLORER_FILTERS, MAX_ERROR_EXPLORER_CENSUS_IDS } from '@/config/errorsexplorer';
import { ERRORS_EXPLORER_FAILURE_RESPONSES, INVALID_ERRORS_EXPLORER_REQUEST_RESPONSE } from '@/lib/errorsexplorer/explorerrequest';
import { queryErrorExplorer } from './_shared';
import { POST as queryPost } from './query/route';
import { POST as facetsPost } from './facets/route';
import { GET as detailsGet } from './details/[measurementID]/route';

const SCHEMA = 'forestgeo_testing';
const PLOT_ID = 5;
const CENSUS_ID = 7;
const MEASUREMENT_ID = '101';
const ROUTE_CONTEXT = { params: Promise.resolve({}) };
const QUERY_URL = 'http://localhost/api/errors/explorer/query';
const FACETS_URL = 'http://localhost/api/errors/explorer/facets';
const DETAILS_URL = 'http://localhost/api/errors/explorer/details';
const FIRST_PAGE = 0;
const PAGE_SIZE = 25;

const SECOND_CENSUS_ID = 8;
const THIRD_CENSUS_ID = 9;
const OVERSIZED_MESSAGE_LIST_LENGTH = 101;
const OVERSIZED_MESSAGE_LENGTH = 1001;
const OVERSIZED_COLUMN_FILTER_VALUE_LENGTH = 201;
const PAGE_SIZE_BELOW_MINIMUM = 7;
const PAGE_SIZE_ABOVE_MAXIMUM = 101;
const MALFORMED_JSON_BODY = '{"schema":';
/** lib/route-authz.ts: fromBody turns an unparseable body into a missing schema before the handler runs. */
const ROUTE_AUTHZ_INVALID_SCHEMA_CODE = 'INVALID_SCHEMA';
const SECRET_DATABASE_MESSAGE = 'ER_PARSE_ERROR near SELECT secret_table';

const FORWARDED_ERROR_TYPE = { source: 'validation', code: '5', message: 'Duplicate tree/stem tag' };
const FORWARDED_SORT_MODEL = [{ field: 'treeTag', sort: 'desc' }];
const FORWARDED_COLUMN_FILTERS = [{ field: 'stemTag', operator: 'contains', value: 'A' }];
const REQUESTED_CENSUS_IDS_WITH_REPEAT = [THIRD_CENSUS_ID, SECOND_CENSUS_ID, THIRD_CENSUS_ID];
const FORWARDED_CENSUS_IDS = [THIRD_CENSUS_ID, SECOND_CENSUS_ID];
const FORWARDED_QUERY_FIELDS = ['errorType', 'sortModel', 'columnFilters', 'censusIDs'] as const;
const EXPECTED_FORWARDED_VALUES = {
  errorType: FORWARDED_ERROR_TYPE,
  sortModel: FORWARDED_SORT_MODEL,
  columnFilters: FORWARDED_COLUMN_FILTERS,
  censusIDs: FORWARDED_CENSUS_IDS
};
const EMPTY_QUERY_RESPONSE = { rows: [], totalRows: 0 };

const executorState = vi.hoisted(() => ({
  executeQuery: vi.fn(),
  closeConnection: vi.fn()
}));

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { userStatus: 'global', sites: [] } }))
}));

vi.mock('@/ailogger', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() }
}));

vi.mock('@/lib/schema-quarantine', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/schema-quarantine')>()),
  findSchemaQuarantine: vi.fn(async () => null)
}));

vi.mock('./_shared', async importOriginal => {
  const actual = await importOriginal<typeof import('./_shared')>();
  return { ...actual, queryErrorExplorer: vi.fn(actual.queryErrorExplorer) };
});

vi.mock('@/lib/db/connectionmanager', () => ({
  default: { getInstance: () => ({ executeQuery: executorState.executeQuery, closeConnection: executorState.closeConnection }) }
}));

function postRequest(url: string, body: Record<string, unknown> | string): NextRequest {
  const serializedBody = typeof body === 'string' ? body : JSON.stringify(body);
  return new NextRequest(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: serializedBody });
}

function queryBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { schema: SCHEMA, plotID: PLOT_ID, censusID: CENSUS_ID, page: FIRST_PAGE, pageSize: PAGE_SIZE, filters: DEFAULT_ERROR_EXPLORER_FILTERS, ...overrides };
}

function facetsBody(overrides: Record<string, unknown> = {}) {
  return { schema: SCHEMA, plotID: PLOT_ID, censusID: CENSUS_ID, filters: DEFAULT_ERROR_EXPLORER_FILTERS, ...overrides };
}

function detailsRequest(overrides: Record<string, string> = {}, omittedParams: string[] = []): NextRequest {
  const search = new URLSearchParams({ schema: SCHEMA, plotID: String(PLOT_ID), censusID: String(CENSUS_ID), ...overrides });
  omittedParams.forEach(param => search.delete(param));
  return new NextRequest(`${DETAILS_URL}/${MEASUREMENT_ID}?${search.toString()}`);
}

function detailsContext(measurementID: string = MEASUREMENT_ID) {
  return { params: Promise.resolve({ measurementID }) };
}

async function readBodyExpectingStatus(response: Response, expectedStatus: number): Promise<ReturnType<typeof JSON.parse>> {
  const text = await response.text();
  console.log('[route answered]', response.status, text);
  expect(response.status, `route answered ${response.status} with body: ${text}`).toBe(expectedStatus);
  return JSON.parse(text);
}

function expectRejectedBeforeAnySql() {
  expect(executorState.executeQuery, 'a rejected request must not reach the database').not.toHaveBeenCalled();
}

async function expectFixedInvalidRequestResponse(response: Response) {
  expect(await readBodyExpectingStatus(response, HTTPResponses.INVALID_REQUEST)).toEqual(INVALID_ERRORS_EXPLORER_REQUEST_RESPONSE);
  expectRejectedBeforeAnySql();
}

async function expectFixedFailureResponseThatHidesTheException(response: Response, expectedBody: object) {
  const text = await response.text();
  console.log('[route answered 500]', response.status, text);
  expect(response.status, `route answered ${response.status} with body: ${text}`).toBe(HTTPResponses.INTERNAL_SERVER_ERROR);
  expect(JSON.parse(text)).toEqual(expectedBody);
  expect(text, 'the database message must not reach the client').not.toContain(SECRET_DATABASE_MESSAGE);
  expect(executorState.closeConnection, 'the connection is closed after a failure').toHaveBeenCalledTimes(1);
}

function expectLoggedException(loggedPrefix: string) {
  expect(ailogger.error).toHaveBeenCalledWith(loggedPrefix, expect.objectContaining({ message: SECRET_DATABASE_MESSAGE }));
  const loggedArguments = vi.mocked(ailogger.error).mock.calls.flat();
  expect(
    loggedArguments.some(argument => argument instanceof Error && argument.message === SECRET_DATABASE_MESSAGE),
    'the exception is logged as an Error, not returned'
  ).toBe(true);
}

beforeEach(() => {
  vi.clearAllMocks();
  executorState.executeQuery.mockRejectedValue(new Error(SECRET_DATABASE_MESSAGE));
  executorState.closeConnection.mockResolvedValue(undefined);
});

describe('POST /api/errors/explorer/query error paths', () => {
  it.each([
    ['plotID is missing', { plotID: undefined }],
    ['censusID is missing', { censusID: undefined }],
    ['plotID is zero', { plotID: 0 }],
    ['censusID is zero', { censusID: 0 }]
  ])('answers 400 and runs no SQL when %s', async (_label, overrides) => {
    const response = await queryPost(postRequest(QUERY_URL, queryBody(overrides)), ROUTE_CONTEXT);

    await expectFixedInvalidRequestResponse(response);
  });
});

describe('POST /api/errors/explorer/query request validation (P1-1)', () => {
  it.each([
    ['a non-numeric page', { page: 'x' }],
    ['a negative page', { page: -1 }],
    ['page size 7', { pageSize: PAGE_SIZE_BELOW_MINIMUM }],
    ['page size 101', { pageSize: PAGE_SIZE_ABOVE_MAXIMUM }],
    ['26 census IDs', { censusIDs: Array.from({ length: MAX_ERROR_EXPLORER_CENSUS_IDS + 1 }, (_, index) => index + 1) }],
    ['101 messages', { filters: { exactMessages: Array.from({ length: OVERSIZED_MESSAGE_LIST_LENGTH }, (_, index) => `m${index}`) } }],
    ['a 1,001-character message', { filters: { exactMessages: ['m'.repeat(OVERSIZED_MESSAGE_LENGTH)] } }],
    ['an unknown source', { filters: { source: 'bogus' } }],
    ['a sort field off the allow-list', { sortModel: [{ field: 'attributes', sort: 'asc' }] }],
    [
      'two sort items',
      {
        sortModel: [
          { field: 'treeTag', sort: 'asc' },
          { field: 'stemTag', sort: 'asc' }
        ]
      }
    ],
    [
      'two filter items',
      {
        columnFilters: [
          { field: 'treeTag', operator: 'contains', value: 'a' },
          { field: 'stemTag', operator: 'contains', value: 'b' }
        ]
      }
    ],
    ['an operator not allowed for the kind', { columnFilters: [{ field: 'treeTag', operator: '>', value: 'a' }] }],
    [
      'a text value of 201 characters',
      { columnFilters: [{ field: 'treeTag', operator: 'contains', value: 'a'.repeat(OVERSIZED_COLUMN_FILTER_VALUE_LENGTH) }] }
    ],
    ['an errorType with an unknown source', { errorType: { source: 'bogus', code: '1', message: 'm' } }]
  ])('answers %s with the fixed 400 and runs no SQL beyond the cached schema-quarantine lookup', async (_label, overrides) => {
    const response = await queryPost(postRequest(QUERY_URL, queryBody(overrides)), ROUTE_CONTEXT);

    await expectFixedInvalidRequestResponse(response);
  });

  it("answers a malformed JSON body with the authz wrapper's 400 INVALID_SCHEMA before the handler runs", async () => {
    const response = await queryPost(postRequest(QUERY_URL, MALFORMED_JSON_BODY), ROUTE_CONTEXT);

    const body = await readBodyExpectingStatus(response, HTTPResponses.INVALID_REQUEST);
    expect(body.code).toBe(ROUTE_AUTHZ_INVALID_SCHEMA_CODE);
    expectRejectedBeforeAnySql();
  });

  it('answers a thrown error with the fixed 500 and logs, not returns, the exception', async () => {
    const response = await queryPost(postRequest(QUERY_URL, queryBody()), ROUTE_CONTEXT);

    await expectFixedFailureResponseThatHidesTheException(response, ERRORS_EXPLORER_FAILURE_RESPONSES.query);
    expect(executorState.executeQuery).toHaveBeenCalled();
    expectLoggedException('Error querying errors explorer:');
  });
});

describe('POST /api/errors/explorer/query forwarding', () => {
  it.each(FORWARDED_QUERY_FIELDS)('forwards %s to queryErrorExplorer as sent', async forwardedField => {
    vi.mocked(queryErrorExplorer).mockResolvedValueOnce(EMPTY_QUERY_RESPONSE);
    const sentBody = queryBody({
      errorType: FORWARDED_ERROR_TYPE,
      sortModel: FORWARDED_SORT_MODEL,
      columnFilters: FORWARDED_COLUMN_FILTERS,
      censusIDs: REQUESTED_CENSUS_IDS_WITH_REPEAT
    });

    const response = await queryPost(postRequest(QUERY_URL, sentBody), ROUTE_CONTEXT);

    expect(await readBodyExpectingStatus(response, HTTPResponses.OK)).toEqual(EMPTY_QUERY_RESPONSE);
    expect(vi.mocked(queryErrorExplorer), 'the route runs the query exactly once').toHaveBeenCalledTimes(1);
    const [, forwardedRequest] = vi.mocked(queryErrorExplorer).mock.calls[0];
    console.log(
      '[forwarded request]',
      forwardedField,
      'sent',
      JSON.stringify(sentBody[forwardedField]),
      'forwarded',
      JSON.stringify(forwardedRequest[forwardedField])
    );
    expect(forwardedRequest[forwardedField], `forwarded ${forwardedField}`).toEqual(EXPECTED_FORWARDED_VALUES[forwardedField]);
  });
});

describe('POST /api/errors/explorer/facets error paths', () => {
  it.each([
    ['plotID is missing', { plotID: undefined }],
    ['censusID is missing', { censusID: undefined }],
    ['plotID is zero', { plotID: 0 }],
    ['censusID is zero', { censusID: 0 }]
  ])('answers 400 and runs no SQL when %s', async (_label, overrides) => {
    const response = await facetsPost(postRequest(FACETS_URL, facetsBody(overrides)), ROUTE_CONTEXT);

    await expectFixedInvalidRequestResponse(response);
  });
});

describe('POST /api/errors/explorer/facets request validation (P1-1)', () => {
  it.each([
    ['26 census IDs', { censusIDs: Array.from({ length: MAX_ERROR_EXPLORER_CENSUS_IDS + 1 }, (_, index) => index + 1) }],
    ['101 messages', { filters: { exactMessages: Array.from({ length: OVERSIZED_MESSAGE_LIST_LENGTH }, (_, index) => `m${index}`) } }],
    ['an unknown source', { filters: { source: 'bogus' } }],
    ['a page, which facets do not take', { page: FIRST_PAGE }]
  ])('answers %s with the fixed 400 and runs no SQL beyond the cached schema-quarantine lookup', async (_label, overrides) => {
    const response = await facetsPost(postRequest(FACETS_URL, facetsBody(overrides)), ROUTE_CONTEXT);

    await expectFixedInvalidRequestResponse(response);
  });

  it("answers a malformed JSON body with the authz wrapper's 400 INVALID_SCHEMA before the handler runs", async () => {
    const response = await facetsPost(postRequest(FACETS_URL, MALFORMED_JSON_BODY), ROUTE_CONTEXT);

    const body = await readBodyExpectingStatus(response, HTTPResponses.INVALID_REQUEST);
    expect(body.code).toBe(ROUTE_AUTHZ_INVALID_SCHEMA_CODE);
    expectRejectedBeforeAnySql();
  });

  it('answers a thrown error with the fixed 500 and logs, not returns, the exception', async () => {
    const response = await facetsPost(postRequest(FACETS_URL, facetsBody()), ROUTE_CONTEXT);

    await expectFixedFailureResponseThatHidesTheException(response, ERRORS_EXPLORER_FAILURE_RESPONSES.facets);
    expect(executorState.executeQuery).toHaveBeenCalled();
    expectLoggedException('Error loading errors explorer facets:');
  });
});

describe('GET /api/errors/explorer/details/[measurementID] error paths', () => {
  it.each([
    ['plotID is missing', {}, ['plotID'], MEASUREMENT_ID],
    ['plotID is empty', { plotID: '' }, [], MEASUREMENT_ID],
    ['plotID is zero', { plotID: '0' }, [], MEASUREMENT_ID],
    ['censusID is missing', {}, ['censusID'], MEASUREMENT_ID],
    ['censusID is empty', { censusID: '' }, [], MEASUREMENT_ID],
    ['censusID is zero', { censusID: '0' }, [], MEASUREMENT_ID],
    ['the measurementID path segment is empty', {}, [], '']
  ])('answers 400 and runs no SQL when %s', async (_label, searchOverrides, omittedParams, measurementID) => {
    const response = await detailsGet(detailsRequest(searchOverrides, omittedParams), detailsContext(measurementID));

    await expectFixedInvalidRequestResponse(response);
  });

  it.each(['duplicate', 'same_batch_conflict ', 'DUPLICATE_TAG_STEM', '1'])(
    'answers 400 and runs no SQL for the unknown contradiction type %j',
    async activeContradictionType => {
      const response = await detailsGet(detailsRequest({ activeContradictionType }), detailsContext());

      await expectFixedInvalidRequestResponse(response);
    }
  );
});

describe('GET /api/errors/explorer/details/[measurementID] request validation (P1-1)', () => {
  it.each([
    ['a non-integer measurement ID', '12.5', {}, []],
    ['a zero measurement ID', '0', {}, []],
    ['a non-numeric plot ID', MEASUREMENT_ID, { plotID: 'abc' }, []],
    ['a missing census ID', MEASUREMENT_ID, {}, ['censusID']]
  ])(
    'answers %s with the fixed 400 and runs no SQL beyond the cached schema-quarantine lookup',
    async (_label, measurementID, searchOverrides, omittedParams) => {
      const response = await detailsGet(detailsRequest(searchOverrides, omittedParams), detailsContext(measurementID));

      await expectFixedInvalidRequestResponse(response);
    }
  );

  it('answers an unknown contradiction type with the same fixed 400', async () => {
    const response = await detailsGet(detailsRequest({ activeContradictionType: 'bogus' }), detailsContext());

    await expectFixedInvalidRequestResponse(response);
  });

  it('answers a thrown error with the fixed 500 and logs, not returns, the exception', async () => {
    const response = await detailsGet(detailsRequest(), detailsContext());

    await expectFixedFailureResponseThatHidesTheException(response, ERRORS_EXPLORER_FAILURE_RESPONSES.details);
    expect(executorState.executeQuery).toHaveBeenCalled();
    expectLoggedException('Error loading errors explorer details:');
  });
});
