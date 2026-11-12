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

const duplicateMemberGroupRows = rawErrorRows.map(rawRow => ({
  RequestedMeasurementID: rawRow.CoreMeasurementID,
  CensusID: rawRow.CensusID,
  TreeTag: 'TREE101',
  StemTag: '1',
  MeasurementIDs: '101,102',
  MemberCount: 2,
  MemberListComplete: SQL_TRUE
}));

const pageTotals = {
  TotalRows: 2,
  ValidationRows: 1,
  IngestionRows: 1,
  ContradictionRows: 2,
  DuplicateTagStemRows: 2,
  SameBatchConflictRows: 0
};
// Both rows carry the duplicate flag and one error, so the page statement orders them by measurement date, then ID.
const pageRows = rawErrorRows.map(rawRow => ({
  CoreMeasurementID: rawRow.CoreMeasurementID,
  CensusID: rawRow.CensusID,
  HasContradiction: SQL_TRUE,
  OccurrenceCount: 1,
  MeasurementDate: rawRow.MeasurementDate,
  ...pageTotals
}));

function makeConnection() {
  return {
    executeQuery: vi.fn(async (query: string, params: unknown[] = []) => {
      const label = readStatementLabel(query);
      if (label === ERROR_EXPLORER_STATEMENT_LABELS.catalog) return catalogRows;
      if (label === ERROR_EXPLORER_STATEMENT_LABELS.page) return pageRows;
      if (label === ERROR_EXPLORER_STATEMENT_LABELS.idRawRows) return rawErrorRows.filter(rawRow => params.includes(rawRow.CoreMeasurementID));
      if (label === ERROR_EXPLORER_STATEMENT_LABELS.scopeRawRows) {
        return rawErrorRows.map(rawRow => ({ ...rawRow, HasDuplicate: SQL_TRUE, HasSameBatch: SQL_FALSE }));
      }
      if (label === ERROR_EXPLORER_STATEMENT_LABELS.duplicateMemberGroups) {
        return duplicateMemberGroupRows.filter(group => params.includes(group.RequestedMeasurementID));
      }
      if (label === ERROR_EXPLORER_STATEMENT_LABELS.sameBatchMemberGroups) {
        return [];
      }
      throw new Error(`Unexpected statement in test: ${label}`);
    })
  } as any;
}

const ABSENT_CENSUS_ID = 9001;

/** Records every statement. A page statement that names ABSENT_CENSUS_ID finds no rows; every other page statement returns the two rows. */
function makeWindowConnection() {
  return {
    executeQuery: vi.fn(async (query: string, params: unknown[] = []) => {
      const label = readStatementLabel(query);
      if (label === ERROR_EXPLORER_STATEMENT_LABELS.catalog) return catalogRows;
      if (label === ERROR_EXPLORER_STATEMENT_LABELS.page) return params.includes(ABSENT_CENSUS_ID) ? [] : pageRows;
      if (label === ERROR_EXPLORER_STATEMENT_LABELS.totals) return params.includes(ABSENT_CENSUS_ID) ? [{ ...pageTotals, TotalRows: 0 }] : [pageTotals];
      if (label === ERROR_EXPLORER_STATEMENT_LABELS.idRawRows) return rawErrorRows.filter(rawRow => params.includes(rawRow.CoreMeasurementID));
      if (label === ERROR_EXPLORER_STATEMENT_LABELS.duplicateMemberGroups) {
        return duplicateMemberGroupRows.filter(group => params.includes(group.RequestedMeasurementID));
      }
      if (label === ERROR_EXPLORER_STATEMENT_LABELS.sameBatchMemberGroups) return [];
      throw new Error(`Unexpected statement in the window test: ${label}`);
    })
  } as any;
}

function paramsOfStatements(connection: ReturnType<typeof makeWindowConnection>, label: string): unknown[][] {
  return connection.executeQuery.mock.calls.filter(([query]: [string]) => readStatementLabel(query) === label).map(([, params]: [string, unknown[]]) => params);
}

