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
      }) as any
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
    expect(body.summary.contradictions).toBe(2);
    expect(body.summary.duplicateTagStem).toBe(2);
    expect(body.summary.sameBatchConflict).toBe(2);
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
      }) as any
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
      }) as any
    );

    expect(response.status).toBe(HTTPResponses.OK);
    const body = await response.json();
    const failedRow = body.rows.find((row: any) => row.coreMeasurementID === 201);
    const resolvedRow = body.rows.find((row: any) => row.coreMeasurementID === 202);

    expect(failedRow.isFailedRow).toBe(true);
    expect(resolvedRow.isFailedRow).toBe(false);
  });
});
