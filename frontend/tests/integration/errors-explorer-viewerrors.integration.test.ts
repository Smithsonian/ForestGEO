import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_ERROR_EXPLORER_FILTERS,
  FALLBACK_ERROR_CODE,
  FALLBACK_ERROR_MESSAGE,
  type ErrorExplorerColumnFilter,
  type ErrorExplorerDetailsResponse,
  type ErrorExplorerFacetsResponse,
  type ErrorExplorerFilters,
  type ErrorExplorerQueryResponse,
  type ErrorExplorerSortItem,
  type ErrorTypeIdentity
} from '@/config/errorsexplorer';
import * as production from '@/app/api/errors/explorer/_shared';
import {
  buildRelatedRowsOutsideErrorSetStatement,
  CENSUS_LIST_SIZE,
  ERROR_EXPLORER_STATEMENT_LABELS,
  ID_LIST_SIZE,
  type RelatedRowOutsideErrorSetRow
} from '@/app/api/errors/explorer/errorsetsql';
import { buildActiveMeasurementCountQuery } from '../oracles/errors-explorer-legacy-activecount';
import { DEFAULT_TEST_CONFIG } from '../setup/local-db-setup';
import { runQueryDispatch } from '../setup/runquerydispatch';
import {
  assertLocalOrRefuse,
  createFixtureDatabaseSession,
  createRecordingExecutor,
  DECOY_CENSUS_ID,
  DECOY_PLOT_ID,
  FIRST_CENSUS_ID,
  FIXTURE_HOOK_TIMEOUT_MS,
  MAIN_PLOT_ID,
  replaceFixture,
  SECOND_CENSUS_ID,
  type ExplorerFixture,
  type FixtureDatabase,
  type FixtureErrorType,
  type FixtureLog,
  type FixtureMeasurement,
  type FixtureValidation,
  type RecordedStatement
} from './helpers/errorsexplorerfixtures';

