import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';
import ConnectionManager from '@/lib/db/connectionmanager';
import { HTTPResponses } from '@/config/macros';
import { ERRORS_EXPLORER_FAILURE_RESPONSES, INVALID_ERRORS_EXPLORER_REQUEST_RESPONSE } from '@/lib/errorsexplorer/explorerrequest';
import ailogger from '@/ailogger';

const ROUTE_CONTEXT = { params: Promise.resolve({}) };
const RAW_ERRORS_QUERY_MARKER = 'AS DisplayMessage';
const ACTIVE_COUNT_QUERY_MARKER = 'SELECT COUNT(*) AS n';

// Route is now wrapped by withRouteAuthz, so auth() runs before the handler.
// A 'global' admin passes the per-site access gate.
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { userStatus: 'global', sites: [] } }))
}));

vi.mock('@/ailogger', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() }
}));

vi.mock('@/lib/db/connectionmanager', async () => {
  const actual = await vi.importActual<any>('@/lib/db/connectionmanager').catch(() => ({}));
  const instance = {
    beginTransaction: vi.fn(async () => 'tx-1'),
    executeQuery: vi.fn(async () => []),
    commitTransaction: vi.fn(async () => {}),
    rollbackTransaction: vi.fn(async () => {}),
    closeConnection: vi.fn(async () => {})
  };
  const getInstance = vi.fn(() => instance);
  return {
    ...actual,
    default: { ...(actual?.default ?? {}), getInstance },
    getInstance
  };
});