const PAGE_WINDOW_PARAM_COUNT = 2;
const SINGLE_CHUNK_CENSUS_IDS = [5];
const FIRST_CHUNK_CENSUS_IDS = [5, 101, 102, 103, 104, 105, 106, 107];
const TWO_CHUNK_CENSUS_IDS = [...FIRST_CHUNK_CENSUS_IDS, 108];
const SPARSE_CHUNK_CENSUS_IDS = [...FIRST_CHUNK_CENSUS_IDS, ABSENT_CENSUS_ID];
const ROWS_PER_CHUNK_TOTAL = 2;

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
    const connection = makeConnection();
    const response = await queryErrorExplorer(connection, makeRequest());

    const statementLabels = connection.executeQuery.mock.calls.map(([query]: [string]) => readStatementLabel(query));
    expect(
      statementLabels.filter((label: string | null) => label === ERROR_EXPLORER_STATEMENT_LABELS.page),
      'one page statement'
    ).toHaveLength(1);
    expect(statementLabels, 'the SQL path never reads the whole error set').not.toContain(ERROR_EXPLORER_STATEMENT_LABELS.scopeRawRows);
    expect([...statementLabels].sort()).toEqual(
      [
        ERROR_EXPLORER_STATEMENT_LABELS.catalog,
        ERROR_EXPLORER_STATEMENT_LABELS.page,
        ERROR_EXPLORER_STATEMENT_LABELS.idRawRows,
        ERROR_EXPLORER_STATEMENT_LABELS.duplicateMemberGroups,
        ERROR_EXPLORER_STATEMENT_LABELS.sameBatchMemberGroups
      ].sort()
    );

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

  it('keeps a quick-search Errors Explorer query on the Node path with the same row shape', async () => {
    const connection = makeConnection();
    const response = await queryErrorExplorer(connection, makeRequest({ filters: { ...DEFAULT_ERROR_EXPLORER_FILTERS, quickSearch: 'TREE101' } }));

    const statementLabels = connection.executeQuery.mock.calls.map(([query]: [string]) => readStatementLabel(query));
    expect(statementLabels, 'a quick search reads the whole error set once').toContain(ERROR_EXPLORER_STATEMENT_LABELS.scopeRawRows);
    expect(statementLabels).not.toContain(ERROR_EXPLORER_STATEMENT_LABELS.page);
    expect(statementLabels).not.toContain(ERROR_EXPLORER_STATEMENT_LABELS.catalog);
    expect(response.rows.map(row => row.coreMeasurementID)).toEqual([101]);
    expect(response.totalRows).toBe(1);
    expect(response.rows[0]).toMatchObject({ treeTag: 'TREE101', relatedMeasurementIDs: [102], contradictionTypes: ['duplicate_tag_stem'] });
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

describe('Errors Explorer query page window', () => {
  const LABELS = ERROR_EXPLORER_STATEMENT_LABELS;
  const windowTail = (params: unknown[]) => params.slice(-PAGE_WINDOW_PARAM_COUNT);

  interface WindowCase {
    name: string;
    censusIDs: number[];
    page: number;
    pageSize: number;
    expectedPageWindows: string[][];
    expectedTotalsStatements: number;
    expectedSummaryTotal: number;
  }

  const SINGLE_CHUNK_TOTAL = ROWS_PER_CHUNK_TOTAL;
  const TWO_CHUNK_TOTAL = 2 * ROWS_PER_CHUNK_TOTAL;
  const windowCases: WindowCase[] = [
    {
      name: 'single chunk, page 0 of 10',
      censusIDs: SINGLE_CHUNK_CENSUS_IDS,
      page: 0,
      pageSize: 10,
      expectedPageWindows: [['10', '0']],
      expectedTotalsStatements: 0,
      expectedSummaryTotal: SINGLE_CHUNK_TOTAL
    },
    {
      name: 'single chunk, page 3 of 25',
      censusIDs: SINGLE_CHUNK_CENSUS_IDS,
      page: 3,
      pageSize: 25,
      expectedPageWindows: [['25', '75']],
      expectedTotalsStatements: 0,
      expectedSummaryTotal: SINGLE_CHUNK_TOTAL
    },
    {
      name: 'single chunk, fractional page 1.5 of 25',
      censusIDs: SINGLE_CHUNK_CENSUS_IDS,
      page: 1.5,
      pageSize: 25,
      expectedPageWindows: [['25', '37']],
      expectedTotalsStatements: 0,
      expectedSummaryTotal: SINGLE_CHUNK_TOTAL
    },
    {
      name: 'single chunk, NaN page selects nothing',
      censusIDs: SINGLE_CHUNK_CENSUS_IDS,
      page: NaN,
      pageSize: 10,
      expectedPageWindows: [],
      expectedTotalsStatements: 1,
      expectedSummaryTotal: SINGLE_CHUNK_TOTAL
    },
    {
      name: 'single chunk, Infinity page selects nothing',
      censusIDs: SINGLE_CHUNK_CENSUS_IDS,
      page: Infinity,
      pageSize: 10,
      expectedPageWindows: [],
      expectedTotalsStatements: 1,
      expectedSummaryTotal: SINGLE_CHUNK_TOTAL
    },
    {
      name: 'two chunks, page 3 of 25 reads the first 100 rows of each chunk',
      censusIDs: TWO_CHUNK_CENSUS_IDS,
      page: 3,
      pageSize: 25,
      expectedPageWindows: [
        ['100', '0'],
        ['100', '0']
      ],
      expectedTotalsStatements: 0,
      expectedSummaryTotal: TWO_CHUNK_TOTAL
    },
    {
      name: 'two chunks, fractional page 1.5 of 10 reads the first 25 rows of each chunk',
      censusIDs: TWO_CHUNK_CENSUS_IDS,
      page: 1.5,
      pageSize: 10,
      expectedPageWindows: [
        ['25', '0'],
        ['25', '0']
      ],
      expectedTotalsStatements: 0,
      expectedSummaryTotal: TWO_CHUNK_TOTAL
    },
    {
      name: 'two chunks, NaN page needs one totals statement per chunk',
      censusIDs: TWO_CHUNK_CENSUS_IDS,
      page: NaN,
      pageSize: 10,
      expectedPageWindows: [],
      expectedTotalsStatements: 2,
      expectedSummaryTotal: TWO_CHUNK_TOTAL
    },
    {
      name: 'two chunks, Infinity page needs one totals statement per chunk',
      censusIDs: TWO_CHUNK_CENSUS_IDS,
      page: Infinity,
      pageSize: 10,
      expectedPageWindows: [],
      expectedTotalsStatements: 2,
      expectedSummaryTotal: TWO_CHUNK_TOTAL
    },
    {
      name: 'two chunks, the second finds no rows: it adds nothing and needs no totals statement',
      censusIDs: SPARSE_CHUNK_CENSUS_IDS,
      page: 0,
      pageSize: 10,
      expectedPageWindows: [
        ['10', '0'],
        ['10', '0']
      ],
      expectedTotalsStatements: 0,
      expectedSummaryTotal: SINGLE_CHUNK_TOTAL
    }
  ];

  it.each(windowCases)('$name', async ({ censusIDs, page, pageSize, expectedPageWindows, expectedTotalsStatements, expectedSummaryTotal }) => {
    const connection = makeWindowConnection();
    const response = await queryErrorExplorer(connection, makeRequest({ censusID: censusIDs[0], censusIDs, page, pageSize }));

    const pageWindows = paramsOfStatements(connection, LABELS.page).map(windowTail);
    const totalsStatements = paramsOfStatements(connection, LABELS.totals);
    console.log(
      `[window] censusIDs=${censusIDs.length} page=${page} size=${pageSize} pageWindows=${JSON.stringify(pageWindows)} totals=${totalsStatements.length} summary.total=${response.summary.total}`
    );
    expect(pageWindows, 'LIMIT and OFFSET bound by each page statement').toEqual(expectedPageWindows);
    expect(totalsStatements, 'totals statements').toHaveLength(expectedTotalsStatements);
    expect(response.summary.total, 'summary total').toBe(expectedSummaryTotal);
    expect(response.totalRows, 'totalRows is the summary total').toBe(expectedSummaryTotal);
  });
});
