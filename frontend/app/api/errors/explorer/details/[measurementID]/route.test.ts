import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';
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
});