vi.mock('@/ailogger', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

const VIEW_ERRORS_DATABASE = `${DEFAULT_TEST_CONFIG.database}_errview`;
const ACTIVE_COUNT_SQL_MARKER = 'SELECT COUNT(*) AS n';
const ACTIVE_COUNT_KIND = 'active-count';
const UNLABELLED_KIND = 'unlabelled';
const LARGE_PAGE_SIZE = 100;
const FIRST_PAGE = 0;
const CENSUS_IDS = [FIRST_CENSUS_ID, SECOND_CENSUS_ID];

const SHARED_MESSAGE = 'Shared message';
const VALIDATION_14_MESSAGE = 'Attribute code does not exist in attributes table';
const DUPLICATE_MESSAGE = 'Duplicate TreeTag/StemTag within upload batch';
const VALIDATION_14_ID = 14;
const VALIDATION_14_FIELD = 'speciesCode';
const VALIDATION_14_FIELD_SEARCH = VALIDATION_14_FIELD.toLowerCase();

const CODE_A: ErrorTypeIdentity = { source: 'ingestion', code: 'CODE_A', message: SHARED_MESSAGE };
const CODE_B: ErrorTypeIdentity = { source: 'ingestion', code: 'CODE_B', message: SHARED_MESSAGE };
const VALIDATION_14: ErrorTypeIdentity = { source: 'validation', code: String(VALIDATION_14_ID), message: VALIDATION_14_MESSAGE };
const DUPLICATE: ErrorTypeIdentity = { source: 'ingestion', code: 'DUPLICATE_TAG_STEMTAG', message: DUPLICATE_MESSAGE };
const FALLBACK: ErrorTypeIdentity = { source: 'ingestion', code: FALLBACK_ERROR_CODE, message: FALLBACK_ERROR_MESSAGE };

const CODE_A_ERROR_ID = 1;
const CODE_B_ERROR_ID = 2;
const VALIDATION_14_ERROR_ID = 3;
const DUPLICATE_ERROR_ID = 4;

const ROW = {
  alpha: 101,
  beta: 102,
  gamma: 103,
  failedDelta: 104,
  noLogEpsilon: 105,
  gammaCleanPartner: 106,
  inactiveWithError: 107,
  secondCensusZeta: 201,
  decoyCensus: 301
} as const;
const GAMMA_TREE_TAG = 'GAMMA';
const GAMMA_SEARCH = 'gamma';
const SEARCH_MATCHING_NOTHING = 'no-row-has-this-text';
const FIXTURE_DATE = '2020-06-01';
const FIXTURE_DBH = 12.5;
const FIXTURE_HOM = 1.3;
const STALE_SUMMARY_STEM_GUID = 9999;

/** Every active measurement of the two censuses in scope: 101 to 106 and 201. The inactive 107 and the decoy census's 301 must not be counted. */
const EXPECTED_ACTIVE_MEASUREMENTS = 7;
const EXPECTED_CENSUS_TOTALS = {
  affectedMeasurements: 6,
  activeMeasurements: EXPECTED_ACTIVE_MEASUREMENTS,
  errorTypeCount: 5,
  validation: 2,
  ingestion: 5,
  failedMeasurements: 1,
  contradictions: 1,
  duplicateTagStem: 1,
  sameBatchConflict: 0
};

function measurement(coreMeasurementID: number, overrides: Partial<FixtureMeasurement> = {}): FixtureMeasurement {
  return {
    coreMeasurementID,
    plotID: MAIN_PLOT_ID,
    censusID: FIRST_CENSUS_ID,
    isActive: true,
    coreStemGUID: coreMeasurementID,
    summaryStemGUID: coreMeasurementID,
    coreIsValidated: false,
    summaryIsValidated: false,
    treeTag: `T${coreMeasurementID}`,
    stemTag: '1',
    speciesCode: 'AAA',
    quadratName: 'Q01',
    measurementDate: FIXTURE_DATE,
    measuredDBH: FIXTURE_DBH,
    measuredHOM: FIXTURE_HOM,
    rawCodes: null,
    stemLocalX: 1.5,
    stemLocalY: 2.5,
    quadratID: null,
    treeID: null,
    speciesID: null,
    speciesName: null,
    subspeciesName: null,
    stemPlotX: null,
    stemPlotY: null,
    attributes: null,
    userDefinedFields: null,
    description: null,
    uploadFileID: null,
    uploadBatchID: null,
    ...overrides
  };
}

function unresolvedLog(measurementID: number, errorID: number): FixtureLog {
  return { measurementID, errorID, isResolved: false };
}

const ERROR_TYPES: FixtureErrorType[] = [
  { errorID: CODE_A_ERROR_ID, source: CODE_A.source, code: CODE_A.code, message: CODE_A.message },
  { errorID: CODE_B_ERROR_ID, source: CODE_B.source, code: CODE_B.code, message: CODE_B.message },
  { errorID: VALIDATION_14_ERROR_ID, source: VALIDATION_14.source, code: VALIDATION_14.code, message: 'Catalog text that the validation description replaces' },
  { errorID: DUPLICATE_ERROR_ID, source: DUPLICATE.source, code: DUPLICATE.code, message: DUPLICATE.message }
];
const VALIDATIONS: FixtureValidation[] = [
  { validationID: VALIDATION_14_ID, procedureName: 'ValidateAttributes', description: VALIDATION_14_MESSAGE, criteria: VALIDATION_14_FIELD }
];

/**
 * Census 1: 101 (CODE_A), 102 (CODE_B), 103 (validation 14 and CODE_A, in a duplicate group with the clean 106), 104 (failed, DUPLICATE_TAG_STEMTAG),
 * 105 (invalid without a log row), and the inactive 107 (CODE_A). Census 2: 201 (validation 14). The decoy census 3 holds an active 301 (CODE_A).
 */
function viewErrorsFixture(): ExplorerFixture {
  const measurements = [
    measurement(ROW.alpha, { treeTag: 'ALPHA' }),
    measurement(ROW.beta, { treeTag: 'BETA' }),
    measurement(ROW.gamma, { treeTag: GAMMA_TREE_TAG }),
    measurement(ROW.failedDelta, { treeTag: 'DELTA', coreStemGUID: null, summaryStemGUID: STALE_SUMMARY_STEM_GUID }),
    measurement(ROW.noLogEpsilon, { treeTag: 'EPSILON' }),
    measurement(ROW.gammaCleanPartner, { treeTag: GAMMA_TREE_TAG, coreIsValidated: true, summaryIsValidated: true }),
    measurement(ROW.inactiveWithError, { treeTag: 'ETA', isActive: false }),
    measurement(ROW.secondCensusZeta, { treeTag: 'ZETA', censusID: SECOND_CENSUS_ID }),
    measurement(ROW.decoyCensus, { treeTag: 'THETA', censusID: DECOY_CENSUS_ID })
  ];
  return {
    plotIDs: [MAIN_PLOT_ID],
    censuses: [FIRST_CENSUS_ID, SECOND_CENSUS_ID, DECOY_CENSUS_ID].map(censusID => ({ censusID, plotID: MAIN_PLOT_ID, plotCensusNumber: censusID })),
    errorTypes: ERROR_TYPES,
    validations: VALIDATIONS,
    measurements,
    logs: [
      unresolvedLog(ROW.alpha, CODE_A_ERROR_ID),
      unresolvedLog(ROW.beta, CODE_B_ERROR_ID),
      unresolvedLog(ROW.gamma, VALIDATION_14_ERROR_ID),
      unresolvedLog(ROW.gamma, CODE_A_ERROR_ID),
      unresolvedLog(ROW.failedDelta, DUPLICATE_ERROR_ID),
      unresolvedLog(ROW.inactiveWithError, CODE_A_ERROR_ID),
      unresolvedLog(ROW.secondCensusZeta, VALIDATION_14_ERROR_ID),
      unresolvedLog(ROW.decoyCensus, CODE_A_ERROR_ID)
    ]
  };
}

const GROWTH_ERROR_ID = 5;
const SAME_BATCH_21_ERROR_ID = 6;
const GROWTH_VALIDATION_ID = 1;
const SAME_BATCH_21_VALIDATION_ID = 21;
const GROWTH_MESSAGE = 'DBH growth exceeds maximum rate of 65 mm';
const SAME_BATCH_21_MESSAGE = 'Same-batch species conflict';
const GROWTH: ErrorTypeIdentity = { source: 'validation', code: String(GROWTH_VALIDATION_ID), message: GROWTH_MESSAGE };
const SAME_BATCH_21: ErrorTypeIdentity = { source: 'validation', code: String(SAME_BATCH_21_VALIDATION_ID), message: SAME_BATCH_21_MESSAGE };
const QUERY_ERROR_TYPES: FixtureErrorType[] = [
  ...ERROR_TYPES,
  { errorID: GROWTH_ERROR_ID, source: GROWTH.source, code: GROWTH.code, message: 'Catalog text that the validation description replaces' },
  { errorID: SAME_BATCH_21_ERROR_ID, source: SAME_BATCH_21.source, code: SAME_BATCH_21.code, message: 'Catalog text that the validation description replaces' }
];
const QUERY_VALIDATIONS: FixtureValidation[] = [
  ...VALIDATIONS,
  { validationID: GROWTH_VALIDATION_ID, procedureName: 'ValidateDBHGrowth', description: GROWTH_MESSAGE, criteria: 'measuredDBH' },
  { validationID: SAME_BATCH_21_VALIDATION_ID, procedureName: 'ValidateSameBatch', description: SAME_BATCH_21_MESSAGE, criteria: '' }
];

function explorerFixture(measurements: FixtureMeasurement[], logs: FixtureLog[]): ExplorerFixture {
  return {
    plotIDs: [MAIN_PLOT_ID, DECOY_PLOT_ID],
    censuses: [
      { censusID: FIRST_CENSUS_ID, plotID: MAIN_PLOT_ID, plotCensusNumber: FIRST_CENSUS_ID },
      { censusID: SECOND_CENSUS_ID, plotID: MAIN_PLOT_ID, plotCensusNumber: SECOND_CENSUS_ID },
      { censusID: DECOY_CENSUS_ID, plotID: DECOY_PLOT_ID, plotCensusNumber: DECOY_CENSUS_ID }
    ],
    errorTypes: QUERY_ERROR_TYPES,
    validations: QUERY_VALIDATIONS,
    measurements,
    logs
  };
}

const SORT_FIRST_ID = 300;
const SORT_GROUP_SIZE = 25;
const SORT_PAGE_SIZE = 10;
const SORT_SECOND_PAGE = 1;
const SORT_ELEVENTH_LARGEST_DBH = 16;
const SORT_TIED_LARGEST_DBH = 25;
const SORT_BLANK_ROW_ID = 400;
const SORT_TIE_ROW_ID = 401;
const SORT_LARGEST_GROUP_ROW_ID = SORT_FIRST_ID + SORT_GROUP_SIZE - 1;

function sortFixture(): ExplorerFixture {
  const groupRows = Array.from({ length: SORT_GROUP_SIZE }, (_, index) => measurement(SORT_FIRST_ID + index, { measuredDBH: index + 1 }));
  const measurements = [
    ...groupRows,
    measurement(SORT_BLANK_ROW_ID, { measuredDBH: null }),
    measurement(SORT_TIE_ROW_ID, { measuredDBH: SORT_TIED_LARGEST_DBH })
  ];
  return explorerFixture(
    measurements,
    measurements.map(row => unresolvedLog(row.coreMeasurementID, VALIDATION_14_ERROR_ID))
  );
}

const FILTER_ROWS = { alpha: 601, lowerAlpha: 602, beta: 603 } as const;
const FILTER_SPECIES_MATCHING_SEARCH = 'ACERRU';

function columnFilterFixture(): ExplorerFixture {
  const measurements = [
    measurement(FILTER_ROWS.alpha, { treeTag: 'ALPHA-1', speciesCode: FILTER_SPECIES_MATCHING_SEARCH }),
    measurement(FILTER_ROWS.lowerAlpha, { treeTag: 'alpha-2', speciesCode: 'QUERCO' }),
    measurement(FILTER_ROWS.beta, { treeTag: 'BETA-3', speciesCode: FILTER_SPECIES_MATCHING_SEARCH })
  ];
  return explorerFixture(
    measurements,
    measurements.map(row => unresolvedLog(row.coreMeasurementID, VALIDATION_14_ERROR_ID))
  );
}

const GROWTH_ROWS = { roundedUp: 701, roundedDown: 702, noPrior: 703, zeroPrior: 704 } as const;
const GROWTH_PRIOR_DBH = 100;
const GROWTH_FIXED_DBH = 50;
const GROWTH_ROUNDED_UP_DBH = 120.06;
const GROWTH_ROUNDED_DOWN_DBH = 120.04;
const GROWTH_PERCENT_THRESHOLD = 20;
const GROWTH_PERCENT_ABOVE_THRESHOLD = 20.1;

function growthFixture(): ExplorerFixture {
  const growthRow = (id: number, measuredDBH: number) => measurement(id, { censusID: SECOND_CENSUS_ID, measuredDBH });
  const growthLog = (measurementID: number, priorDBH: number | null): FixtureLog => ({
    measurementID,
    errorID: GROWTH_ERROR_ID,
    isResolved: false,
    priorCensusID: FIRST_CENSUS_ID,
    priorDBH
  });
  return explorerFixture(
    [
      growthRow(GROWTH_ROWS.roundedUp, GROWTH_ROUNDED_UP_DBH),
      growthRow(GROWTH_ROWS.roundedDown, GROWTH_ROUNDED_DOWN_DBH),
      growthRow(GROWTH_ROWS.noPrior, GROWTH_FIXED_DBH),
      growthRow(GROWTH_ROWS.zeroPrior, GROWTH_FIXED_DBH)
    ],
    [
      growthLog(GROWTH_ROWS.roundedUp, GROWTH_PRIOR_DBH),
      growthLog(GROWTH_ROWS.roundedDown, GROWTH_PRIOR_DBH),
      growthLog(GROWTH_ROWS.noPrior, null),
      growthLog(GROWTH_ROWS.zeroPrior, 0)
    ]
  );
}

const DUPLICATE_FIELDS_ROW_ID = 801;
const EXPORT_ROWS = { codeA: 101, codeB: 102, both: 103 } as const;

const OUTSIDE_PARTNER_ROWS = { clean: 301, flagged: 302 } as const;
const OUTSIDE_PARTNER_TREE_TAG = 'SB-1';
const OUTSIDE_PARTNER_UPLOAD = { fileID: 'file-1', batchID: 'batch-1' } as const;
const OUTSIDE_PARTNER_DBH = 10;
const OUTSIDE_PARTNER_SPECIES = 'AAA';
const FLAGGED_ROW_SPECIES = 'BBB';
const CLEAN_ROW_STEM_TAG = '2';

function sameBatchPartnerRows(): FixtureMeasurement[] {
  const upload = { uploadFileID: OUTSIDE_PARTNER_UPLOAD.fileID, uploadBatchID: OUTSIDE_PARTNER_UPLOAD.batchID, treeTag: OUTSIDE_PARTNER_TREE_TAG };
  return [
    measurement(OUTSIDE_PARTNER_ROWS.clean, {
      ...upload,
      stemTag: CLEAN_ROW_STEM_TAG,
      speciesCode: OUTSIDE_PARTNER_SPECIES,
      measuredDBH: OUTSIDE_PARTNER_DBH,
      coreIsValidated: true,
      summaryIsValidated: true
    }),
    measurement(OUTSIDE_PARTNER_ROWS.flagged, { ...upload, speciesCode: FLAGGED_ROW_SPECIES })
  ];
}

const GUARD_ROWS = {
  error: 901,
  cleanPartner: 902,
  inactivePartner: 903,
  otherCensusRow: 904,
  otherPlotRow: 905,
  secondCensusError: 906,
  secondCensusPartner: 907
} as const;
const GUARD_TREE_TAG = 'GUARD';
const GUARD_SECOND_CENSUS_TREE_TAG = 'GUARD2';
const GUARD_SUMMARY_VALUES = { measuredDBH: 11.25, measuredHOM: 1.35, measurementDate: '2020-06-02', description: 'summary description' } as const;
const GUARD_CORE_DECOY_VALUES = { measuredDBH: 999.5, measuredHOM: 9.9, measurementDate: '1999-01-01', description: 'core description' } as const;
const GUARD_UPLOAD = { fileID: 'file-902', batchID: 'batch-902' } as const;

function outsideLookupGuardFixture(): ExplorerFixture {
  const cleanRow = (id: number, overrides: Partial<FixtureMeasurement>) =>
    measurement(id, { treeTag: GUARD_TREE_TAG, coreIsValidated: true, summaryIsValidated: true, ...overrides });
  return explorerFixture(
    [
      measurement(GUARD_ROWS.error, { treeTag: GUARD_TREE_TAG }),
      cleanRow(GUARD_ROWS.cleanPartner, {
        ...GUARD_SUMMARY_VALUES,
        uploadFileID: GUARD_UPLOAD.fileID,
        uploadBatchID: GUARD_UPLOAD.batchID,
        speciesCode: 'CLN'
      }),
      cleanRow(GUARD_ROWS.inactivePartner, { isActive: false }),
      cleanRow(GUARD_ROWS.otherCensusRow, { censusID: SECOND_CENSUS_ID }),
      cleanRow(GUARD_ROWS.otherPlotRow, { plotID: DECOY_PLOT_ID }),
      measurement(GUARD_ROWS.secondCensusError, { treeTag: GUARD_SECOND_CENSUS_TREE_TAG, censusID: SECOND_CENSUS_ID }),
      cleanRow(GUARD_ROWS.secondCensusPartner, { treeTag: GUARD_SECOND_CENSUS_TREE_TAG, censusID: SECOND_CENSUS_ID })
    ],
    [unresolvedLog(GUARD_ROWS.error, VALIDATION_14_ERROR_ID), unresolvedLog(GUARD_ROWS.secondCensusError, VALIDATION_14_ERROR_ID)]
  );
}

type ProductionExecutor = Parameters<typeof production.queryErrorExplorer>[0];

const kindOf = (statement: RecordedStatement): string =>
  statement.label ?? (statement.sql.includes(ACTIVE_COUNT_SQL_MARKER) ? ACTIVE_COUNT_KIND : UNLABELLED_KIND);
const sortedKindsOf = (statements: readonly RecordedStatement[]): string[] => statements.map(kindOf).sort();
const SQL_FACET_KINDS = [ERROR_EXPLORER_STATEMENT_LABELS.catalog, ERROR_EXPLORER_STATEMENT_LABELS.histogramWithFlags, ACTIVE_COUNT_KIND].sort();
const NODE_FACET_KINDS = [ERROR_EXPLORER_STATEMENT_LABELS.scopeRawRows, ACTIVE_COUNT_KIND].sort();

const identityOf = ({ source, code, message }: ErrorTypeIdentity): ErrorTypeIdentity => ({ source, code, message });

describe('View Errors facets, counts and queries on real MySQL (#544)', () => {
  let fixtureDatabase: FixtureDatabase | null = null;
  const fixtureSession = createFixtureDatabaseSession(VIEW_ERRORS_DATABASE);
  const database = () => (fixtureDatabase as FixtureDatabase).database;
  const explorerConnection = () => (fixtureDatabase as FixtureDatabase).explorerConnection;

  const scope = () => ({ schema: database(), plotID: MAIN_PLOT_ID, censusID: FIRST_CENSUS_ID, censusIDs: CENSUS_IDS });

  async function facetsFor(filters: Partial<ErrorExplorerFilters> = {}): Promise<{ facets: ErrorExplorerFacetsResponse; statements: RecordedStatement[] }> {
    const recorder = createRecordingExecutor(explorerConnection(), { measureJsonBytes: false });
    const facets = await production.buildErrorExplorerFacets(recorder as unknown as ProductionExecutor, {
      ...scope(),
      filters: { ...DEFAULT_ERROR_EXPLORER_FILTERS, ...filters }
    });
    console.log(
      '[view-errors facets]',
      JSON.stringify({
        filters,
        errorTypes: facets.errorTypes.map(type => [type.code, type.count]),
        censusTotals: facets.censusTotals,
        kinds: sortedKindsOf(recorder.statements)
      })
    );
    return { facets, statements: [...recorder.statements] };
  }

  async function queryTotalRows(filters: Partial<ErrorExplorerFilters>, errorType?: ErrorTypeIdentity): Promise<number> {
    const recorder = createRecordingExecutor(explorerConnection(), { measureJsonBytes: false });
    const response = await production.queryErrorExplorer(recorder as unknown as ProductionExecutor, {
      ...scope(),
      page: FIRST_PAGE,
      pageSize: LARGE_PAGE_SIZE,
      filters: { ...DEFAULT_ERROR_EXPLORER_FILTERS, ...filters },
      errorType
    });
    return response.totalRows;
  }

  /** Registers a beforeAll in the calling describe that replaces the database's rows, so a describe never reads another's fixture. */
  function useFixture(fixture: ExplorerFixture = viewErrorsFixture()): void {
    beforeAll(async () => replaceFixture((fixtureDatabase as FixtureDatabase).setupConnection, fixture), FIXTURE_HOOK_TIMEOUT_MS);
  }

  async function queryFor(
    overrides: {
      page?: number;
      pageSize?: number;
      errorType?: ErrorTypeIdentity;
      sortModel?: ErrorExplorerSortItem[];
      columnFilters?: ErrorExplorerColumnFilter[];
    },
    filters: Partial<ErrorExplorerFilters> = {}
  ): Promise<ErrorExplorerQueryResponse> {
    const recorder = createRecordingExecutor(explorerConnection(), { measureJsonBytes: false });
    const response = await production.queryErrorExplorer(recorder as unknown as ProductionExecutor, {
      ...scope(),
      page: FIRST_PAGE,
      pageSize: LARGE_PAGE_SIZE,
      filters: { ...DEFAULT_ERROR_EXPLORER_FILTERS, ...filters },
      ...overrides
    });
    console.log(
      '[view-errors query]',
      JSON.stringify({
        overrides,
        filters,
        totalRows: response.totalRows,
        ids: response.rows.map(row => row.coreMeasurementID),
        kinds: sortedKindsOf(recorder.statements)
      })
    );
    return response;
  }

  beforeAll(async () => {
    assertLocalOrRefuse();
    fixtureDatabase = await fixtureSession.open();
  }, FIXTURE_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    fixtureDatabase = null;
    await fixtureSession.close();
  }, FIXTURE_HOOK_TIMEOUT_MS);

  describe('facets errorTypes (P2-1)', () => {
    useFixture();

    it('lists two identities for one message shared by two codes, ordered by count then message, source, code', async () => {
      const { facets, statements } = await facetsFor();

      expect(facets.errorTypes.map(type => [type.code, type.count])).toEqual([
        [VALIDATION_14.code, 2],
        [CODE_A.code, 2],
        [DUPLICATE.code, 1],
        [FALLBACK.code, 1],
        [CODE_B.code, 1]
      ]);
      expect(sortedKindsOf(statements), 'unsearched facets are answered from the histogram').toEqual(SQL_FACET_KINDS);
    });

    it('lists both identities sharing a linked message, and nothing else', async () => {
      const { facets, statements } = await facetsFor({ exactMessages: [SHARED_MESSAGE] });

      expect(facets.errorTypes.map(type => type.code)).toEqual([CODE_A.code, CODE_B.code]);
      expect(sortedKindsOf(statements)).toEqual(SQL_FACET_KINDS);
    });

    it("lists only a mixed-source row's validation identity under Show → Validation", async () => {
      const { facets } = await facetsFor({ source: 'validation' });

      expect(facets.errorTypes.map(identityOf)).toEqual([VALIDATION_14]);
      expect(facets.errorTypes[0].count, 'rows 103 and 201 carry validation 14').toBe(2);
    });

    it('marks the identity whose rows carry a contradiction', async () => {
      const { facets } = await facetsFor();

      expect(facets.errorTypes.find(type => type.code === VALIDATION_14.code)?.hasContradiction, 'row 103 is in a duplicate group').toBe(true);
      expect(facets.errorTypes.find(type => type.code === CODE_B.code)?.hasContradiction).toBe(false);
    });

    it.each<[string, Partial<ErrorExplorerFilters>]>([
      ['the defaults', {}],
      ['Show → Validation', { source: 'validation' }],
      ['Show → Contradictions', { contradictionOnly: true }],
      ['a search', { quickSearch: GAMMA_SEARCH }]
    ])('equals the query totalRows for each identity under %s', async (_label, filters) => {
      const { facets } = await facetsFor(filters);

      expect(facets.errorTypes.length, 'the case must list at least one identity').toBeGreaterThan(0);
      for (const type of facets.errorTypes) {
        const totalRows = await queryTotalRows(filters, identityOf(type));
        expect(totalRows, JSON.stringify({ filters, type })).toBe(type.count);
      }
    });
  });

  describe('facets censusTotals', () => {
    useFixture();

    it('counts the whole error set and ignores every filter', async () => {
      const defaults = (await facetsFor()).facets.censusTotals;
      const narrowed = (await facetsFor({ source: 'validation', quickSearch: 'zeta', exactMessages: [VALIDATION_14_MESSAGE] })).facets.censusTotals;

      expect(defaults).toEqual(EXPECTED_CENSUS_TOTALS);
      expect(narrowed).toEqual(defaults);
    });

    it('counts a linked failed_no_log row under ingestion but not as failed (D-d)', async () => {
      const { facets } = await facetsFor();

      expect(facets.censusTotals.failedMeasurements, 'only row 104 has coremeasurements.StemGUID NULL').toBe(1);
      expect(facets.censusTotals.ingestion, 'rows 101 to 105 carry an ingestion error, 105 through the no-log fallback').toBe(5);
    });

    it('counts census totals over the whole error set when a search narrows the error types', async () => {
      const unsearched = (await facetsFor()).facets;
      const { facets: searched, statements } = await facetsFor({ quickSearch: GAMMA_SEARCH });

      expect(searched.censusTotals, 'the search must not narrow the totals').toEqual(unsearched.censusTotals);
      expect(
        searched.errorTypes.map(type => [type.code, type.count]),
        'row 103 is the only row that matches the search; it carries validation 14 and CODE_A'
      ).toEqual([
        [VALIDATION_14.code, 1],
        [CODE_A.code, 1]
      ]);
      expect(searched.errorTypes.length).toBeLessThan(unsearched.errorTypes.length);
      expect(sortedKindsOf(statements), 'a search reads the error rows and the active count').toEqual(NODE_FACET_KINDS);
    });

    it('searches only the errors the filters keep: a field carried by a filtered-out error does not match', async () => {
      const unsearched = (await facetsFor()).facets;
      const ingestionOnly = await facetsFor({ source: 'ingestion', quickSearch: VALIDATION_14_FIELD_SEARCH });
      const validationOnly = await facetsFor({ source: 'validation', quickSearch: VALIDATION_14_FIELD_SEARCH });

      expect(ingestionOnly.facets.errorTypes, `${VALIDATION_14_FIELD} is a field of validation 14 only, and Show → Ingestion filters that error out`).toEqual(
        []
      );
      expect(ingestionOnly.facets.censusTotals).toEqual(unsearched.censusTotals);
      expect(
        validationOnly.facets.errorTypes.map(type => [type.code, type.count]),
        'rows 103 and 201 carry validation 14'
      ).toEqual([[VALIDATION_14.code, 2]]);
    });

    it('lists no error type but still counts the whole error set when a search matches nothing', async () => {
      const unsearched = (await facetsFor()).facets;
      const { facets: searched } = await facetsFor({ quickSearch: SEARCH_MATCHING_NOTHING });

      expect(searched.errorTypes).toEqual([]);
      expect(searched.censusTotals).toEqual(unsearched.censusTotals);
    });

    it('runs the shared active count over every census ID', async () => {
      const { facets, statements } = await facetsFor();

      const expected = buildActiveMeasurementCountQuery(database(), MAIN_PLOT_ID, CENSUS_IDS);
      const activeCountStatements = statements.filter(statement => kindOf(statement) === ACTIVE_COUNT_KIND);
      console.log('[view-errors active count]', JSON.stringify(activeCountStatements.map(({ sql, params, rows }) => ({ sql, params, rows }))));
      expect(activeCountStatements.map(({ sql, params }) => ({ sql, params }))).toEqual([{ sql: expected.sql, params: expected.params }]);
      expect(facets.censusTotals.activeMeasurements, 'the inactive row 107 and the decoy census row 301 are not counted').toBe(EXPECTED_ACTIVE_MEASUREMENTS);
    });
  });

  describe('message counts', () => {
    useFixture();

    it("matches the View Errors query: each message's count is that message's totalRows, and the total is censusTotals.affectedMeasurements", async () => {
      const counts = await production.buildErrorMessageCounts(
        createRecordingExecutor(explorerConnection(), { measureJsonBytes: false }) as unknown as ProductionExecutor,
        { schema: database(), plotID: MAIN_PLOT_ID, censusIDs: CENSUS_IDS }
      );
      const { facets } = await facetsFor();

      console.log('[view-errors message counts]', JSON.stringify({ counts, affectedMeasurements: facets.censusTotals.affectedMeasurements }));
      expect(counts.messages.length, 'the fixture must carry several messages').toBeGreaterThan(1);
      expect(counts.totalMeasurements).toBe(facets.censusTotals.affectedMeasurements);
      for (const { value, count } of counts.messages) {
        expect(await queryTotalRows({ exactMessages: [value] }), value).toBe(count);
      }
    });
  });
  describe('queries on the Node path: sort, column filter and display values', () => {
    describe('sort across the whole error-type group', () => {
      useFixture(sortFixture());

      it('starts page 1 of a DBH-descending sort with the 11th largest DBH overall', async () => {
        const response = await queryFor({
          errorType: VALIDATION_14,
          page: SORT_SECOND_PAGE,
          pageSize: SORT_PAGE_SIZE,
          sortModel: [{ field: 'measuredDBH', sort: 'desc' }]
        });

        expect(response.totalRows).toBe(SORT_GROUP_SIZE + 2);
        expect(Number(response.rows[0].measuredDBH), 'the first row of page 1 is the 11th largest, not the 1st of the page-0 slice').toBe(
          SORT_ELEVENTH_LARGEST_DBH
        );
      });

      it('puts blanks last in both directions and breaks ties by ID ascending', async () => {
        const descending = await queryFor({ errorType: VALIDATION_14, sortModel: [{ field: 'measuredDBH', sort: 'desc' }] });
        const ascending = await queryFor({ errorType: VALIDATION_14, sortModel: [{ field: 'measuredDBH', sort: 'asc' }] });

        expect(
          descending.rows.slice(0, 2).map(row => row.coreMeasurementID),
          `DBH ${SORT_TIED_LARGEST_DBH} is carried by two rows`
        ).toEqual([SORT_LARGEST_GROUP_ROW_ID, SORT_TIE_ROW_ID]);
        expect(descending.rows.at(-1)?.coreMeasurementID).toBe(SORT_BLANK_ROW_ID);
        expect(ascending.rows.at(-1)?.coreMeasurementID).toBe(SORT_BLANK_ROW_ID);
      });
    });

    describe('column filter before pagination', () => {
      useFixture(columnFilterFixture());

      it('reflects the filter in totalRows and ANDs it with Search', async () => {
        const startsWithAlpha: ErrorExplorerColumnFilter = { field: 'treeTag', operator: 'startsWith', value: 'alpha' };

        const filtered = await queryFor({ errorType: VALIDATION_14, columnFilters: [startsWithAlpha] });
        const searched = await queryFor({ errorType: VALIDATION_14, columnFilters: [startsWithAlpha] }, { quickSearch: FILTER_SPECIES_MATCHING_SEARCH });

        expect(filtered.totalRows, 'ALPHA-1 and alpha-2 start with alpha').toBe(2);
        expect(
          searched.rows.map(row => row.coreMeasurementID),
          'only ALPHA-1 also carries the searched species'
        ).toEqual([FILTER_ROWS.alpha]);
        expect(searched.totalRows).toBe(1);
      });
    });

    describe('prior DBH and Change', () => {
      useFixture(growthFixture());

      it('computes the rounded percent and leaves it blank without a usable prior', async () => {
        const response = await queryFor({ errorType: GROWTH });

        const percentByID = Object.fromEntries(response.rows.map(row => [row.coreMeasurementID, row.dbhChangePercent]));
        expect(percentByID).toEqual({
          [GROWTH_ROWS.roundedUp]: GROWTH_PERCENT_ABOVE_THRESHOLD,
          [GROWTH_ROWS.roundedDown]: GROWTH_PERCENT_THRESHOLD,
          [GROWTH_ROWS.noPrior]: null,
          [GROWTH_ROWS.zeroPrior]: null
        });
      });

      it.each<[ErrorExplorerColumnFilter, number[]]>([
        [{ field: 'priorDBH', operator: 'isEmpty' }, [GROWTH_ROWS.noPrior]],
        [{ field: 'priorDBH', operator: 'isNotEmpty' }, [GROWTH_ROWS.roundedUp, GROWTH_ROWS.roundedDown, GROWTH_ROWS.zeroPrior]],
        [{ field: 'priorDBH', operator: '!=', value: GROWTH_PRIOR_DBH }, [GROWTH_ROWS.noPrior, GROWTH_ROWS.zeroPrior]],
        [{ field: 'priorDBH', operator: '>', value: 0 }, [GROWTH_ROWS.roundedUp, GROWTH_ROWS.roundedDown]],
        [{ field: 'dbhChangePercent', operator: '>', value: GROWTH_PERCENT_THRESHOLD }, [GROWTH_ROWS.roundedUp]]
      ])('%j keeps rows %j', async (filter, expectedIDs) => {
        const response = await queryFor({ errorType: GROWTH, columnFilters: [filter] });

        expect(response.rows.map(row => row.coreMeasurementID).sort()).toEqual([...expectedIDs].sort());
        expect(response.totalRows).toBe(expectedIDs.length);
      });
    });

    describe('DUPLICATE_TAG_STEMTAG fields', () => {
      useFixture(explorerFixture([measurement(DUPLICATE_FIELDS_ROW_ID)], [unresolvedLog(DUPLICATE_FIELDS_ROW_ID, DUPLICATE_ERROR_ID)]));

      it('highlights the tree and stem tag columns', async () => {
        const response = await queryFor({ errorType: DUPLICATE });

        expect(response.rows.map(row => row.errorFields)).toEqual([['treeTag', 'stemTag']]);
      });
    });
  });

  describe('export of one error type', () => {
    useFixture(
      explorerFixture(
        [measurement(EXPORT_ROWS.codeA), measurement(EXPORT_ROWS.codeB), measurement(EXPORT_ROWS.both)],
        [
          unresolvedLog(EXPORT_ROWS.codeA, CODE_A_ERROR_ID),
          unresolvedLog(EXPORT_ROWS.codeB, CODE_B_ERROR_ID),
          unresolvedLog(EXPORT_ROWS.both, CODE_A_ERROR_ID),
          unresolvedLog(EXPORT_ROWS.both, CODE_B_ERROR_ID)
        ]
      )
    );

    it('exports only the occurrences of the requested identity', async () => {
      const recorder = createRecordingExecutor(explorerConnection(), { measureJsonBytes: false });
      const grouped = await production.fetchGroupedErrorRows(recorder as unknown as ProductionExecutor, database(), MAIN_PLOT_ID, CENSUS_IDS);

      const everything = production.buildErrorExportRows(grouped, DEFAULT_ERROR_EXPLORER_FILTERS);
      const onlyCodeA = production.buildErrorExportRows(grouped, DEFAULT_ERROR_EXPLORER_FILTERS, CODE_A);
      console.log(
        '[view-errors export]',
        JSON.stringify({
          everything: everything.map(row => [row.CoreMeasurementID, row.ErrorCode]),
          onlyCodeA: onlyCodeA.map(row => [row.CoreMeasurementID, row.ErrorCode])
        })
      );

      expect(everything, 'two codes sharing one message are four occurrences').toHaveLength(4);
      expect(onlyCodeA.map(row => row.ErrorCode)).toEqual([CODE_A.code, CODE_A.code]);
      expect(onlyCodeA.map(row => row.CoreMeasurementID).sort()).toEqual([EXPORT_ROWS.codeA, EXPORT_ROWS.both]);
    });
  });

  describe('details related rows outside the error set', () => {
    async function detailsFor(
      measurementID: number,
      censusID: number = FIRST_CENSUS_ID
    ): Promise<{ details: ErrorExplorerDetailsResponse; statements: RecordedStatement[] }> {
      const recorder = createRecordingExecutor(explorerConnection(), { measureJsonBytes: false });
      const details = await production.buildErrorExplorerDetails(
        recorder as unknown as ProductionExecutor,
        { schema: database(), plotID: MAIN_PLOT_ID, censusID },
        measurementID
      );
      console.log(
        '[view-errors details]',
        JSON.stringify({ measurementID, censusID, relatedRows: details.relatedRows, kinds: sortedKindsOf(recorder.statements) })
      );
      return { details, statements: [...recorder.statements] };
    }
    const lookupsIn = (statements: readonly RecordedStatement[]) =>
      statements.filter(statement => statement.label === ERROR_EXPLORER_STATEMENT_LABELS.relatedRowsOutsideErrorSet);

    describe('a clean same-batch partner', () => {
      useFixture(explorerFixture(sameBatchPartnerRows(), [unresolvedLog(OUTSIDE_PARTNER_ROWS.flagged, SAME_BATCH_21_ERROR_ID)]));

      it("returns validation 21's clean first row as a related row outside the error set", async () => {
        const { details, statements } = await detailsFor(OUTSIDE_PARTNER_ROWS.flagged);

        expect(details.relatedRows).toEqual([
          expect.objectContaining({
            coreMeasurementID: OUTSIDE_PARTNER_ROWS.clean,
            inErrorSet: false,
            errorCount: 0,
            errorMessages: [],
            measuredDBH: OUTSIDE_PARTNER_DBH,
            speciesCode: OUTSIDE_PARTNER_SPECIES
          })
        ]);
        const [lookup, ...otherLookups] = lookupsIn(statements);
        expect(otherLookups, 'one outside ID is one lookup').toEqual([]);
        expect(lookup.params[0], 'the plot').toBe(MAIN_PLOT_ID);
        expect(lookup.params.slice(1, 1 + CENSUS_LIST_SIZE), 'the details census, padded').toEqual([
          FIRST_CENSUS_ID,
          ...Array(CENSUS_LIST_SIZE - 1).fill(null)
        ]);
        expect(lookup.params.slice(1 + CENSUS_LIST_SIZE), 'the outside ID, padded').toEqual([
          OUTSIDE_PARTNER_ROWS.clean,
          ...Array(ID_LIST_SIZE - 1).fill(null)
        ]);
      });

      it('keeps the clean row out of every count and group', async () => {
        const recorder = createRecordingExecutor(explorerConnection(), { measureJsonBytes: false });

        const facets = await production.buildErrorExplorerFacets(recorder as unknown as ProductionExecutor, {
          ...scope(),
          filters: DEFAULT_ERROR_EXPLORER_FILTERS
        });

        console.log('[view-errors clean partner facets]', JSON.stringify({ errorTypes: facets.errorTypes, censusTotals: facets.censusTotals }));
        expect(facets.censusTotals.affectedMeasurements, 'only the flagged row is in the error set').toBe(1);
        expect(facets.errorTypes.map(type => type.count)).toEqual([1]);
      });
    });

    describe('a partner that is in the error set too', () => {
      useFixture(
        explorerFixture(sameBatchPartnerRows(), [
          unresolvedLog(OUTSIDE_PARTNER_ROWS.flagged, SAME_BATCH_21_ERROR_ID),
          unresolvedLog(OUTSIDE_PARTNER_ROWS.clean, VALIDATION_14_ERROR_ID)
        ])
      );

      it('runs no lookup when every related row is in the error set, and marks those rows inErrorSet', async () => {
        const { details, statements } = await detailsFor(OUTSIDE_PARTNER_ROWS.flagged);

        expect(details.relatedRows.map(row => [row.coreMeasurementID, row.inErrorSet])).toEqual([[OUTSIDE_PARTNER_ROWS.clean, true]]);
        expect(lookupsIn(statements), 'no outside ID, no lookup').toEqual([]);
      });
    });

    describe('the lookup guards', () => {
      useFixture(outsideLookupGuardFixture());

      beforeAll(async () => {
        const { setupConnection } = fixtureDatabase as FixtureDatabase;
        await setupConnection.query('SET FOREIGN_KEY_CHECKS = 0');
        try {
          await setupConnection.query(
            'UPDATE coremeasurements SET MeasuredDBH = ?, MeasuredHOM = ?, MeasurementDate = ?, Description = ? WHERE CoreMeasurementID = ?',
            [
              GUARD_CORE_DECOY_VALUES.measuredDBH,
              GUARD_CORE_DECOY_VALUES.measuredHOM,
              GUARD_CORE_DECOY_VALUES.measurementDate,
              GUARD_CORE_DECOY_VALUES.description,
              GUARD_ROWS.cleanPartner
            ]
          );
        } finally {
          await setupConnection.query('SET FOREIGN_KEY_CHECKS = 1');
        }
      }, FIXTURE_HOOK_TIMEOUT_MS);

      async function runLookup(censusIDs: number[], measurementIDs: number[]): Promise<RelatedRowOutsideErrorSetRow[]> {
        const statement = buildRelatedRowsOutsideErrorSetStatement({ schema: database(), plotID: MAIN_PLOT_ID, censusIDs }, measurementIDs);
        const rows = (await runQueryDispatch(explorerConnection(), statement.sql, statement.params)) as RelatedRowOutsideErrorSetRow[];
        console.log('[view-errors outside lookup]', JSON.stringify({ censusIDs, measurementIDs, returned: rows.map(row => row.RelatedCoreMeasurementID) }));
        return rows;
      }

      const EVERY_CANDIDATE = [GUARD_ROWS.cleanPartner, GUARD_ROWS.inactivePartner, GUARD_ROWS.otherCensusRow, GUARD_ROWS.otherPlotRow];

      it('returns an active partner of the details census and drops the inactive, other-census and other-plot rows', async () => {
        const { details, statements } = await detailsFor(GUARD_ROWS.error);

        expect(
          details.relatedRows.map(row => [row.coreMeasurementID, row.inErrorSet]),
          `the duplicate group lists the inactive ${GUARD_ROWS.inactivePartner} too`
        ).toEqual([[GUARD_ROWS.cleanPartner, false]]);
        expect(lookupsIn(statements)).toHaveLength(1);
        expect((await runLookup([FIRST_CENSUS_ID], EVERY_CANDIDATE)).map(row => Number(row.RelatedCoreMeasurementID))).toEqual([GUARD_ROWS.cleanPartner]);
      });

      it('binds the details census, not the first census of the scope', async () => {
        const { details } = await detailsFor(GUARD_ROWS.secondCensusError, SECOND_CENSUS_ID);

        expect(details.relatedRows.map(row => [row.coreMeasurementID, row.inErrorSet])).toEqual([[GUARD_ROWS.secondCensusPartner, false]]);
        expect((await runLookup([SECOND_CENSUS_ID], EVERY_CANDIDATE)).map(row => Number(row.RelatedCoreMeasurementID))).toEqual([GUARD_ROWS.otherCensusRow]);
        expect((await runLookup([FIRST_CENSUS_ID, SECOND_CENSUS_ID], EVERY_CANDIDATE)).map(row => Number(row.RelatedCoreMeasurementID)).sort()).toEqual([
          GUARD_ROWS.cleanPartner,
          GUARD_ROWS.otherCensusRow
        ]);
      });

      it('reads the display columns from measurementssummary and the upload IDs from coremeasurements', async () => {
        const [row] = await runLookup([FIRST_CENSUS_ID], [GUARD_ROWS.cleanPartner]);

        expect(Number(row.MeasuredDBH), `coremeasurements holds the decoy ${GUARD_CORE_DECOY_VALUES.measuredDBH}`).toBe(GUARD_SUMMARY_VALUES.measuredDBH);
        expect(Number(row.MeasuredHOM)).toBe(GUARD_SUMMARY_VALUES.measuredHOM);
        expect(row.MeasurementDescription).toBe(GUARD_SUMMARY_VALUES.description);
        expect(new Date(row.MeasurementDate as Date | string).toISOString().slice(0, GUARD_SUMMARY_VALUES.measurementDate.length)).toBe(
          GUARD_SUMMARY_VALUES.measurementDate
        );
        expect(row.UploadFileID).toBe(GUARD_UPLOAD.fileID);
        expect(row.UploadBatchID).toBe(GUARD_UPLOAD.batchID);
        expect(row.SpeciesCode).toBe('CLN');
      });
    });
  });
});