describe('POST /api/errors/explorer/facets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns error-type identities and census totals scoped to the current census', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const rawErrorRows = [
      {
        CoreMeasurementID: 101,
        PlotID: 5,
        CensusID: 7,
        QuadratID: 1,
        TreeID: 11,
        StemGUID: 21,
        SpeciesID: 31,
        TreeTag: 'TREE-1',
        StemTag: 'A',
        SpeciesName: 'Species 1',
        SubspeciesName: null,
        SpeciesCode: 'SP1',
        QuadratName: 'Q1',
        StemLocalX: 10,
        StemLocalY: 20,
        MeasurementDate: '2026-01-01',
        MeasuredDBH: 5.1,
        MeasuredHOM: 1.3,
        IsValidated: false,
        MeasurementDescription: 'row 101',
        Attributes: null,
        UserDefinedFields: '{}',
        UploadFileID: 'file-1',
        UploadBatchID: 'batch-1',
        ErrorSource: 'validation',
        ErrorCode: '5',
        DisplayMessage: 'Duplicate tree/stem tag',
        ValidationCriteria: 'treeTag;stemTag',
        ProcedureName: 'Validation 5'
      },
      {
        CoreMeasurementID: 102,
        PlotID: 5,
        CensusID: 7,
        QuadratID: 1,
        TreeID: 12,
        StemGUID: 22,
        SpeciesID: 32,
        TreeTag: 'TREE-2',
        StemTag: 'B',
        SpeciesName: 'Species 2',
        SubspeciesName: null,
        SpeciesCode: 'SP2',
        QuadratName: 'Q2',
        StemLocalX: 12,
        StemLocalY: 22,
        MeasurementDate: '2026-01-02',
        MeasuredDBH: 6.2,
        MeasuredHOM: 1.4,
        IsValidated: false,
        MeasurementDescription: 'row 102',
        Attributes: null,
        UserDefinedFields: '{}',
        UploadFileID: 'file-1',
        UploadBatchID: 'batch-1',
        ErrorSource: 'ingestion',
        ErrorCode: 'DUPLICATE_TAG_CONFLICT',
        DisplayMessage: 'Conflicting duplicate TreeTag/StemTag rows detected in upload batch',
        ValidationCriteria: '',
        ProcedureName: ''
      }
    ];
    vi.spyOn(cm, 'executeQuery').mockImplementation(async (query: unknown) => {
      const sql = String(query);
      if (sql.includes(RAW_ERRORS_QUERY_MARKER)) return rawErrorRows;
      if (sql.includes(ACTIVE_COUNT_QUERY_MARKER)) return [{ n: 0 }];
      return [];
    });

    const response = await POST(
      new Request('http://localhost/api/errors/explorer/facets', {
        method: 'POST',
        body: JSON.stringify({
          schema: 'forestgeo_testing',
          plotID: 5,
          censusID: 7,
          filters: {
            source: 'all',
            exactMessages: [],
            affectedFields: [],
            contradictionOnly: false,
            contradictionTypes: [],
            quickSearch: ''
          }
        })
      }) as any,
      ROUTE_CONTEXT
    );

    expect(response.status).toBe(HTTPResponses.OK);
    const body = await response.json();
    console.log('[view-errors facets identities]', JSON.stringify({ errorTypes: body.errorTypes, censusTotals: body.censusTotals }));
    expect(Object.keys(body).sort(), 'the facets response is exactly errorTypes and censusTotals').toEqual(['censusTotals', 'errorTypes']);
    expect(body.errorTypes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'validation', code: '5', message: 'Duplicate tree/stem tag', count: 1 }),
        expect.objectContaining({
          source: 'ingestion',
          code: 'DUPLICATE_TAG_CONFLICT',
          message: 'Conflicting duplicate TreeTag/StemTag rows detected in upload batch',
          count: 1
        })
      ])
    );
    expect(body.errorTypes.flatMap((identity: { fields: string[] }) => identity.fields)).toEqual(expect.arrayContaining(['treeTag', 'stemTag']));
    expect(body.censusTotals).toEqual(expect.objectContaining({ affectedMeasurements: 2, validation: 1, ingestion: 1, errorTypeCount: 2 }));
  });

  it('reports one distinct measurement when a row carries two error messages (#547)', async () => {
    const MEASUREMENT_WITH_TWO_ERRORS = 201;
    const FIRST_MESSAGE = 'Invalid species reference';
    const SECOND_MESSAGE = 'Coordinate drift exceeds allowed threshold';
    const ERROR_LOG_QUERY_FRAGMENT = 'measurement_error_log';
    const rawRow = {
      CoreMeasurementID: MEASUREMENT_WITH_TWO_ERRORS,
      PlotID: 5,
      CensusID: 7,
      QuadratID: 1,
      TreeID: 11,
      StemGUID: 21,
      CoreStemGUID: 21,
      SpeciesID: 31,
      TreeTag: 'TREE-201',
      StemTag: 'A',
      SpeciesName: 'Species 1',
      SubspeciesName: null,
      SpeciesCode: 'SP1',
      QuadratName: 'Q1',
      StemLocalX: 10,
      StemLocalY: 20,
      MeasurementDate: '2026-01-01',
      MeasuredDBH: 5.1,
      MeasuredHOM: 1.3,
      IsValidated: false,
      MeasurementDescription: null,
      Attributes: null,
      UserDefinedFields: '{}',
      UploadFileID: 'file-1',
      UploadBatchID: 'batch-1',
      ErrorSource: 'ingestion',
      ValidationCriteria: '',
      ProcedureName: ''
    };
    const cm = (ConnectionManager as any).getInstance();
    vi.spyOn(cm, 'executeQuery').mockImplementation(async (query: unknown) =>
      String(query).includes(ERROR_LOG_QUERY_FRAGMENT)
        ? [
            { ...rawRow, ErrorCode: 'INVALID_SPECIES', DisplayMessage: FIRST_MESSAGE },
            { ...rawRow, ErrorCode: 'COORDINATE_DRIFT', DisplayMessage: SECOND_MESSAGE }
          ]
        : String(query).includes(ACTIVE_COUNT_QUERY_MARKER)
          ? [{ n: 0 }]
          : []
    );

    const response = await POST(
      new Request('http://localhost/api/errors/explorer/facets', {
        method: 'POST',
        body: JSON.stringify({
          schema: 'forestgeo_testing',
          plotID: 5,
          censusID: 7,
          filters: { source: 'all', exactMessages: [], affectedFields: [], contradictionOnly: false, contradictionTypes: [], quickSearch: '' }
        })
      }) as any,
      ROUTE_CONTEXT
    );

    expect(response.status).toBe(HTTPResponses.OK);
    const body = await response.json();
    console.log('[#547 facets total]', JSON.stringify({ censusTotals: body.censusTotals, errorTypes: body.errorTypes }));
    expect(body.errorTypes.map((identity: { message: string }) => identity.message).sort()).toEqual([SECOND_MESSAGE, FIRST_MESSAGE].sort());
    expect(body.censusTotals.affectedMeasurements, 'two messages on one measurement are one affected measurement').toBe(1);
  });
});

