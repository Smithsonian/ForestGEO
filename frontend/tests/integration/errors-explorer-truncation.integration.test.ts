import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_ERROR_EXPLORER_FILTERS,
  ERROR_EXPLORER_PRESETS,
  type ErrorExplorerDetailsResponse,
  type ErrorExplorerFacetsResponse,
  type ErrorExplorerFilters,
  type ErrorExplorerQueryResponse
} from '@/config/errorsexplorer';
import * as production from '@/app/api/errors/explorer/_shared';
import {
  buildDuplicateMemberGroupsStatement,
  ERROR_EXPLORER_STATEMENT_LABELS,
  SQL_FALSE,
  SQL_TRUE,
  type DuplicateMemberGroupRow
} from '@/app/api/errors/explorer/errorsetsql';
import { DEFAULT_TEST_CONFIG } from '../setup/local-db-setup';
import { runQueryDispatch } from '../setup/runquerydispatch';
import {
  assertLocalOrRefuse,
  createFixtureDatabaseSession,
  createRecordingExecutor,
  EQUIVALENCE_GROUP_CONCAT_MAX_LEN,
  FIRST_CENSUS_ID,
  FIXTURE_HOOK_TIMEOUT_MS,
  groupConcatTruncationFixture,
  MAIN_PLOT_ID,
  replaceFixture,
  setGroupConcatMaxLen,
  TRUNCATION_DUPLICATE_MEMBER_IDS,
  TRUNCATION_LIMITS,
  TRUNCATION_UNRELATED_ERROR_ROW_ID,
  type FixtureDatabase,
  type RecordedStatement
} from './helpers/errorsexplorerfixtures';

