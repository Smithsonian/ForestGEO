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
const DETAILS_URL = 'http://localhost/api/errors/explorer/details';

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
  return { schema: SCHEMA, plotID: PLOT_ID, censusID: CENSUS_ID, page: 0, pageSize: 25, filters: DEFAULT_ERROR_EXPLORER_FILTERS, ...overrides };
}

function facetsBody(overrides: Record<string, unknown> = {}) {
  return { schema: SCHEMA, plotID: PLOT_ID, censusID: CENSUS_ID, filters: DEFAULT_ERROR_EXPLORER_FILTERS, ...overrides };
}

function detailsRequest(overrides: Record<string, string> = {}): NextRequest {
  const search = new URLSearchParams({ schema: SCHEMA, plotID: String(PLOT_ID), censusID: String(CENSUS_ID), ...overrides });
  return new NextRequest(`${DETAILS_URL}/${MEASUREMENT_ID}?${search.toString()}`);
}

function detailsContext(measurementID: string = MEASUREMENT_ID) {
  return { params: Promise.resolve({ measurementID }) };
}

async function readBody(response: Response) {
  const text = await response.text();
  console.log('[route answered]', response.status, text);
  return JSON.parse(text);
}

beforeEach(() => {
  vi.clearAllMocks();
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
    const response = await queryPost(postRequest('http://localhost/api/errors/explorer/query', queryBody(overrides)), ROUTE_CONTEXT);

    expect(response.status).toBe(HTTPResponses.BAD_REQUEST);
    expect(await readBody(response)).toEqual({ error: PLOT_AND_CENSUS_REQUIRED_MESSAGE });
    expect(executorState.executeQuery, 'a rejected request must not reach the database').not.toHaveBeenCalled();
  });

  it('answers 500 with the failure message and still closes the connection when the database rejects', async () => {
    const response = await queryPost(postRequest('http://localhost/api/errors/explorer/query', queryBody()), ROUTE_CONTEXT);

    expect(response.status).toBe(HTTPResponses.INTERNAL_SERVER_ERROR);
    expect(await readBody(response)).toEqual({ error: MYSQL_MISSING_TABLE_MESSAGE });
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
    const response = await facetsPost(postRequest('http://localhost/api/errors/explorer/facets', facetsBody(overrides)), ROUTE_CONTEXT);

    expect(response.status).toBe(HTTPResponses.BAD_REQUEST);
    expect(await readBody(response)).toEqual({ error: PLOT_AND_CENSUS_REQUIRED_MESSAGE });
    expect(executorState.executeQuery, 'a rejected request must not reach the database').not.toHaveBeenCalled();
  });

  it('answers 500 with the failure message and still closes the connection when the database rejects', async () => {
    const response = await facetsPost(postRequest('http://localhost/api/errors/explorer/facets', facetsBody()), ROUTE_CONTEXT);

    expect(response.status).toBe(HTTPResponses.INTERNAL_SERVER_ERROR);
    expect(await readBody(response)).toEqual({ error: MYSQL_MISSING_TABLE_MESSAGE });
    expect(executorState.executeQuery).toHaveBeenCalled();
    expect(executorState.closeConnection).toHaveBeenCalledTimes(1);
    expect(ailogger.error).toHaveBeenCalledWith('Error loading errors explorer facets:', expect.objectContaining({ message: MYSQL_MISSING_TABLE_MESSAGE }));
  });
});

describe('GET /api/errors/explorer/details/[measurementID] error paths', () => {
  it.each([
    ['plotID is missing', { plotID: '' }, MEASUREMENT_ID],
    ['censusID is missing', { censusID: '' }, MEASUREMENT_ID],
    ['plotID is zero', { plotID: '0' }, MEASUREMENT_ID],
    ['the measurementID path segment is empty', {}, '']
  ])('answers 400 and runs no SQL when %s', async (_label, searchOverrides, measurementID) => {
    const response = await detailsGet(detailsRequest(searchOverrides), detailsContext(measurementID));

    expect(response.status).toBe(HTTPResponses.BAD_REQUEST);
    expect(await readBody(response)).toEqual({ error: DETAILS_PARAMS_REQUIRED_MESSAGE });
    expect(executorState.executeQuery, 'a rejected request must not reach the database').not.toHaveBeenCalled();
  });

  it.each(['duplicate', 'same_batch_conflict ', 'DUPLICATE_TAG_STEM', '1'])(
    'answers 400 and runs no SQL for the unknown contradiction type %j',
    async activeContradictionType => {
      const response = await detailsGet(detailsRequest({ activeContradictionType }), detailsContext());

      expect(response.status).toBe(HTTPResponses.BAD_REQUEST);
      expect(await readBody(response)).toEqual({ error: INVALID_CONTRADICTION_TYPE_MESSAGE });
      expect(executorState.executeQuery, 'a rejected request must not reach the database').not.toHaveBeenCalled();
    }
  );

  it('answers 500 with the failure message and still closes the connection when the database rejects', async () => {
    const response = await detailsGet(detailsRequest(), detailsContext());

    expect(response.status).toBe(HTTPResponses.INTERNAL_SERVER_ERROR);
    expect(await readBody(response)).toEqual({ error: MYSQL_MISSING_TABLE_MESSAGE });
    expect(executorState.executeQuery).toHaveBeenCalled();
    expect(executorState.closeConnection).toHaveBeenCalledTimes(1);
    expect(ailogger.error).toHaveBeenCalledWith('Error loading errors explorer details:', expect.objectContaining({ message: MYSQL_MISSING_TABLE_MESSAGE }));
  });
});
