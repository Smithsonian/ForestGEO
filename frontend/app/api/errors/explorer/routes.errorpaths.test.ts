import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import ailogger from '@/ailogger';
import { HTTPResponses } from '@/config/macros';
import { DEFAULT_ERROR_EXPLORER_FILTERS } from '@/config/errorsexplorer';
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

const PLOT_AND_CENSUS_REQUIRED_MESSAGE = 'plotID and censusID are required';
const DETAILS_PARAMS_REQUIRED_MESSAGE = 'schema, plotID, censusID, and measurementID are required';
const INVALID_CONTRADICTION_TYPE_MESSAGE = 'Invalid contradiction type';
const MYSQL_MISSING_TABLE_MESSAGE = `Table '${SCHEMA}.measurementssummary' doesn't exist`;

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

vi.mock('@/lib/db/connectionmanager', () => ({
  default: { getInstance: () => ({ executeQuery: executorState.executeQuery, closeConnection: executorState.closeConnection }) }
}));

function postRequest(url: string, body: Record<string, unknown>): NextRequest {
  return new NextRequest(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

function queryBody(overrides: Record<string, unknown> = {}) {
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

function expectGenericErrorBody(body: { error?: unknown }) {
  expect(typeof body.error, 'the 500 body carries an error string').toBe('string');
  expect((body.error as string).length, 'the 500 error string is not empty').toBeGreaterThan(0);
}

beforeEach(() => {
  executorState.executeQuery.mockRejectedValue(new Error(MYSQL_MISSING_TABLE_MESSAGE));
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

    expect(await readBodyExpectingStatus(response, HTTPResponses.BAD_REQUEST)).toEqual({ error: PLOT_AND_CENSUS_REQUIRED_MESSAGE });
    expect(executorState.executeQuery, 'a rejected request must not reach the database').not.toHaveBeenCalled();
  });

  it('answers 500, closes the connection and logs the real error when the database rejects', async () => {
    const response = await queryPost(postRequest(QUERY_URL, queryBody()), ROUTE_CONTEXT);

    expectGenericErrorBody(await readBodyExpectingStatus(response, HTTPResponses.INTERNAL_SERVER_ERROR));
    expect(executorState.executeQuery).toHaveBeenCalled();
    expect(executorState.closeConnection).toHaveBeenCalledTimes(1);
    expect(ailogger.error).toHaveBeenCalledWith('Error querying errors explorer:', expect.objectContaining({ message: MYSQL_MISSING_TABLE_MESSAGE }));
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

    expect(await readBodyExpectingStatus(response, HTTPResponses.BAD_REQUEST)).toEqual({ error: PLOT_AND_CENSUS_REQUIRED_MESSAGE });
    expect(executorState.executeQuery, 'a rejected request must not reach the database').not.toHaveBeenCalled();
  });

  it('answers 500, closes the connection and logs the real error when the database rejects', async () => {
    const response = await facetsPost(postRequest(FACETS_URL, facetsBody()), ROUTE_CONTEXT);

    expectGenericErrorBody(await readBodyExpectingStatus(response, HTTPResponses.INTERNAL_SERVER_ERROR));
    expect(executorState.executeQuery).toHaveBeenCalled();
    expect(executorState.closeConnection).toHaveBeenCalledTimes(1);
    expect(ailogger.error).toHaveBeenCalledWith('Error loading errors explorer facets:', expect.objectContaining({ message: MYSQL_MISSING_TABLE_MESSAGE }));
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

    expect(await readBodyExpectingStatus(response, HTTPResponses.BAD_REQUEST)).toEqual({ error: DETAILS_PARAMS_REQUIRED_MESSAGE });
    expect(executorState.executeQuery, 'a rejected request must not reach the database').not.toHaveBeenCalled();
  });

  it.each(['duplicate', 'same_batch_conflict ', 'DUPLICATE_TAG_STEM', '1'])(
    'answers 400 and runs no SQL for the unknown contradiction type %j',
    async activeContradictionType => {
      const response = await detailsGet(detailsRequest({ activeContradictionType }), detailsContext());

      expect(await readBodyExpectingStatus(response, HTTPResponses.BAD_REQUEST)).toEqual({ error: INVALID_CONTRADICTION_TYPE_MESSAGE });
      expect(executorState.executeQuery, 'a rejected request must not reach the database').not.toHaveBeenCalled();
    }
  );

  it('answers 500, closes the connection and logs the real error when the database rejects', async () => {
    const response = await detailsGet(detailsRequest(), detailsContext());

    expectGenericErrorBody(await readBodyExpectingStatus(response, HTTPResponses.INTERNAL_SERVER_ERROR));
    expect(executorState.executeQuery).toHaveBeenCalled();
    expect(executorState.closeConnection).toHaveBeenCalledTimes(1);
    expect(ailogger.error).toHaveBeenCalledWith('Error loading errors explorer details:', expect.objectContaining({ message: MYSQL_MISSING_TABLE_MESSAGE }));
  });
});