vi.mock('@/ailogger', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

const TRUNCATION_DATABASE = `${DEFAULT_TEST_CONFIG.database}_errtrunc`;
const PAGE_SIZE = 25;
const FIRST_PAGE = 0;
const WHOLE_MEMBER_LIST = TRUNCATION_DUPLICATE_MEMBER_IDS.join(',');
const NO_SIGNATURE_WARNINGS: unknown[] = [];
const CONTRADICTIONS_PRESET_ID = 'contradictions';
const DETAILS_FIXED_STATEMENT_COUNT = 3;
const RELATED_ID_CHUNK_SIZE = 128;
const NON_POSITIVE_OR_FRACTIONAL_IDS = [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 2];

const QUERY_ORDER_ALL_ERRORS = [...TRUNCATION_DUPLICATE_MEMBER_IDS, TRUNCATION_UNRELATED_ERROR_ROW_ID];

const MEMBER_LIST_COMPLETE_BY_LIMIT: Record<number, number> = {
  [TRUNCATION_LIMITS.whole]: SQL_TRUE,
  [TRUNCATION_LIMITS.cutInsideThirdID]: SQL_FALSE,
  [TRUNCATION_LIMITS.cutAtSeparator]: SQL_FALSE,
  [TRUNCATION_LIMITS.cutInsideSecondID]: SQL_FALSE
};
/** Hand-written from the whole-token rule (spec §4, D4): a cut list keeps only the tokens a separator follows. The list is "1001,1002,1003" cut to the limit. */
const RELATED_SUPERSET_BY_LIMIT: Record<number, number[]> = {
  [TRUNCATION_LIMITS.whole]: [1001, 1002, 1003],
  [TRUNCATION_LIMITS.cutInsideThirdID]: [1001, 1002],
  [TRUNCATION_LIMITS.cutAtSeparator]: [1001, 1002],
  [TRUNCATION_LIMITS.cutInsideSecondID]: [1001]
};
const LIMITS = Object.values(TRUNCATION_LIMITS);

const CONTRADICTIONS_PRESET_FILTERS: ErrorExplorerFilters = (() => {
  const preset = ERROR_EXPLORER_PRESETS.find(candidate => candidate.id === CONTRADICTIONS_PRESET_ID);
  if (!preset) throw new Error(`The preset ${CONTRADICTIONS_PRESET_ID} no longer exists`);
  return { ...preset.filters, presetId: preset.id };
})();

type ProductionExecutor = Parameters<typeof production.queryErrorExplorer>[0];

interface LimitRun {
  defaultQuery: ErrorExplorerQueryResponse;
  defaultQueryLabels: Array<string | null>;
  presetQuery: ErrorExplorerQueryResponse;
  facets: ErrorExplorerFacetsResponse;
  detailsByMeasurementID: Map<number, ErrorExplorerDetailsResponse>;
  detailsStatementCountByMeasurementID: Map<number, number>;
  memberGroupRow: DuplicateMemberGroupRow;
}

describe('errors explorer: GROUP_CONCAT truncation of member lists (#544, D4)', () => {
  let fixtureDatabase: FixtureDatabase | null = null;
  const fixtureSession = createFixtureDatabaseSession(TRUNCATION_DATABASE);

  const database = () => (fixtureDatabase as FixtureDatabase).database;
  const explorerConnection = () => (fixtureDatabase as FixtureDatabase).explorerConnection;
  const requestScope = () => ({ schema: database(), plotID: MAIN_PLOT_ID, censusID: FIRST_CENSUS_ID, censusIDs: [FIRST_CENSUS_ID] });
  const queryRequest = (filters: ErrorExplorerFilters) => ({ ...requestScope(), page: FIRST_PAGE, pageSize: PAGE_SIZE, filters });

  /**
   * mysql2 caches a prepared statement per SQL text, and MySQL fixes group_concat_max_len when the statement is prepared. Every statement a
   * run used is dropped from the cache afterwards, or the next limit would silently keep this one.
   */
  function forgetPreparedStatements(statements: readonly Pick<RecordedStatement, 'sql'>[]): void {
    statements.forEach(statement => explorerConnection().unprepare(statement.sql));
  }

  async function runWithLimit<Result>(limit: number, run: (executor: ProductionExecutor, recorded: RecordedStatement[]) => Promise<Result>): Promise<Result> {
    const recorder = createRecordingExecutor(explorerConnection());
    await setGroupConcatMaxLen(explorerConnection(), limit);
    try {
      return await run(recorder as unknown as ProductionExecutor, recorder.statements);
    } finally {
      forgetPreparedStatements(recorder.statements);
      await setGroupConcatMaxLen(explorerConnection(), EQUIVALENCE_GROUP_CONCAT_MAX_LEN);
    }
  }

  async function readDuplicateMemberGroupRow(limit: number): Promise<DuplicateMemberGroupRow> {
    const statement = buildDuplicateMemberGroupsStatement({ schema: database(), plotID: MAIN_PLOT_ID, censusIDs: [FIRST_CENSUS_ID] }, [
      TRUNCATION_DUPLICATE_MEMBER_IDS[0]
    ]);
    await setGroupConcatMaxLen(explorerConnection(), limit);
    try {
      const rows = (await runQueryDispatch(explorerConnection(), statement.sql, statement.params)) as DuplicateMemberGroupRow[];
      expect(rows, 'one duplicate group for the requested member').toHaveLength(1);
      return rows[0];
    } finally {
      forgetPreparedStatements([statement]);
      await setGroupConcatMaxLen(explorerConnection(), EQUIVALENCE_GROUP_CONCAT_MAX_LEN);
    }
  }

  async function runAtLimit(limit: number): Promise<LimitRun> {
    const memberGroupRow = await readDuplicateMemberGroupRow(limit);
    const defaultQueryRun = await runWithLimit(limit, async (executor, recorded) => ({
      response: await production.queryErrorExplorer(executor, queryRequest(DEFAULT_ERROR_EXPLORER_FILTERS)),
      labels: recorded.map(statement => statement.label)
    }));
    const presetQuery = await runWithLimit(limit, executor => production.queryErrorExplorer(executor, queryRequest(CONTRADICTIONS_PRESET_FILTERS)));
    const facets = await runWithLimit(limit, executor =>
      production.buildErrorExplorerFacets(executor, { ...requestScope(), filters: DEFAULT_ERROR_EXPLORER_FILTERS })
    );
    const detailsByMeasurementID = new Map<number, ErrorExplorerDetailsResponse>();
    const detailsStatementCountByMeasurementID = new Map<number, number>();
    for (const measurementID of TRUNCATION_DUPLICATE_MEMBER_IDS) {
      await runWithLimit(limit, async (executor, recorded) => {
        detailsByMeasurementID.set(measurementID, await production.buildErrorExplorerDetails(executor, requestScope(), measurementID));
        detailsStatementCountByMeasurementID.set(measurementID, recorded.length);
      });
    }
    console.log(
      `[truncation] limit=${limit} memberGroup=${JSON.stringify({ list: memberGroupRow.MeasurementIDs, complete: memberGroupRow.MemberListComplete })} ` +
        `defaultQuery=${JSON.stringify(defaultQueryRun.response.rows.map(row => ({ id: row.coreMeasurementID, flagged: row.hasContradiction, related: row.relatedMeasurementIDs })))} ` +
        `presetIDs=${JSON.stringify(presetQuery.rows.map(row => row.coreMeasurementID))} facets=${JSON.stringify(facets.contradictionCounts)} ` +
        `detailsRelated=${JSON.stringify([...detailsByMeasurementID].map(([id, details]) => [id, details.row?.relatedMeasurementIDs, details.relatedRows.map(row => row.coreMeasurementID)]))}`
    );
    return {
      defaultQuery: defaultQueryRun.response,
      defaultQueryLabels: defaultQueryRun.labels,
      presetQuery,
      facets,
      detailsByMeasurementID,
      detailsStatementCountByMeasurementID,
      memberGroupRow
    };
  }

  const expectedRelated = (limit: number, measurementID: number) => RELATED_SUPERSET_BY_LIMIT[limit].filter(id => id !== measurementID);
  const rowById = (response: ErrorExplorerQueryResponse, measurementID: number) => response.rows.find(row => row.coreMeasurementID === measurementID);

  beforeAll(async () => {
    assertLocalOrRefuse();
    fixtureDatabase = await fixtureSession.open();
    await replaceFixture((fixtureDatabase as FixtureDatabase).setupConnection, groupConcatTruncationFixture());
  }, FIXTURE_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    fixtureDatabase = null;
    await fixtureSession.close();
  }, FIXTURE_HOOK_TIMEOUT_MS);

  describe.each(LIMITS)('group_concat_max_len = %i', limit => {
    let run: LimitRun;

    beforeAll(async () => {
      run = await runAtLimit(limit);
    }, FIXTURE_HOOK_TIMEOUT_MS);

    it('really cuts the member list at this limit: a stale prepared statement would show the whole list and fail here', () => {
      expect(run.memberGroupRow.MeasurementIDs, `the list is the whole list cut to ${limit} characters`).toBe(WHOLE_MEMBER_LIST.slice(0, limit));
      expect(Number(run.memberGroupRow.MemberListComplete)).toBe(MEMBER_LIST_COMPLETE_BY_LIMIT[limit]);
      expect(Number(run.memberGroupRow.MemberCount), 'the member count is not cut: HAVING and COUNT do not read the list').toBe(
        TRUNCATION_DUPLICATE_MEMBER_IDS.length
      );
    });

    it('default query returns the three group members, then the unrelated row, with only the members flagged', () => {
      expect(run.defaultQuery.rows.map(row => row.coreMeasurementID)).toEqual(QUERY_ORDER_ALL_ERRORS);
      expect(run.defaultQuery.rows.map(row => row.hasContradiction)).toEqual([true, true, true, false]);
      expect(run.defaultQuery.totalRows).toBe(QUERY_ORDER_ALL_ERRORS.length);
      expect(run.defaultQuery.summary.duplicateTagStem).toBe(TRUNCATION_DUPLICATE_MEMBER_IDS.length);
      expect(run.defaultQuery.summary.contradictions).toBe(TRUNCATION_DUPLICATE_MEMBER_IDS.length);
      expect(rowById(run.defaultQuery, TRUNCATION_UNRELATED_ERROR_ROW_ID)?.contradictionTypes).toEqual([]);
    });

    it('default query reads one scope raw-rows statement and the two member-group statements, and no id raw-rows statement', () => {
      expect([...run.defaultQueryLabels].sort()).toEqual(
        [
          ERROR_EXPLORER_STATEMENT_LABELS.scopeRawRows,
          ERROR_EXPLORER_STATEMENT_LABELS.duplicateMemberGroups,
          ERROR_EXPLORER_STATEMENT_LABELS.sameBatchMemberGroups
        ].sort()
      );
    });

    it('the Contradictions preset returns exactly the three members', () => {
      expect(run.presetQuery.rows.map(row => row.coreMeasurementID)).toEqual([...TRUNCATION_DUPLICATE_MEMBER_IDS]);
      expect(run.presetQuery.totalRows).toBe(TRUNCATION_DUPLICATE_MEMBER_IDS.length);
      expect(run.presetQuery.rows.every(row => row.hasContradiction)).toBe(true);
    });

    it('facets count all three members as duplicates', () => {
      expect(run.facets.contradictionCounts.duplicateTagStem).toBe(TRUNCATION_DUPLICATE_MEMBER_IDS.length);
      expect(run.facets.contradictionCounts.sameBatchConflict).toBe(0);
      expect(run.facets.totalMeasurements).toBe(QUERY_ORDER_ALL_ERRORS.length);
    });

    it.each(TRUNCATION_DUPLICATE_MEMBER_IDS.map(id => [id]))('member %i is flagged and its related IDs are whole tokens of the cut list', measurementID => {
      const queryRow = rowById(run.defaultQuery, measurementID);
      const details = run.detailsByMeasurementID.get(measurementID);
      const allowed = expectedRelated(limit, measurementID);
      console.log(
        `[truncation] limit=${limit} member=${measurementID} queryRelated=${JSON.stringify(queryRow?.relatedMeasurementIDs)} detailsRelated=${JSON.stringify(details?.row?.relatedMeasurementIDs)}`
      );

      expect(queryRow?.hasContradiction, 'flagged in query').toBe(true);
      expect(details?.row?.hasContradiction, 'flagged in details').toBe(true);
      expect(details?.row?.contradictionTypes).toEqual(['duplicate_tag_stem']);
      expect([...(queryRow?.relatedMeasurementIDs ?? [])].sort()).toEqual(allowed);
      expect([...(details?.row?.relatedMeasurementIDs ?? [])].sort()).toEqual(allowed);
      expect(details?.relatedRows.map(row => row.coreMeasurementID).sort()).toEqual(allowed);
      const everyRelatedList = [
        queryRow?.relatedMeasurementIDs ?? [],
        details?.row?.relatedMeasurementIDs ?? [],
        details?.relatedRows.map(row => row.coreMeasurementID) ?? []
      ];
      everyRelatedList.forEach(list => {
        expect(list).not.toContain(0);
        expect(list).not.toContain(TRUNCATION_UNRELATED_ERROR_ROW_ID);
        expect(list).not.toContain(measurementID);
      });
    });

    it('the unrelated error row has no contradiction in the query, in details and in the preset', async () => {
      const unrelatedRow = rowById(run.defaultQuery, TRUNCATION_UNRELATED_ERROR_ROW_ID);
      expect(unrelatedRow?.hasContradiction).toBe(false);
      expect(unrelatedRow?.relatedMeasurementIDs).toEqual([]);
      expect(run.presetQuery.rows.map(row => row.coreMeasurementID)).not.toContain(TRUNCATION_UNRELATED_ERROR_ROW_ID);
      const unrelatedDetails = await runWithLimit(limit, executor =>
        production.buildErrorExplorerDetails(executor, requestScope(), TRUNCATION_UNRELATED_ERROR_ROW_ID)
      );
      expect(unrelatedDetails.row?.hasContradiction).toBe(false);
      expect(unrelatedDetails.relatedRows).toEqual([]);
    });

    it('details reads 3 statements plus one per 128 related IDs', () => {
      TRUNCATION_DUPLICATE_MEMBER_IDS.forEach(measurementID => {
        const relatedCount = expectedRelated(limit, measurementID).length;
        expect(run.detailsStatementCountByMeasurementID.get(measurementID), `member ${measurementID} with ${relatedCount} related IDs`).toBe(
          DETAILS_FIXED_STATEMENT_COUNT + Math.ceil(relatedCount / RELATED_ID_CHUNK_SIZE)
        );
      });
    });
  });

  it('details for an ID that is not a positive safe integer, or for a census that is not positive, returns the empty response without any SQL', async () => {
    const recorder = createRecordingExecutor(explorerConnection());
    const executor = recorder as unknown as ProductionExecutor;
    for (const measurementID of NON_POSITIVE_OR_FRACTIONAL_IDS) {
      const details = await production.buildErrorExplorerDetails(executor, requestScope(), measurementID);
      expect(details, `measurement ID ${measurementID}`).toEqual({ row: null, allErrors: [], relatedRows: [] });
    }
    const noCensus = await production.buildErrorExplorerDetails(executor, { ...requestScope(), censusID: 0 }, TRUNCATION_DUPLICATE_MEMBER_IDS[0]);
    expect(noCensus).toEqual({ row: null, allErrors: [], relatedRows: [] });
    expect(recorder.statements.map(statement => statement.label)).toEqual([]);
  });

  it('no warning was logged about a cut error-type signature: only the member lists are cut', async () => {
    const ailogger = (await import('@/ailogger')).default;
    expect(vi.mocked(ailogger.warn).mock.calls.map(call => call[0])).toEqual(NO_SIGNATURE_WARNINGS);
  });
});
