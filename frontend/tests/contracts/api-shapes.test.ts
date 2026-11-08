import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_ERROR_EXPLORER_FILTERS, type ErrorExplorerQueryRequest } from '@/config/errorsexplorer';
import { buildErrorExplorerFacets, queryErrorExplorer } from '@/app/api/errors/explorer/_shared';
import { ERROR_EXPLORER_STATEMENT_LABELS, readStatementLabel, SQL_FALSE, SQL_TRUE } from '@/app/api/errors/explorer/errorsetsql';

const SPECIES_MISMATCH_ERROR_ID = 1;
const INVALID_SPECIES_ERROR_ID = 2;
const catalogRows = [
  {
    ErrorID: SPECIES_MISMATCH_ERROR_ID,
    ErrorSource: 'validation' as const,
    ErrorCode: '21',
    DisplayMessage: 'Species mismatch',
    ValidationCriteria: 'speciesCode',
    ProcedureName: 'ValidateSpecies'
  },
  {
    ErrorID: INVALID_SPECIES_ERROR_ID,
    ErrorSource: 'ingestion' as const,
    ErrorCode: 'INVALID_SPECIES',
    DisplayMessage: 'Invalid species reference',
    ValidationCriteria: '',
    ProcedureName: ''
  }
];
// Measurements 101 and 102 share a tree tag and stem tag, so each signature row carries the duplicate flag.
const histogramWithFlagsRows = [SPECIES_MISMATCH_ERROR_ID, INVALID_SPECIES_ERROR_ID].map(errorID => ({
  ErrorTypeKeys: String(errorID),
  SignatureComplete: SQL_TRUE,
  HasDuplicate: SQL_TRUE,
  HasSameBatch: SQL_FALSE,
  MeasurementCount: 1
}));

const rawErrorRows = [
  {
    CoreMeasurementID: 101,
    PlotID: 1,
    CensusID: 5,
    QuadratID: 11,
    TreeID: 1001,
    StemGUID: 2001,
    CoreStemGUID: 2001,
    SpeciesID: 3001,
    TreeTag: 'TREE101',
    StemTag: '1',
    SpeciesName: 'Rubiaceae example',
    SubspeciesName: null,
    SpeciesCode: 'RUBI04',
    QuadratName: 'Q0101',
    StemLocalX: 10.1,
    StemLocalY: 20.2,
    MeasurementDate: '2024-06-15',
    MeasuredDBH: 15.5,
    MeasuredHOM: 1.3,
    IsValidated: false,
    MeasurementDescription: 'review species',
    Attributes: 'A',
    RawCodes: 'A',
    UserDefinedFields: 'old tree',
    UploadFileID: 'file-1',
    UploadBatchID: 'batch-1',
    ErrorSource: 'validation' as const,
    ErrorCode: '21',
    DisplayMessage: 'Species mismatch',
    ValidationCriteria: 'speciesCode',
    ProcedureName: 'ValidateSpecies'
  },
  {
    CoreMeasurementID: 102,
    PlotID: 1,
    CensusID: 5,
    QuadratID: 12,
    TreeID: 1002,
    StemGUID: 9999,
    CoreStemGUID: null,
    SpeciesID: null,
    TreeTag: 'TREE102',
    StemTag: '1',
    SpeciesName: null,
    SubspeciesName: null,
    SpeciesCode: 'BADSP',
    QuadratName: 'Q0102',
    StemLocalX: 11.1,
    StemLocalY: 21.2,
    MeasurementDate: new Date('2024-06-16T12:00:00Z'),
    MeasuredDBH: 16.5,
    MeasuredHOM: 1.3,
    IsValidated: false,
    MeasurementDescription: 'bad species code',
    Attributes: null,
    RawCodes: 'DS',
    UserDefinedFields: null,
    UploadFileID: 'file-1',
    UploadBatchID: 'batch-1',
    ErrorSource: 'ingestion' as const,
    ErrorCode: 'INVALID_SPECIES',
    DisplayMessage: 'Invalid species reference',
    ValidationCriteria: null,
    ProcedureName: null
  }
];

