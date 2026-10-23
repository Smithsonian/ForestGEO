import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';
import ConnectionManager from '@/lib/db/connectionmanager';
import { HTTPResponses } from '@/config/macros';

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

describe('POST /api/errors/explorer/facets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns message and field facets scoped to the current census', async () => {
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
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

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
    expect(body.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: 'Duplicate tree/stem tag', count: 1 }),
        expect.objectContaining({ value: 'Conflicting duplicate TreeTag/StemTag rows detected in upload batch', count: 1 })
      ])
    );
    expect(body.fields).toEqual(expect.arrayContaining([expect.objectContaining({ value: 'treeTag', count: 2 })]));
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
    console.log('[#547 facets total]', JSON.stringify({ totalMeasurements: body.totalMeasurements, messages: body.messages }));
    expect(body.messages.map((option: { value: string }) => option.value).sort()).toEqual([SECOND_MESSAGE, FIRST_MESSAGE].sort());
    expect(body.totalMeasurements, 'two messages on one measurement are one affected measurement').toBe(1);
  });
});