const VALID_BODY = { schema: 'forestgeo_testing', plotID: 5, censusID: 7 };
/** lib/route-authz.ts:119: fromBody turns an unparseable body into a missing schema before the handler runs. */
const ROUTE_AUTHZ_INVALID_SCHEMA_CODE = 'INVALID_SCHEMA';

function postFacets(body: unknown) {
  return POST(
    new Request('http://localhost/api/errors/explorer/facets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body)
    }) as any,
    ROUTE_CONTEXT
  );
}

describe('POST /api/errors/explorer/facets request validation (P1-1)', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ['26 census IDs', { censusIDs: Array.from({ length: 26 }, (_, index) => index + 1) }],
    ['101 messages', { filters: { exactMessages: Array.from({ length: 101 }, (_, index) => `m${index}`) } }],
    ['an unknown source', { filters: { source: 'bogus' } }],
    ['a page, which facets do not take', { page: 0 }]
  ])('answers %s with the fixed 400 and runs no SQL beyond the cached schema-quarantine lookup', async (_label, overrides) => {
    const executeQuery = vi.spyOn((ConnectionManager as any).getInstance(), 'executeQuery');
    const response = await postFacets({ ...VALID_BODY, ...overrides });
    const body = await response.json();
    console.log('[view-errors facets 400]', _label, response.status, JSON.stringify(body), executeQuery.mock.calls.length);
    expect(response.status).toBe(HTTPResponses.INVALID_REQUEST);
    expect(body).toEqual(INVALID_ERRORS_EXPLORER_REQUEST_RESPONSE);
    expect(executeQuery).not.toHaveBeenCalled();
  });

  it("answers a malformed JSON body with the authz wrapper's 400 INVALID_SCHEMA before the handler runs", async () => {
    const executeQuery = vi.spyOn((ConnectionManager as any).getInstance(), 'executeQuery');
    const response = await postFacets('{"schema":');
    const body = await response.json();
    console.log('[view-errors facets malformed json]', response.status, JSON.stringify(body));
    expect(response.status).toBe(HTTPResponses.INVALID_REQUEST);
    expect(body.code).toBe(ROUTE_AUTHZ_INVALID_SCHEMA_CODE);
    expect(executeQuery).not.toHaveBeenCalled();
  });

  it('answers a thrown error with the fixed 500 and logs, not returns, the exception', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const secret = 'ER_PARSE_ERROR near SELECT secret_table';
    vi.spyOn(cm, 'executeQuery').mockRejectedValue(new Error(secret));
    const response = await postFacets(VALID_BODY);
    const text = await response.text();
    console.log('[view-errors facets 500]', response.status, text);
    expect(response.status).toBe(HTTPResponses.INTERNAL_SERVER_ERROR);
    expect(JSON.parse(text)).toEqual(ERRORS_EXPLORER_FAILURE_RESPONSES.facets);
    expect(text).not.toContain(secret);
    expect(vi.mocked(ailogger.error).mock.calls.some(call => call.some(argument => argument instanceof Error && argument.message === secret))).toBe(true);
  });
});
