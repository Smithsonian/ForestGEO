import type { ResultSetHeader } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_ERROR_EXPLORER_FILTERS,
  type ContradictionType,
  type ErrorExplorerFilters,
  type ErrorExplorerQueryRequest,
  type ErrorExplorerQueryResponse,
  type ErrorExplorerRow
} from '@/config/errorsexplorer';
import * as production from '@/app/api/errors/explorer/_shared';
import { buildRelatedMeasurementIDs, toSliceBounds } from '@/app/api/errors/explorer/errorsetcounts';
import {
  buildDuplicateMemberGroupsStatement,
  buildSameBatchMemberGroupsStatement,
  CENSUS_LIST_SIZE,
  ERROR_EXPLORER_STATEMENT_LABELS,
  ID_LIST_SIZE,
  LIST_SEPARATOR,
  readStatementLabel
} from '@/app/api/errors/explorer/errorsetsql';
import * as oracle from '../oracles/errors-explorer-legacy';
import { DEFAULT_TEST_CONFIG } from '../setup/local-db-setup';
import { runQueryDispatch } from '../setup/runquerydispatch';
import {
  assertLocalOrRefuse,
  createFixtureDatabaseSession,
  createRecordingExecutor,
  EQUIVALENCE_GROUP_CONCAT_MAX_LEN,
  expectExplorerEqual,
  FIRST_CENSUS_ID,
  FIXTURE_HOOK_TIMEOUT_MS,
  FIXTURE_MESSAGES,
  interleavingFixture,
  INTERLEAVING_DUPLICATE_TREE_TAG,
  INTERLEAVING_ERROR_IDS,
  INTERLEAVING_MESSAGES,
  INTERLEAVING_ROW_IDS,
  INTERLEAVING_VALIDATION_ID,
  largeGroupFixture,
  LARGE_GROUP_ERROR_SET_COUNT,
  LARGE_GROUP_MEMBER_COUNT,
  LARGE_GROUP_ERROR_MEMBER_IDS,
  LARGE_GROUP_FIRST_NON_ERROR_MEMBER_ID,
  LARGE_GROUP_SOLO_ROW_IDS,
  MAIN_PLOT_ID,
  manyCensusesFixture,
  MANY_CENSUS_COUNT,
  MANY_CENSUS_IDS,
  MANY_CENSUS_ROW_OFFSET,
  MANY_CENSUS_ROW_ID_BLOCK,
  MANY_CENSUS_TREE_TAG_SEARCH,
  replaceFixture,
  setGroupConcatMaxLen,
  SHOW_FILTER_SETS,
  type ExplorerFixture,
  type FixtureDatabase,
  type RecordedStatement
} from './helpers/errorsexplorerfixtures';

