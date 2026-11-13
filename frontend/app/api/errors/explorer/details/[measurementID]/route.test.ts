import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';
import ConnectionManager from '@/lib/db/connectionmanager';
import { HTTPResponses } from '@/config/macros';
import { ERRORS_EXPLORER_FAILURE_RESPONSES, INVALID_ERRORS_EXPLORER_REQUEST_RESPONSE } from '@/lib/errorsexplorer/explorerrequest';
import ailogger from '@/ailogger';

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

describe('GET /api/errors/explorer/details/[measurementID]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns full error details and related contradiction rows', async () => {
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
          UserDefinedFields: '{}',
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
      .mockResolvedValueOnce([]);

    const request = {
      nextUrl: new URL('http://localhost/api/errors/explorer/details/101?schema=forestgeo_testing&plotID=5&censusID=7')
    };
    const response = await GET(request as any, { params: Promise.resolve({ measurementID: '101' }) });

    expect(response.status).toBe(HTTPResponses.OK);
    const body = await response.json();
    expect(body.row).toMatchObject({
      coreMeasurementID: 101,
      rawCodes: 'MX,I',
      hasContradiction: true,
      contradictionType: 'duplicate_tag_stem'
    });
    expect(body.row.contradictionTypes).toEqual(expect.arrayContaining(['duplicate_tag_stem']));
    expect(body.allErrors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: '5',
          message: 'Duplicate tree/stem tag',
          fields: ['treeTag', 'stemTag']
        })
      ])
    );
    expect(body.relatedRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          coreMeasurementID: 102,
          speciesCode: 'SP2',
          stemLocalX: 12,
          stemLocalY: 22,
          description: 'row 102',
          errorCount: 1,
          errorMessages: ['Same-batch species conflict']
        })
      ])
    );
  });

  it('uses the requested contradiction type when a row belongs to multiple groups', async () => {
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
          UserDefinedFields: '{}',
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

    const request = {
      nextUrl: new URL(
        'http://localhost/api/errors/explorer/details/101?schema=forestgeo_testing&plotID=5&censusID=7&activeContradictionType=same_batch_conflict'
      )
    };
    const response = await GET(request as any, { params: Promise.resolve({ measurementID: '101' }) });

    expect(response.status).toBe(HTTPResponses.OK);
    const body = await response.json();

    expect(body.row).toMatchObject({
      coreMeasurementID: 101,
      rawCodes: 'MX,I',
      contradictionType: 'same_batch_conflict'
    });
    expect(body.row.contradictionTypes).toEqual(expect.arrayContaining(['duplicate_tag_stem', 'same_batch_conflict']));
    expect(body.relatedRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          coreMeasurementID: 102,
          speciesCode: 'SP2'
        })
      ])
    );
  });

  it.each([
    ['a non-integer measurement ID', '12.5', '1', '5'],
    ['a zero measurement ID', '0', '1', '5'],
    ['a non-numeric plot ID', '12', 'abc', '5'],
    ['a missing census ID', '12', '1', null]
  ])('answers %s with the fixed 400 and runs no SQL beyond the cached schema-quarantine lookup', async (_label, measurementID, plotID, censusID) => {
    const executeQuery = vi.spyOn((ConnectionManager as any).getInstance(), 'executeQuery');
    const search = new URLSearchParams({ schema: 'forestgeo_testing', plotID: plotID ?? '' });
    if (censusID !== null) search.set('censusID', censusID);
    const request = { nextUrl: new URL(`http://localhost/api/errors/explorer/details/${measurementID}?${search.toString()}`) };
    const response = await GET(request as any, { params: Promise.resolve({ measurementID }) });
    const body = await response.json();
    console.log('[view-errors details 400]', _label, response.status, JSON.stringify(body), executeQuery.mock.calls.length);
    expect(response.status).toBe(HTTPResponses.INVALID_REQUEST);
    expect(body).toEqual(INVALID_ERRORS_EXPLORER_REQUEST_RESPONSE);
    expect(executeQuery).not.toHaveBeenCalled();
  });

  it('answers an unknown contradiction type with the same fixed 400', async () => {
    const executeQuery = vi.spyOn((ConnectionManager as any).getInstance(), 'executeQuery');
    const request = {
      nextUrl: new URL('http://localhost/api/errors/explorer/details/101?schema=forestgeo_testing&plotID=5&censusID=7&activeContradictionType=bogus')
    };
    const response = await GET(request as any, { params: Promise.resolve({ measurementID: '101' }) });
    const body = await response.json();
    console.log('[view-errors details bad contradiction type]', response.status, JSON.stringify(body));
    expect(response.status).toBe(HTTPResponses.INVALID_REQUEST);
    expect(body).toEqual(INVALID_ERRORS_EXPLORER_REQUEST_RESPONSE);
    expect(executeQuery).not.toHaveBeenCalled();
  });

  it('answers a thrown error with the fixed 500 and logs, not returns, the exception', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const secret = 'ER_PARSE_ERROR near SELECT secret_table';
    vi.spyOn(cm, 'executeQuery').mockRejectedValue(new Error(secret));
    const request = { nextUrl: new URL('http://localhost/api/errors/explorer/details/101?schema=forestgeo_testing&plotID=5&censusID=7') };
    const response = await GET(request as any, { params: Promise.resolve({ measurementID: '101' }) });
    const text = await response.text();
    console.log('[view-errors details 500]', response.status, text);
    expect(response.status).toBe(HTTPResponses.INTERNAL_SERVER_ERROR);
    expect(JSON.parse(text)).toEqual(ERRORS_EXPLORER_FAILURE_RESPONSES.details);
    expect(text).not.toContain(secret);
    expect(vi.mocked(ailogger.error).mock.calls.some(call => call.some(argument => argument instanceof Error && argument.message === secret))).toBe(true);
  });
});