function makeConnection() {
  return {
    executeQuery: vi.fn(async (query: string) => {
      if (query.includes('measurement_error_log')) {
        return rawErrorRows;
      }
      if (query.includes('GROUP_CONCAT(DISTINCT ms.CoreMeasurementID')) {
        return [{ TreeTag: 'TREE101', StemTag: '1', MeasurementIDs: '101,102' }];
      }
      if (query.includes('GROUP_CONCAT(DISTINCT cm.CoreMeasurementID')) {
        return [];
      }
      throw new Error(`Unexpected query in contract test: ${query}`);
    })
  } as any;
}

function makeFacetsConnection() {
  return {
    executeQuery: vi.fn(async (query: string) => {
      const label = readStatementLabel(query);
      if (label === ERROR_EXPLORER_STATEMENT_LABELS.catalog) return catalogRows;
      if (label === ERROR_EXPLORER_STATEMENT_LABELS.histogramWithFlags) return histogramWithFlagsRows;
      throw new Error(`Unexpected facets statement in contract test (label ${label}): ${query}`);
    })
  } as any;
}

function makeRequest(overrides: Partial<ErrorExplorerQueryRequest> = {}): ErrorExplorerQueryRequest {
  return {
    schema: 'forestgeo_testing',
    plotID: 1,
    censusID: 5,
    page: 0,
    pageSize: 25,
    filters: DEFAULT_ERROR_EXPLORER_FILTERS,
    ...overrides
  };
}

describe('API response shape contracts', () => {
  it('keeps Errors Explorer query rows aligned with the UI contract', async () => {
    const response = await queryErrorExplorer(makeConnection(), makeRequest());

    expect(response).toMatchObject({
      totalRows: 2,
      summary: {
        total: 2,
        validation: 1,
        ingestion: 1,
        contradictions: 2,
        duplicateTagStem: 2,
        sameBatchConflict: 0
      }
    });

    expect(response.rows).toHaveLength(2);
    expect(response.rows[0]).toMatchObject({
      id: 101,
      coreMeasurementID: 101,
      plotID: 1,
      censusID: 5,
      treeTag: 'TREE101',
      stemTag: '1',
      speciesCode: 'RUBI04',
      quadratName: 'Q0101',
      measurementDate: '2024-06-15',
      primaryErrorMessage: 'Species mismatch',
      errorMessages: ['Species mismatch'],
      errorSources: ['validation'],
      errorFields: ['speciesCode'],
      errorCodes: ['21'],
      errorCount: 1,
      hasContradiction: true,
      contradictionTypes: ['duplicate_tag_stem'],
      contradictionType: 'duplicate_tag_stem',
      relatedMeasurementIDs: [102],
      uploadFileID: 'file-1',
      uploadBatchID: 'batch-1',
      isFailedRow: false
    });

    expect(response.rows[1]).toMatchObject({
      id: 102,
      coreMeasurementID: 102,
      measurementDate: '2024-06-16',
      primaryErrorMessage: 'Invalid species reference',
      errorSources: ['ingestion'],
      errorFields: ['speciesCode'],
      errorCodes: ['INVALID_SPECIES'],
      relatedMeasurementIDs: [101],
      isFailedRow: true
    });
  });

  it('keeps Errors Explorer facets stable for filters and chips', async () => {
    const facets = await buildErrorExplorerFacets(makeFacetsConnection(), makeRequest());

    expect(facets).toEqual({
      messages: [
        { value: 'Invalid species reference', count: 1 },
        { value: 'Species mismatch', count: 1 }
      ],
      fields: [{ value: 'speciesCode', count: 2 }],
      sourceCounts: {
        validation: 1,
        ingestion: 1
      },
      contradictionCounts: {
        duplicateTagStem: 2,
        sameBatchConflict: 0
      },
      totalMeasurements: 2
    });
  });
});