vi.mock('@/ailogger', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock('@/app/api/errors/explorer/errorsetcounts', async importOriginal => {
  const actual = await importOriginal<typeof import('@/app/api/errors/explorer/errorsetcounts')>();
  return { ...actual, buildRelatedMeasurementIDs: vi.fn(actual.buildRelatedMeasurementIDs) };
});

const CONSISTENCY_DATABASE = `${DEFAULT_TEST_CONFIG.database}_errconsist`;
const LABELS = ERROR_EXPLORER_STATEMENT_LABELS;
const WHOLE_LIST_PAGE_SIZE = Number.MAX_SAFE_INTEGER;
const FIRST_PAGE = 0;
const SMALL_PAGE_SIZE = 10;
const LARGE_PAGE_SIZE = 25;
const CHUNK_PAGE_SIZES: readonly number[] = [SMALL_PAGE_SIZE, LARGE_PAGE_SIZE];
const SLOW_CASE_TIMEOUT_MS = 10 * 60 * 1000;
const DUPLICATE: ContradictionType = 'duplicate_tag_stem';
const SAME_BATCH: ContradictionType = 'same_batch_conflict';
const CONTRADICTIONS_SHOW_LABEL = 'contradictions';
const MEMBER_GROUP_KINDS_PER_ROW = 2;
const DETAILS_FIXED_STATEMENT_COUNT = 3;
const SHORT_MEMBER_LIST_LIMIT_BYTES = 4096;
const AFFECTED_ONE_ROW = 1;
const IRREGULAR_PAGES: readonly number[] = [Number.NaN, 1.5, Number.POSITIVE_INFINITY];
const ABSENT_CENSUS_ID = MANY_CENSUS_COUNT + 1;
const SPARSE_CHUNK_CENSUS_IDS: readonly number[] = [...MANY_CENSUS_IDS.slice(0, CENSUS_LIST_SIZE), ABSENT_CENSUS_ID];
const SPARSE_CHUNK_COUNT = 2;
const PAGE_WINDOW_PARAM_COUNT = 2;
const EXPECTED_CHUNK_SIZES = [CENSUS_LIST_SIZE, CENSUS_LIST_SIZE, CENSUS_LIST_SIZE, MANY_CENSUS_COUNT - 3 * CENSUS_LIST_SIZE];

type OracleExecutor = Parameters<typeof oracle.queryErrorExplorer>[0];
type ProductionExecutor = Parameters<typeof production.queryErrorExplorer>[0];
type MemberGroupRow = { RequestedMeasurementID: number; MeasurementIDs: string | null; MemberCount: number | string; MemberListComplete: number | string };

const filtersWith = (overrides: Partial<ErrorExplorerFilters>): ErrorExplorerFilters => ({ ...DEFAULT_ERROR_EXPLORER_FILTERS, ...overrides });

const CONTRADICTIONS_SHOW_FILTERS: ErrorExplorerFilters = (() => {
  const showSet = SHOW_FILTER_SETS.find(candidate => candidate.label === CONTRADICTIONS_SHOW_LABEL);
  if (!showSet) throw new Error(`The Show set ${CONTRADICTIONS_SHOW_LABEL} no longer exists`);
  return {
    ...showSet.filters,
    exactMessages: [...showSet.filters.exactMessages],
    affectedFields: [...showSet.filters.affectedFields],
    contradictionTypes: [...showSet.filters.contradictionTypes]
  };
})();

function sliceWholeList(whole: ErrorExplorerQueryResponse, page: number, pageSize: number): ErrorExplorerQueryResponse {
  const start = page * pageSize;
  return { rows: whole.rows.slice(start, start + pageSize), totalRows: whole.totalRows };
}

/** Every page of the list, plus one past the end. */
function pagesIncludingOnePastTheEnd(totalRows: number, pageSize: number): number[] {
  const lastPage = Math.max(0, Math.ceil(totalRows / pageSize) - 1);
  return Array.from({ length: lastPage + 2 }, (_, page) => page);
}

const idsOf = (rows: ErrorExplorerRow[]) => rows.map(row => Number(row.coreMeasurementID));
const countLabel = (statements: readonly RecordedStatement[], label: string) => statements.filter(statement => statement.label === label).length;
const censusChunkIndex = (censusID: number) => Math.floor((censusID - 1) / CENSUS_LIST_SIZE);

describe('errors explorer: the SQL query path under concurrent change, census chunks and a large group (#544)', () => {
  let fixtureDatabase: FixtureDatabase | null = null;
  const fixtureSession = createFixtureDatabaseSession(CONSISTENCY_DATABASE);

  const database = () => (fixtureDatabase as FixtureDatabase).database;
  const explorerConnection = () => (fixtureDatabase as FixtureDatabase).explorerConnection;
  const setupConnection = () => (fixtureDatabase as FixtureDatabase).setupConnection;
  const plainExecutor = () => ({ executeQuery: async (sql: string, params?: unknown[]) => runQueryDispatch(explorerConnection(), sql, params) });
  const oracleExecutor = (): OracleExecutor => plainExecutor();
  const queryRequest = (censusIDs: readonly number[], filters: ErrorExplorerFilters, page: number, pageSize: number): ErrorExplorerQueryRequest => ({
    schema: database(),
    plotID: MAIN_PLOT_ID,
    censusID: censusIDs[0],
    censusIDs: [...censusIDs],
    page,
    pageSize,
    filters
  });
  const loadFixture = (fixture: ExplorerFixture) => replaceFixture(setupConnection(), fixture);

  beforeAll(async () => {
    assertLocalOrRefuse();
    fixtureDatabase = await fixtureSession.open();
  }, FIXTURE_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    fixtureDatabase = null;
    await fixtureSession.close();
  }, FIXTURE_HOOK_TIMEOUT_MS);

  beforeEach(async () => {
    const actualCounts = await vi.importActual<typeof import('@/app/api/errors/explorer/errorsetcounts')>('@/app/api/errors/explorer/errorsetcounts');
    vi.mocked(buildRelatedMeasurementIDs).mockImplementation(actualCounts.buildRelatedMeasurementIDs);
  });

  describe('interleaving: another session changes the data between the page statement and the row re-read (spec Testing section 4)', () => {
    const ROW = INTERLEAVING_ROW_IDS;
    const ERROR_ID = INTERLEAVING_ERROR_IDS;
    const MESSAGE = INTERLEAVING_MESSAGES;
    const DEFAULT_ORDER = [
      ROW.duplicateErrorMember,
      ROW.carriesAAndB,
      ROW.carriesAAndBAfter,
      ROW.earliestWithA,
      ROW.carriesAOnly,
      ROW.carriesBOnly,
      ROW.carriesEditableValidation,
      ROW.carriesAOnlyLast
    ];
    const MESSAGE_A_ORDER = [ROW.duplicateErrorMember, ROW.carriesAAndB, ROW.carriesAAndBAfter, ROW.earliestWithA, ROW.carriesAOnly, ROW.carriesAOnlyLast];
    const interleavingRequest = (filters: ErrorExplorerFilters) => queryRequest([FIRST_CENSUS_ID], filters, FIRST_PAGE, SMALL_PAGE_SIZE);

    async function updateExactlyOneRow(description: string, sql: string, params: unknown[]): Promise<void> {
      const [result] = await setupConnection().query<ResultSetHeader>(sql, params);
      console.log(`[interleaving] ${description}: affectedRows=${result.affectedRows}`);
      expect(result.affectedRows, `${description} must change exactly one row, or the interleaving did not happen`).toBe(AFFECTED_ONE_ROW);
    }

    const resolveLog = (measurementID: number, errorID: number) => () =>
      updateExactlyOneRow(
        `resolve error ${errorID} of row ${measurementID}`,
        'UPDATE measurement_error_log SET IsResolved = 1 WHERE MeasurementID = ? AND ErrorID = ?',
        [measurementID, errorID]
      );
    const addUnresolvedLog = (measurementID: number, errorID: number) => () =>
      updateExactlyOneRow(
        `add unresolved error ${errorID} to row ${measurementID}`,
        'INSERT INTO measurement_error_log (MeasurementID, ErrorID, IsResolved) VALUES (?, ?, 0)',
        [measurementID, errorID]
      );
    const editValidationDescription = (validationID: number, description: string) => () =>
      updateExactlyOneRow(`set the description of validation ${validationID}`, 'UPDATE sitespecificvalidations SET Description = ? WHERE ValidationID = ?', [
        description,
        validationID
      ]);
    const deleteSummaryRow = (measurementID: number) => () =>
      updateExactlyOneRow(`delete the summary row of ${measurementID}`, 'DELETE FROM measurementssummary WHERE CoreMeasurementID = ?', [measurementID]);

    async function queryOnFreshFixture(filters: ErrorExplorerFilters) {
      await loadFixture(interleavingFixture());
      const recorder = createRecordingExecutor(explorerConnection());
      const response = await production.queryErrorExplorer(recorder as unknown as ProductionExecutor, interleavingRequest(filters));
      return { response, recorder };
    }

    async function queryWithChangeAfter(filters: ErrorExplorerFilters, statementLabel: string, change: () => Promise<void>) {
      await loadFixture(interleavingFixture());
      const recorder = createRecordingExecutor(explorerConnection());
      recorder.afterStatementOnce(statementLabel, change);
      const response = await production.queryErrorExplorer(recorder as unknown as ProductionExecutor, interleavingRequest(filters));
      return { response, recorder };
    }

    const rowById = (response: ErrorExplorerQueryResponse, measurementID: number) => response.rows.find(row => row.coreMeasurementID === measurementID);

    const SQL_PATH_FOLLOW_UP_LABELS: ReadonlySet<string | null> = new Set([LABELS.idRawRows, LABELS.duplicateMemberGroups, LABELS.sameBatchMemberGroups]);

    function expectOnePageStatementAndOneCatalog(statements: readonly RecordedStatement[]) {
      const labels = statements.map(statement => statement.label);
      console.log(`[interleaving] statement labels: ${JSON.stringify(labels)}`);
      expect(labels[0], 'the catalog is read first').toBe(LABELS.catalog);
      expect(countLabel(statements, LABELS.catalog), 'one catalog statement').toBe(1);
      expect(countLabel(statements, LABELS.page), 'the totals come from the one page statement, never a second one').toBe(1);
      expect(
        labels.slice(2).every(label => SQL_PATH_FOLLOW_UP_LABELS.has(label)),
        'after the page statement only row reads follow'
      ).toBe(true);
    }

    it(
      '(a) a log resolved after the page statement: the row leaves an exact-message result, keeps totalRows, and stays in the default result with the remaining error',
      async () => {
        const messageAFilters = filtersWith({ exactMessages: [MESSAGE.messageA] });
        const controlA = await queryOnFreshFixture(messageAFilters);
        console.log(`[interleaving a] control exact message ids=${JSON.stringify(idsOf(controlA.response.rows))} totalRows=${controlA.response.totalRows}`);
        expect(idsOf(controlA.response.rows), 'control: rows carrying message A in sort order').toEqual(MESSAGE_A_ORDER);
        expect(controlA.response.totalRows).toBe(MESSAGE_A_ORDER.length);

        const changedA = await queryWithChangeAfter(messageAFilters, LABELS.page, resolveLog(ROW.carriesAAndB, ERROR_ID.messageA));
        changedA.recorder.assertAllHooksFired();
        console.log(`[interleaving a] exact message ids=${JSON.stringify(idsOf(changedA.response.rows))} totalRows=${changedA.response.totalRows}`);
        expect(idsOf(changedA.response.rows), 'row 101 no longer shows message A').toEqual(MESSAGE_A_ORDER.filter(id => id !== ROW.carriesAAndB));
        expect(changedA.response.totalRows, 'totalRows is the page statement count from before the change').toBe(MESSAGE_A_ORDER.length);
        expect(changedA.response.totalRows).toEqual(controlA.response.totalRows);
        expectOnePageStatementAndOneCatalog(changedA.recorder.statements);

        const controlDefault = await queryOnFreshFixture(DEFAULT_ERROR_EXPLORER_FILTERS);
        expect(idsOf(controlDefault.response.rows), 'control: default order').toEqual(DEFAULT_ORDER);
        const changedDefault = await queryWithChangeAfter(DEFAULT_ERROR_EXPLORER_FILTERS, LABELS.page, resolveLog(ROW.carriesAAndB, ERROR_ID.messageA));
        changedDefault.recorder.assertAllHooksFired();
        const reread = rowById(changedDefault.response, ROW.carriesAAndB);
        console.log(`[interleaving a] default row 101 errorMessages=${JSON.stringify(reread?.errorMessages)} errorCount=${reread?.errorCount}`);
        expect(idsOf(changedDefault.response.rows)).toEqual(DEFAULT_ORDER);
        expect(reread?.errorMessages, 'only message B remains').toEqual([MESSAGE.messageB]);
        expect(reread?.errorCount).toBe(1);
        expect(changedDefault.response.totalRows).toBe(DEFAULT_ORDER.length);
      },
      FIXTURE_HOOK_TIMEOUT_MS
    );

    it(
      '(b) a validation description edited after the catalog read: the row leaves a result filtered on the old description and keeps totalRows',
      async () => {
        const oldDescriptionFilters = filtersWith({ exactMessages: [MESSAGE.editableValidationOriginal] });
        const control = await queryOnFreshFixture(oldDescriptionFilters);
        expect(idsOf(control.response.rows), 'control: only the row carrying the editable validation').toEqual([ROW.carriesEditableValidation]);
        expect(control.response.totalRows).toBe(1);

        const changed = await queryWithChangeAfter(
          oldDescriptionFilters,
          LABELS.catalog,
          editValidationDescription(INTERLEAVING_VALIDATION_ID, MESSAGE.editableValidationEdited)
        );
        changed.recorder.assertAllHooksFired();
        console.log(`[interleaving b] ids=${JSON.stringify(idsOf(changed.response.rows))} totalRows=${changed.response.totalRows}`);
        expect(changed.response.rows, 'the row now displays the edited description, which the filter does not name').toEqual([]);
        expect(changed.response.totalRows, 'totalRows is the page statement count').toBe(1);
        expectOnePageStatementAndOneCatalog(changed.recorder.statements);

        const defaultFilters = await queryWithChangeAfter(
          DEFAULT_ERROR_EXPLORER_FILTERS,
          LABELS.catalog,
          editValidationDescription(INTERLEAVING_VALIDATION_ID, MESSAGE.editableValidationEdited)
        );
        defaultFilters.recorder.assertAllHooksFired();
        expect(rowById(defaultFilters.response, ROW.carriesEditableValidation)?.errorMessages, 'under default filters the row shows the edited text').toEqual([
          MESSAGE.editableValidationEdited
        ]);
      },
      FIXTURE_HOOK_TIMEOUT_MS
    );

    it(
      '(c) the duplicate mate disappears after the page statement: the row leaves the Contradictions result and shows no contradiction under default filters',
      async () => {
        const control = await queryOnFreshFixture(CONTRADICTIONS_SHOW_FILTERS);
        expect(idsOf(control.response.rows), 'control: the duplicate error member alone').toEqual([ROW.duplicateErrorMember]);
        expect(control.response.totalRows).toBe(1);

        const changed = await queryWithChangeAfter(CONTRADICTIONS_SHOW_FILTERS, LABELS.page, deleteSummaryRow(ROW.duplicateMate));
        changed.recorder.assertAllHooksFired();
        console.log(`[interleaving c] Show contradictions ids=${JSON.stringify(idsOf(changed.response.rows))} totalRows=${changed.response.totalRows}`);
        expect(changed.response.rows, 'the row no longer has a contradiction').toEqual([]);
        expect(changed.response.totalRows).toBe(1);
        expectOnePageStatementAndOneCatalog(changed.recorder.statements);

        const controlDefault = await queryOnFreshFixture(DEFAULT_ERROR_EXPLORER_FILTERS);
        expect(rowById(controlDefault.response, ROW.duplicateErrorMember)?.contradictionTypes, 'control: flagged duplicate').toEqual([DUPLICATE]);
        const changedDefault = await queryWithChangeAfter(DEFAULT_ERROR_EXPLORER_FILTERS, LABELS.page, deleteSummaryRow(ROW.duplicateMate));
        changedDefault.recorder.assertAllHooksFired();
        const reread = rowById(changedDefault.response, ROW.duplicateErrorMember);
        console.log(
          `[interleaving c] default row ${ROW.duplicateErrorMember} hasContradiction=${reread?.hasContradiction} tag=${INTERLEAVING_DUPLICATE_TREE_TAG}`
        );
        expect(idsOf(changedDefault.response.rows), 'the row keeps its selected position').toEqual(DEFAULT_ORDER);
        expect(reread?.hasContradiction).toBe(false);
        expect(reread?.contradictionTypes).toEqual([]);
        expect(reread?.relatedMeasurementIDs).toEqual([]);
        expect(changedDefault.response.totalRows).toBe(DEFAULT_ORDER.length);
        expect(changedDefault.response.totalRows, 'totalRows is the page statement count from before the change').toEqual(controlDefault.response.totalRows);
      },
      FIXTURE_HOOK_TIMEOUT_MS
    );

    it(
      '(d) a second error added after the page statement: the row keeps its selected index and shows both errors, and totalRows does not change',
      async () => {
        const control = await queryOnFreshFixture(DEFAULT_ERROR_EXPLORER_FILTERS);
        const selectedIndex = idsOf(control.response.rows).indexOf(ROW.earliestWithA);
        expect(idsOf(control.response.rows), 'control: default order').toEqual(DEFAULT_ORDER);

        const changed = await queryWithChangeAfter(DEFAULT_ERROR_EXPLORER_FILTERS, LABELS.page, addUnresolvedLog(ROW.earliestWithA, ERROR_ID.messageC));
        changed.recorder.assertAllHooksFired();
        const reread = rowById(changed.response, ROW.earliestWithA);
        console.log(
          `[interleaving d] ids=${JSON.stringify(idsOf(changed.response.rows))} row ${ROW.earliestWithA} messages=${JSON.stringify(reread?.errorMessages)}`
        );
        expect(idsOf(changed.response.rows).indexOf(ROW.earliestWithA), 'selected index').toBe(selectedIndex);
        expect(idsOf(changed.response.rows)).toEqual(DEFAULT_ORDER);
        expect(reread?.errorMessages).toEqual([MESSAGE.messageA, MESSAGE.messageC]);
        expect(reread?.errorCount).toBe(2);
        expect(changed.response.totalRows).toBe(control.response.totalRows);
        expectOnePageStatementAndOneCatalog(changed.recorder.statements);

        const afterwards = await production.queryErrorExplorer(
          plainExecutor() as unknown as ProductionExecutor,
          interleavingRequest(DEFAULT_ERROR_EXPLORER_FILTERS)
        );
        console.log(`[interleaving d] a fresh query on the changed data orders ${JSON.stringify(idsOf(afterwards.rows))}`);
        expect(
          idsOf(afterwards.rows).indexOf(ROW.earliestWithA),
          'a fresh sort moves the row ahead, so the case does tell the selected order apart'
        ).toBeLessThan(selectedIndex);
      },
      FIXTURE_HOOK_TIMEOUT_MS
    );
  });

  describe(`census chunks: ${MANY_CENSUS_COUNT} physical censuses in chunks of ${EXPECTED_CHUNK_SIZES.join(', ')}`, () => {
    const MESSAGE_FILTERS = filtersWith({ exactMessages: [FIXTURE_MESSAGES.shared] });
    const SQL_PATH_FILTERS: ReadonlyArray<{ name: string; filters: ErrorExplorerFilters }> = [
      { name: 'default filters', filters: DEFAULT_ERROR_EXPLORER_FILTERS },
      { name: 'Show contradictions', filters: CONTRADICTIONS_SHOW_FILTERS },
      { name: 'message filter', filters: MESSAGE_FILTERS }
    ];
    const SEARCHES = [MANY_CENSUS_TREE_TAG_SEARCH, FIXTURE_MESSAGES.tagMismatchLowerCase];

    beforeAll(async () => {
      await loadFixture(manyCensusesFixture());
    }, FIXTURE_HOOK_TIMEOUT_MS);

    const request = (filters: ErrorExplorerFilters, page: number, pageSize: number) => queryRequest(MANY_CENSUS_IDS, filters, page, pageSize);
    const compare = (context: Record<string, unknown>, actual: unknown, expected: unknown) =>
      expectExplorerEqual(explorerConnection(), context, actual, expected);

    async function expectChunkedQueryPages(censusIDs: readonly number[], chunkCount: number, minimumTotalRows: number): Promise<void> {
      for (const { name, filters } of SQL_PATH_FILTERS) {
        const whole = await oracle.queryErrorExplorer(oracleExecutor(), queryRequest(censusIDs, filters, FIRST_PAGE, WHOLE_LIST_PAGE_SIZE));
        console.log(
          `[chunks] ${name} over ${censusIDs.length} censuses: oracle totalRows=${whole.totalRows} flagged=${whole.rows.filter(row => row.hasContradiction).length}`
        );
        expect(whole.totalRows, `${name} must select rows, or the case proves nothing`).toBeGreaterThan(minimumTotalRows);
        for (const pageSize of CHUNK_PAGE_SIZES) {
          for (const page of [...pagesIncludingOnePastTheEnd(whole.totalRows, pageSize), ...IRREGULAR_PAGES]) {
            const recorder = createRecordingExecutor(explorerConnection());
            const actual = await production.queryErrorExplorer(recorder as unknown as ProductionExecutor, queryRequest(censusIDs, filters, page, pageSize));
            await compare({ scenario: 'chunked query', filters: name, page, pageSize }, actual, sliceWholeList(whole, page, pageSize));

            const bounds = toSliceBounds(page, pageSize);
            const labels = recorder.statements.map(statement => statement.label);
            const pageStatements = recorder.statements.filter(statement => statement.label === LABELS.page);
            const chunksOfPageRows = new Set(actual.rows.map(row => censusChunkIndex(Number(row.censusID))));
            console.log(
              `[chunks] ${name} size=${pageSize} page=${page} rows=${actual.rows.length} pageStatementRows=${JSON.stringify(pageStatements.map(statement => statement.rows))} ` +
                `windows=${JSON.stringify(pageStatements.map(statement => statement.params.slice(-PAGE_WINDOW_PARAM_COUNT)))} totals=${countLabel(recorder.statements, LABELS.totals)} pageRowChunks=${[...chunksOfPageRows].join(',')}`
            );
            expect(countLabel(recorder.statements, LABELS.catalog), `${name} page ${page}: catalog statements`).toBe(1);
            if (bounds.limit === 0) {
              expect(pageStatements, `${name} page ${page}: a page that selects nothing sends no page statement`).toHaveLength(0);
              expect(countLabel(recorder.statements, LABELS.totals), `${name} page ${page}: one totals statement per chunk`).toBe(chunkCount);
              expect(countLabel(recorder.statements, LABELS.idRawRows)).toBe(0);
              expect(countLabel(recorder.statements, LABELS.duplicateMemberGroups)).toBe(0);
              expect(countLabel(recorder.statements, LABELS.sameBatchMemberGroups)).toBe(0);
              continue;
            }
            expect(pageStatements, `${name} page ${page}: one page statement per chunk`).toHaveLength(chunkCount);
            expect(labels, `${name} page ${page}: no totals statement when the page statements answer`).not.toContain(LABELS.totals);
            const prefixWindow = [String(bounds.offset + bounds.limit), '0'];
            pageStatements.forEach(statement =>
              expect(statement.params.slice(-PAGE_WINDOW_PARAM_COUNT), `${name} page ${page}: every chunk reads the first offset+limit rows`).toEqual(
                prefixWindow
              )
            );
            expect(countLabel(recorder.statements, LABELS.idRawRows), `${name} page ${page}: one raw-rows statement per chunk holding a page row`).toBe(
              chunksOfPageRows.size
            );
            expect(countLabel(recorder.statements, LABELS.duplicateMemberGroups)).toBe(chunksOfPageRows.size);
            expect(countLabel(recorder.statements, LABELS.sameBatchMemberGroups)).toBe(chunksOfPageRows.size);
          }
        }
      }
    }

    it(
      'query without a search: every page at sizes 10 and 25, one past the end and the NaN, 1.5 and Infinity pages equal the oracle, reading one catalog and one page statement per chunk',
      async () => {
        expect(MANY_CENSUS_IDS.length).toBe(MANY_CENSUS_COUNT);
        await expectChunkedQueryPages(MANY_CENSUS_IDS, EXPECTED_CHUNK_SIZES.length, CENSUS_LIST_SIZE * 2);
      },
      SLOW_CASE_TIMEOUT_MS
    );

    it(
      'a chunk with no matching rows adds nothing to the page or the totals and needs no totals statement',
      async () => {
        expect(MANY_CENSUS_IDS, 'the absent census is not one of the fixture censuses').not.toContain(ABSENT_CENSUS_ID);
        await expectChunkedQueryPages(SPARSE_CHUNK_CENSUS_IDS, SPARSE_CHUNK_COUNT, 0);
        const recorder = createRecordingExecutor(explorerConnection());
        await production.queryErrorExplorer(
          recorder as unknown as ProductionExecutor,
          queryRequest(SPARSE_CHUNK_CENSUS_IDS, DEFAULT_ERROR_EXPLORER_FILTERS, FIRST_PAGE, SMALL_PAGE_SIZE)
        );
        const pageStatementRows = recorder.statements.filter(statement => statement.label === LABELS.page).map(statement => statement.rows);
        console.log(`[chunks] sparse scope page statement rows per chunk: ${JSON.stringify(pageStatementRows)}`);
        expect(pageStatementRows[0], 'the populated chunk returns rows').toBeGreaterThan(0);
        expect(pageStatementRows[1], 'the chunk holding only the absent census returns none').toBe(0);
      },
      SLOW_CASE_TIMEOUT_MS
    );

    it(
      'facets, message counts and quick search equal the oracle',
      async () => {
        for (const { name, filters } of SQL_PATH_FILTERS) {
          const facetRequest = { schema: database(), plotID: MAIN_PLOT_ID, censusID: FIRST_CENSUS_ID, censusIDs: [...MANY_CENSUS_IDS], filters };
          const expected = await oracle.buildErrorExplorerFacets(oracleExecutor(), facetRequest);
          const actual = await production.buildErrorExplorerFacets(plainExecutor() as unknown as ProductionExecutor, facetRequest);
          await compare({ scenario: 'chunked facets', filters: name }, actual, expected);
          expect(actual.censusTotals.affectedMeasurements, `${name}: facets must cover the chunks`).toBeGreaterThan(0);
          expect(actual.errorTypes.length, `${name}: the filter must leave error types to compare`).toBeGreaterThan(0);
        }

        const countsRequest = { schema: database(), plotID: MAIN_PLOT_ID, censusIDs: [...MANY_CENSUS_IDS] };
        const expectedCounts = await oracle.buildErrorMessageCounts(oracleExecutor(), countsRequest);
        const actualCounts = await production.buildErrorMessageCounts(plainExecutor() as unknown as ProductionExecutor, countsRequest);
        await compare({ scenario: 'chunked message counts' }, actualCounts, expectedCounts);
        expect(actualCounts.totalMeasurements).toBeGreaterThan(0);

        for (const quickSearch of SEARCHES) {
          const searchFilters = filtersWith({ quickSearch });
          const whole = await oracle.queryErrorExplorer(oracleExecutor(), request(searchFilters, FIRST_PAGE, WHOLE_LIST_PAGE_SIZE));
          expect(whole.totalRows, `search "${quickSearch}" must select rows`).toBeGreaterThan(0);
          for (const pageSize of CHUNK_PAGE_SIZES) {
            for (const page of pagesIncludingOnePastTheEnd(whole.totalRows, pageSize)) {
              const recorder = createRecordingExecutor(explorerConnection());
              const actual = await production.queryErrorExplorer(recorder as unknown as ProductionExecutor, request(searchFilters, page, pageSize));
              await compare({ scenario: 'chunked quick search', quickSearch, page, pageSize }, actual, sliceWholeList(whole, page, pageSize));
              expect(countLabel(recorder.statements, LABELS.page), `quick search "${quickSearch}" stays on the Node path`).toBe(0);
              expect(countLabel(recorder.statements, LABELS.scopeRawRows), 'one scope raw-rows statement per chunk').toBe(EXPECTED_CHUNK_SIZES.length);
            }
          }
        }
      },
      SLOW_CASE_TIMEOUT_MS
    );

    it(
      'details for rows of the first, middle and last chunks equal the oracle, for every active contradiction type',
      async () => {
        const censusesToCheck = [1, CENSUS_LIST_SIZE, CENSUS_LIST_SIZE + 1, 2 * CENSUS_LIST_SIZE + 1, MANY_CENSUS_COUNT - 1, MANY_CENSUS_COUNT];
        const rowOffsets = [
          MANY_CENSUS_ROW_OFFSET.duplicateFirst,
          MANY_CENSUS_ROW_OFFSET.sameBatchFirst,
          MANY_CENSUS_ROW_OFFSET.sharedMessageFirst,
          MANY_CENSUS_ROW_OFFSET.sqlExceptionAndSharedMessageSecond,
          MANY_CENSUS_ROW_OFFSET.duplicateNonErrorMate,
          MANY_CENSUS_ROW_OFFSET.failed
        ];
        const activeTypes: Array<ContradictionType | undefined> = [undefined, DUPLICATE, SAME_BATCH];
        for (const censusID of censusesToCheck) {
          for (const offset of rowOffsets) {
            const measurementID = censusID * MANY_CENSUS_ROW_ID_BLOCK + offset;
            for (const activeType of activeTypes) {
              const detailsRequest = { schema: database(), plotID: MAIN_PLOT_ID, censusID };
              const expected = await oracle.buildErrorExplorerDetails(oracleExecutor(), detailsRequest, measurementID, activeType);
              const actual = await production.buildErrorExplorerDetails(
                plainExecutor() as unknown as ProductionExecutor,
                detailsRequest,
                measurementID,
                activeType
              );
              await compare({ scenario: 'chunked details', censusID, measurementID, activeContradictionType: activeType ?? null }, actual, expected);
            }
          }
        }
      },
      SLOW_CASE_TIMEOUT_MS
    );
  });

  describe(`large group: ${LARGE_GROUP_MEMBER_COUNT} members, ${LARGE_GROUP_ERROR_SET_COUNT} in the error set`, () => {
    const LARGE_GROUP_ROW_COUNT = LARGE_GROUP_ERROR_SET_COUNT + LARGE_GROUP_SOLO_ROW_IDS.length;
    const request = (page: number, pageSize: number) => queryRequest([FIRST_CENSUS_ID], DEFAULT_ERROR_EXPLORER_FILTERS, page, pageSize);

    beforeAll(async () => {
      await loadFixture(largeGroupFixture());
    }, FIXTURE_HOOK_TIMEOUT_MS);

    /** Runs the production executor and keeps the rows of the member-group statements, which RecordedStatement does not hold. */
    function executorKeepingMemberGroups() {
      const recorder = createRecordingExecutor(explorerConnection());
      const memberGroupStatements: Array<{ label: string; rows: MemberGroupRow[] }> = [];
      const executor = {
        executeQuery: async (sql: string, params: unknown[] = []) => {
          const rows = await recorder.executeQuery(sql, params);
          const label = readStatementLabel(sql);
          if (label === LABELS.duplicateMemberGroups || label === LABELS.sameBatchMemberGroups)
            memberGroupStatements.push({ label, rows: rows as MemberGroupRow[] });
          return rows;
        }
      };
      return { executor: executor as unknown as ProductionExecutor, recorder, memberGroupStatements };
    }

    const memberListBytes = (statements: ReturnType<typeof executorKeepingMemberGroups>['memberGroupStatements']) =>
      statements.flatMap(statement => statement.rows).reduce((total, row) => total + Buffer.byteLength(row.MeasurementIDs ?? ''), 0);

    async function readSessionGroupConcatLimit(): Promise<number> {
      const [rows] = await explorerConnection().query('SELECT @@session.group_concat_max_len AS limitBytes');
      return Number((rows as Array<{ limitBytes: number | string }>)[0].limitBytes);
    }

    function forgetMemberGroupStatements(recorded: readonly Pick<RecordedStatement, 'sql'>[] = []): void {
      const scope = { schema: database(), plotID: MAIN_PLOT_ID, censusIDs: [FIRST_CENSUS_ID] };
      const texts = [
        buildDuplicateMemberGroupsStatement(scope, [1]).sql,
        buildSameBatchMemberGroupsStatement(scope, [1]).sql,
        ...recorded.map(statement => statement.sql)
      ];
      texts.forEach(sql => explorerConnection().unprepare(sql));
    }

    it(
      'every query page equals the oracle; member-group statements return at most one row per requested row; the related-ID builder runs once per requested row and group; member-list bytes stay within the bound',
      async () => {
        const whole = await oracle.queryErrorExplorer(oracleExecutor(), request(FIRST_PAGE, WHOLE_LIST_PAGE_SIZE));
        expect(whole.totalRows).toBe(LARGE_GROUP_ROW_COUNT);
        const sessionLimit = await readSessionGroupConcatLimit();
        expect(sessionLimit, 'the fixture connection carries the equivalence limit').toBe(EQUIVALENCE_GROUP_CONCAT_MAX_LEN);
        const spy = vi.mocked(buildRelatedMeasurementIDs);
        let largestRelatedList = 0;
        for (const page of pagesIncludingOnePastTheEnd(whole.totalRows, LARGE_PAGE_SIZE)) {
          const { executor, recorder, memberGroupStatements } = executorKeepingMemberGroups();
          const callsBefore = spy.mock.calls.length;
          const actual = await production.queryErrorExplorer(executor, request(page, LARGE_PAGE_SIZE));
          const expected = sliceWholeList(whole, page, LARGE_PAGE_SIZE);
          await expectExplorerEqual(explorerConnection(), { scenario: 'large group query', page, pageSize: LARGE_PAGE_SIZE }, actual, expected);

          const requestedRows = expected.rows.length;
          const flaggedRowIDs = expected.rows.filter(row => row.hasContradiction).map(row => Number(row.coreMeasurementID));
          const builderCalls = spy.mock.calls.slice(callsBefore);
          const rowsPerStatement = memberGroupStatements.map(statement => ({ label: statement.label, rows: statement.rows.length }));
          const bytes = memberListBytes(memberGroupStatements);
          largestRelatedList = Math.max(largestRelatedList, ...actual.rows.map(row => row.relatedMeasurementIDs.length));
          console.log(
            `[large group] page=${page} requested=${requestedRows} flagged=${flaggedRowIDs.length} builderCalls=${builderCalls.length} ` +
              `memberGroupRows=${JSON.stringify(rowsPerStatement)} memberListBytes=${bytes} bound=${requestedRows * MEMBER_GROUP_KINDS_PER_ROW * sessionLimit}`
          );

          rowsPerStatement.forEach(statement =>
            expect(statement.rows, `page ${page}: ${statement.label} rows per requested row (this fixture has one group kind)`).toBeLessThanOrEqual(
              requestedRows
            )
          );
          expect(
            memberGroupStatements.flatMap(statement => statement.rows).length,
            `page ${page}: member-group rows over both kinds, at most two per requested row`
          ).toBeLessThanOrEqual(requestedRows * MEMBER_GROUP_KINDS_PER_ROW);
          expect(
            memberGroupStatements.find(statement => statement.label === LABELS.sameBatchMemberGroups)?.rows ?? [],
            'no same-batch group in this fixture'
          ).toEqual([]);
          expect(builderCalls.length, `page ${page}: one buildRelatedMeasurementIDs call per (requested row, group)`).toBe(flaggedRowIDs.length);
          expect(
            builderCalls.map(call => call[2]).sort((a, b) => a - b),
            `page ${page}: the calls name exactly the flagged requested rows`
          ).toEqual([...flaggedRowIDs].sort((a, b) => a - b));
          expect(bytes, `page ${page}: member-list bytes against requested rows x 2 x the session limit`).toBeLessThanOrEqual(
            requestedRows * MEMBER_GROUP_KINDS_PER_ROW * sessionLimit
          );
          expect(countLabel(recorder.statements, LABELS.idRawRows), `page ${page}: one raw-rows statement for the 128-ID slot`).toBe(requestedRows > 0 ? 1 : 0);
          expect(requestedRows).toBeLessThanOrEqual(ID_LIST_SIZE);
        }
        expect(largestRelatedList, 'rows carry the whole group as related IDs').toBe(LARGE_GROUP_MEMBER_COUNT - 1);
      },
      SLOW_CASE_TIMEOUT_MS
    );

    it(
      'a member list cut by group_concat_max_len stays within the limit per row, is marked incomplete, and yields only whole member IDs',
      async () => {
        const fullList = Array.from({ length: LARGE_GROUP_MEMBER_COUNT }, (_, index) => index + 1).join(LIST_SEPARATOR);
        const wholeTokensOfCutList = fullList.slice(0, SHORT_MEMBER_LIST_LIMIT_BYTES).split(LIST_SEPARATOR).slice(0, -1).map(Number);
        forgetMemberGroupStatements();
        await setGroupConcatMaxLen(explorerConnection(), SHORT_MEMBER_LIST_LIMIT_BYTES);
        const { executor, recorder, memberGroupStatements } = executorKeepingMemberGroups();
        try {
          const actual = await production.queryErrorExplorer(executor, request(FIRST_PAGE, LARGE_PAGE_SIZE));
          const duplicateRows = memberGroupStatements
            .filter(statement => statement.label === LABELS.duplicateMemberGroups)
            .flatMap(statement => statement.rows);
          console.log(
            `[large group] limit=${SHORT_MEMBER_LIST_LIMIT_BYTES} requested=${actual.rows.length} memberGroupRows=${duplicateRows.length} ` +
              `listBytes=${JSON.stringify(duplicateRows.map(row => Buffer.byteLength(row.MeasurementIDs ?? '')))} wholeTokens=${wholeTokensOfCutList.length}`
          );
          expect(countLabel(recorder.statements, LABELS.page), 'the cut is read through the SQL page statement').toBe(1);
          expect(duplicateRows).toHaveLength(actual.rows.length);
          duplicateRows.forEach(row => {
            expect(Buffer.byteLength(row.MeasurementIDs ?? ''), 'list bytes').toBeLessThanOrEqual(SHORT_MEMBER_LIST_LIMIT_BYTES);
            expect(Number(row.MemberListComplete), 'the cut is detected').toBe(0);
            expect(Number(row.MemberCount), 'the member count is not cut').toBe(LARGE_GROUP_MEMBER_COUNT);
          });
          actual.rows.forEach(row => {
            expect(row.hasContradiction, `row ${row.coreMeasurementID} stays flagged`).toBe(true);
            expect(row.relatedMeasurementIDs, `row ${row.coreMeasurementID} related IDs are the whole tokens of the cut list`).toEqual(
              wholeTokensOfCutList.filter(id => id !== row.coreMeasurementID)
            );
          });
        } finally {
          forgetMemberGroupStatements(recorder.statements);
          await setGroupConcatMaxLen(explorerConnection(), EQUIVALENCE_GROUP_CONCAT_MAX_LEN);
        }
      },
      FIXTURE_HOOK_TIMEOUT_MS
    );

    it(
      'details for a first, middle, last and solo error row and a non-error member equal the oracle, reading 3 statements plus one per 128 related IDs',
      async () => {
        expect(LARGE_GROUP_ERROR_MEMBER_IDS, 'the derived error members match the fixture count').toHaveLength(LARGE_GROUP_ERROR_SET_COUNT);
        const memberIDs = [
          LARGE_GROUP_ERROR_MEMBER_IDS[0],
          LARGE_GROUP_ERROR_MEMBER_IDS[Math.floor(LARGE_GROUP_ERROR_MEMBER_IDS.length / 2)],
          LARGE_GROUP_ERROR_MEMBER_IDS[LARGE_GROUP_ERROR_MEMBER_IDS.length - 1],
          LARGE_GROUP_SOLO_ROW_IDS[0],
          LARGE_GROUP_FIRST_NON_ERROR_MEMBER_ID
        ];
        const detailsRequest = { schema: database(), plotID: MAIN_PLOT_ID, censusID: FIRST_CENSUS_ID };
        for (const measurementID of memberIDs) {
          for (const activeType of [undefined, DUPLICATE]) {
            const expected = await oracle.buildErrorExplorerDetails(oracleExecutor(), detailsRequest, measurementID, activeType);
            const recorder = createRecordingExecutor(explorerConnection());
            const actual = await production.buildErrorExplorerDetails(recorder as unknown as ProductionExecutor, detailsRequest, measurementID, activeType);
            await expectExplorerEqual(
              explorerConnection(),
              { scenario: 'large group details', measurementID, activeContradictionType: activeType ?? null },
              actual,
              expected
            );
            const relatedCount = expected.row?.relatedMeasurementIDs.length ?? 0;
            console.log(`[large group] details ${measurementID} type=${activeType ?? null} related=${relatedCount} statements=${recorder.statements.length}`);
            expect(recorder.statements.length, `details ${measurementID}: statements`).toBe(
              DETAILS_FIXED_STATEMENT_COUNT + Math.ceil(relatedCount / ID_LIST_SIZE)
            );
          }
        }
      },
      SLOW_CASE_TIMEOUT_MS
    );
  });
});
