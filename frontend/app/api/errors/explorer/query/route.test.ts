import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';
import ConnectionManager from '@/lib/db/connectionmanager';
import { HTTPResponses } from '@/config/macros';
import { ERRORS_EXPLORER_FAILURE_RESPONSES, INVALID_ERRORS_EXPLORER_REQUEST_RESPONSE } from '@/lib/errorsexplorer/explorerrequest';
import ailogger from '@/ailogger';

const ROUTE_CONTEXT = { params: Promise.resolve({}) };

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

describe('POST /api/errors/explorer/query', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns grouped row-centric error data with contradiction links', async () => {
    const cm = (ConnectionManager as any).getInstance();
    vi.spyOn(cm, 'executeQuery')
      .mockResolvedValueOnce([
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
          RawCodes: 'MX,I',
          UserDefinedFields: '{"treestemstate":"old tree"}',
          UploadFileID: 'file-1',
          UploadBatchID: 'batch-1',
          ErrorSource: 'validation',
          ErrorCode: '5',
          DisplayMessage: 'Duplicate tree/stem tag',
          ValidationCriteria: 'treeTag;stemTag',
          ProcedureName: 'Validation 5'
        },
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
          RawCodes: 'MX,I',
          UserDefinedFields: '{"treestemstate":"old tree"}',
          UploadFileID: 'file-1',
          UploadBatchID: 'batch-1',
          ErrorSource: 'ingestion',
          ErrorCode: 'DUPLICATE_TAG_CONFLICT',
          DisplayMessage: 'Conflicting duplicate TreeTag/StemTag rows detected in upload batch',
          ValidationCriteria: '',
          ProcedureName: ''
        },
        {
          CoreMeasurementID: 102,
          PlotID: 5,
          CensusID: 7,
          QuadratID: 1,
          TreeID: 12,
          StemGUID: 22,
          SpeciesID: 32,
          TreeTag: 'TREE-1',
          StemTag: 'A',
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
          RawCodes: 'A',
          UserDefinedFields: '{"treestemstate":"old tree"}',
          UploadFileID: 'file-1',
          UploadBatchID: 'batch-1',
          ErrorSource: 'validation',
          ErrorCode: '21',
          DisplayMessage: 'Same-batch species conflict',
          ValidationCriteria: '',
          ProcedureName: ''
        }
      ])
      .mockResolvedValueOnce([
        {
          TreeTag: 'TREE-1',
          StemTag: 'A',
          MeasurementIDs: '101,102'
        }
      ])
      .mockResolvedValueOnce([
        {
          UploadFileID: 'file-1',
          UploadBatchID: 'batch-1',
          TreeTag: 'TREE-1',
          MeasurementIDs: '101,102'
        }
      ]);

    const response = await POST(
      new Request('http://localhost/api/errors/explorer/query', {
        method: 'POST',
        body: JSON.stringify({
          schema: 'forestgeo_testing',
          plotID: 5,
          censusID: 7,
          page: 0,
          pageSize: 25,
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

    expect(body.totalRows).toBe(2);
    expect(body.rows[0]).toMatchObject({
      coreMeasurementID: 101,
      rawCodes: 'MX,I',
      hasContradiction: true,
      contradictionType: 'duplicate_tag_stem'
    });
    expect(body.rows[0].contradictionTypes).toEqual(expect.arrayContaining(['duplicate_tag_stem', 'same_batch_conflict']));
    expect(body.rows[0].errorMessages).toContain('Duplicate tree/stem tag');
    expect(body.rows[0].errorSources).toEqual(expect.arrayContaining(['validation', 'ingestion']));
    expect(body.rows[0].relatedMeasurementIDs).toEqual([102]);
    const rowsWithType = (type: string) => body.rows.filter((row: { contradictionTypes: string[] }) => row.contradictionTypes.includes(type)).length;
    console.log(
      '[view-errors query contradiction flags]',
      JSON.stringify({
        withContradiction: body.rows.filter((row: { hasContradiction: boolean }) => row.hasContradiction).length,
        duplicateTagStem: rowsWithType('duplicate_tag_stem'),
        sameBatchConflict: rowsWithType('same_batch_conflict')
      })
    );
    expect(body.rows.filter((row: { hasContradiction: boolean }) => row.hasContradiction)).toHaveLength(2);
    expect(rowsWithType('duplicate_tag_stem')).toBe(2);
    expect(rowsWithType('same_batch_conflict')).toBe(2);
    expect(body).not.toHaveProperty('summary');
  });

  it('surfaces overlapping contradiction rows in same-batch filters', async () => {
    const cm = (ConnectionManager as any).getInstance();
    vi.spyOn(cm, 'executeQuery')
      .mockResolvedValueOnce([
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
          RawCodes: 'MX,I',
          UserDefinedFields: '{"treestemstate":"old tree"}',
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
          TreeTag: 'TREE-1',
          StemTag: 'A',
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
          RawCodes: 'A',
          UserDefinedFields: '{"treestemstate":"old tree"}',
          UploadFileID: 'file-1',
          UploadBatchID: 'batch-1',
          ErrorSource: 'validation',
          ErrorCode: '21',
          DisplayMessage: 'Same-batch species conflict',
          ValidationCriteria: '',
          ProcedureName: ''
        }
      ])
      .mockResolvedValueOnce([
        {
          TreeTag: 'TREE-1',
          StemTag: 'A',
          MeasurementIDs: '101,102'
        }
      ])
      .mockResolvedValueOnce([
        {
          UploadFileID: 'file-1',
          UploadBatchID: 'batch-1',
          TreeTag: 'TREE-1',
          MeasurementIDs: '101,102'
        }
      ]);

    const response = await POST(
      new Request('http://localhost/api/errors/explorer/query', {
        method: 'POST',
        body: JSON.stringify({
          schema: 'forestgeo_testing',
          plotID: 5,
          censusID: 7,
          page: 0,
          pageSize: 25,
          filters: {
            source: 'all',
            exactMessages: [],
            affectedFields: [],
            contradictionOnly: true,
            contradictionTypes: ['same_batch_conflict'],
            quickSearch: ''
          }
        })
      }) as any,
      ROUTE_CONTEXT
    );

    expect(response.status).toBe(HTTPResponses.OK);
    const body = await response.json();

    expect(body.totalRows).toBe(2);
    expect(body.rows[0]).toMatchObject({
      coreMeasurementID: 101,
      rawCodes: 'MX,I',
      contradictionType: 'same_batch_conflict',
      relatedMeasurementIDs: [102]
    });
  });

  // Regression: derive isFailedRow from cm.StemGUID (aliased as CoreStemGUID),
  // not ms.StemGUID, because ms.StemGUID can be stale. View Errors uses this
  // to route hard-failed rows to the failedmeasurements edit surface.
  it('marks rows where coremeasurements.StemGUID IS NULL as isFailedRow=true even if measurementssummary still has a stale StemGUID', async () => {
    const cm = (ConnectionManager as any).getInstance();
    vi.spyOn(cm, 'executeQuery')
      .mockResolvedValueOnce([
        {
          CoreMeasurementID: 201,
          PlotID: 5,
          CensusID: 7,
          QuadratID: 1,
          TreeID: 11,
          // Stale ms.StemGUID — points at a stem that the row no longer
          // resolves to. cm.StemGUID is the truth.
          StemGUID: 21,
          CoreStemGUID: null,
          SpeciesID: 31,
          TreeTag: 'TREE-1',
          StemTag: 'A',
          SpeciesName: 'Species 1',
          SubspeciesName: null,
          SpeciesCode: 'SYNSSP',
          QuadratName: 'Q1',
          StemLocalX: 10,
          StemLocalY: 20,
          MeasurementDate: '2026-01-01',
          MeasuredDBH: 5.1,
          MeasuredHOM: 1.3,
          IsValidated: false,
          MeasurementDescription: 'Invalid species code: "SYNSSP" not found in database',
          Attributes: null,
          RawCodes: null,
          UserDefinedFields: null,
          UploadFileID: 'file-1',
          UploadBatchID: 'batch-1',
          ErrorSource: 'ingestion',
          ErrorCode: 'INVALID_SPECIES',
          DisplayMessage: 'Invalid species code: "SYNSSP"',
          ValidationCriteria: '',
          ProcedureName: ''
        },
        {
          CoreMeasurementID: 202,
          PlotID: 5,
          CensusID: 7,
          QuadratID: 1,
          TreeID: 12,
          StemGUID: 22,
          CoreStemGUID: 22,
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
          MeasurementDescription: 'row 202',
          Attributes: null,
          RawCodes: 'A',
          UserDefinedFields: null,
          UploadFileID: 'file-1',
          UploadBatchID: 'batch-1',
          ErrorSource: 'validation',
          ErrorCode: '5',
          DisplayMessage: 'DBH outlier',
          ValidationCriteria: '',
          ProcedureName: ''
        }
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const response = await POST(
      new Request('http://localhost/api/errors/explorer/query', {
        method: 'POST',
        body: JSON.stringify({
          schema: 'forestgeo_testing',
          plotID: 5,
          censusID: 7,
          page: 0,
          pageSize: 25,
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
    const failedRow = body.rows.find((row: any) => row.coreMeasurementID === 201);
    const resolvedRow = body.rows.find((row: any) => row.coreMeasurementID === 202);

    expect(failedRow.isFailedRow).toBe(true);
    expect(resolvedRow.isFailedRow).toBe(false);
  });
});

const VALID_BODY = { schema: 'forestgeo_testing', plotID: 5, censusID: 7, page: 0, pageSize: 25 };
/** lib/route-authz.ts:119: fromBody turns an unparseable body into a missing schema before the handler runs. */
const ROUTE_AUTHZ_INVALID_SCHEMA_CODE = 'INVALID_SCHEMA';

function postQuery(body: unknown) {
  return POST(
    new Request('http://localhost/api/errors/explorer/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body)
    }) as any,
    ROUTE_CONTEXT
  );
}

describe('POST /api/errors/explorer/query request validation (P1-1)', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ['a non-numeric page', { page: 'x' }],
    ['a negative page', { page: -1 }],
    ['page size 7', { pageSize: 7 }],
    ['page size 101', { pageSize: 101 }],
    ['26 census IDs', { censusIDs: Array.from({ length: 26 }, (_, index) => index + 1) }],
    ['101 messages', { filters: { exactMessages: Array.from({ length: 101 }, (_, index) => `m${index}`) } }],
    ['a 1,001-character message', { filters: { exactMessages: ['m'.repeat(1001)] } }],
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
    ['a text value of 201 characters', { columnFilters: [{ field: 'treeTag', operator: 'contains', value: 'a'.repeat(201) }] }],
    ['an errorType with an unknown source', { errorType: { source: 'bogus', code: '1', message: 'm' } }]
  ])('answers %s with the fixed 400 and runs no SQL beyond the cached schema-quarantine lookup', async (_label, overrides) => {
    const executeQuery = vi.spyOn((ConnectionManager as any).getInstance(), 'executeQuery');
    const response = await postQuery({ ...VALID_BODY, ...overrides });
    const body = await response.json();
    console.log('[view-errors query 400]', _label, response.status, JSON.stringify(body), executeQuery.mock.calls.length);
    expect(response.status).toBe(HTTPResponses.INVALID_REQUEST);
    expect(body).toEqual(INVALID_ERRORS_EXPLORER_REQUEST_RESPONSE);
    expect(executeQuery).not.toHaveBeenCalled();
  });

  it("answers a malformed JSON body with the authz wrapper's 400 INVALID_SCHEMA before the handler runs", async () => {
    const executeQuery = vi.spyOn((ConnectionManager as any).getInstance(), 'executeQuery');
    const response = await postQuery('{"schema":');
    const body = await response.json();
    console.log('[view-errors query malformed json]', response.status, JSON.stringify(body));
    expect(response.status).toBe(HTTPResponses.INVALID_REQUEST);
    expect(body.code).toBe(ROUTE_AUTHZ_INVALID_SCHEMA_CODE);
    expect(executeQuery).not.toHaveBeenCalled();
  });

  it('answers a thrown error with the fixed 500 and logs, not returns, the exception', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const secret = 'ER_PARSE_ERROR near SELECT secret_table';
    vi.spyOn(cm, 'executeQuery').mockRejectedValueOnce(new Error(secret));
    const response = await postQuery(VALID_BODY);
    const text = await response.text();
    console.log('[view-errors query 500]', response.status, text);
    expect(response.status).toBe(HTTPResponses.INTERNAL_SERVER_ERROR);
    expect(JSON.parse(text)).toEqual(ERRORS_EXPLORER_FAILURE_RESPONSES.query);
    expect(text).not.toContain(secret);
    expect(vi.mocked(ailogger.error).mock.calls.some(call => call.some(argument => argument instanceof Error && argument.message === secret))).toBe(true);
  });

  it('passes errorType, sortModel and columnFilters through to the query', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const errorType = { source: 'validation', code: '5', message: 'Duplicate tree/stem tag' };
    const sortModel = [{ field: 'treeTag', sort: 'desc' }];
    const columnFilters = [{ field: 'stemTag', operator: 'contains', value: 'A' }];
    const executeQuery = vi.spyOn(cm, 'executeQuery').mockResolvedValue([]);
    const response = await postQuery({ ...VALID_BODY, errorType, sortModel, columnFilters });
    const body = await response.json();
    console.log('[view-errors query passthrough]', response.status, JSON.stringify(body), executeQuery.mock.calls.length);
    expect(response.status).toBe(HTTPResponses.OK);
    expect(body.rows, 'an empty error set answers an empty grid, so the request was parsed and run').toEqual([]);
    expect(executeQuery).toHaveBeenCalled();
  });
});
