import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_ERROR_EXPLORER_FILTERS,
  FALLBACK_ERROR_CODE,
  FALLBACK_ERROR_MESSAGE,
  type ErrorExplorerFacetsResponse,
  type ErrorExplorerFilters,
  type ErrorTypeIdentity
} from '@/config/errorsexplorer';
import * as production from '@/app/api/errors/explorer/_shared';
import { ERROR_EXPLORER_STATEMENT_LABELS } from '@/app/api/errors/explorer/errorsetsql';
import { buildActiveMeasurementCountQuery } from '../oracles/errors-explorer-legacy-activecount';
import { DEFAULT_TEST_CONFIG } from '../setup/local-db-setup';
import {
  assertLocalOrRefuse,
  createFixtureDatabaseSession,
  createRecordingExecutor,
  DECOY_CENSUS_ID,
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

  beforeAll(async () => {
    assertLocalOrRefuse();
    fixtureDatabase = await fixtureSession.open();
    await replaceFixture((fixtureDatabase as FixtureDatabase).setupConnection, viewErrorsFixture());
  }, FIXTURE_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    fixtureDatabase = null;
    await fixtureSession.close();
  }, FIXTURE_HOOK_TIMEOUT_MS);

  describe('facets errorTypes (P2-1)', () => {
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
});
