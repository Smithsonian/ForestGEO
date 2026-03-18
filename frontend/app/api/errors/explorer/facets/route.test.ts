import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';
import ConnectionManager from '@/config/connectionmanager';
import { HTTPResponses } from '@/config/macros';

vi.mock('@/ailogger', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() }
}));

vi.mock('@/config/connectionmanager', async () => {
  const actual = await vi.importActual<any>('@/config/connectionmanager').catch(() => ({}));
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
      }) as any
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
});

