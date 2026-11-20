import { describe, expect, it } from 'vitest';
import { ERRORS_FLAT_GRID_PAGE_SIZE, type ErrorExplorerQueryRequest, type ErrorExplorerRow, type ErrorTypeFacet } from '@/config/errorsexplorer';
import {
  discoverScenarioInputs,
  type ExplorerCalls,
  flatRequest,
  GROUP_PAGE_SIZE,
  OUTSIDE_PARTNER_CANDIDATE_LIMIT,
  planScenarios,
  REPORT_ONLY_SCENARIOS,
  SCENARIO_NAMES,
  TOP_GROUP_SORT
} from './errorsexplorerscenarios';

const SCOPE = { schema: 'forestgeo_testsite', plotID: 3, censusIDs: [4, 5] };
const TOP_GROUP = { source: 'validation' as const, code: '14', message: 'Invalid attribute code' };
const OUTSIDE_PARTNER_ID = 77;
const FLAT_TOTAL_ROWS = 60;
const RAN = Symbol('executor');

type RecordedCall = { kind: string; request: ErrorExplorerQueryRequest; measurementID?: number; errorType?: unknown };

function recordingArm(calls: RecordedCall[]): ExplorerCalls<typeof RAN> {
  const empty = { rows: [], totalRows: 0 };
  return {
    queryErrorExplorer: async (_executor, request) => {
      calls.push({ kind: 'query', request });
      return empty;
    },
    buildErrorExplorerFacets: async (_executor, request) => {
      calls.push({ kind: 'facets', request });
      return { errorTypes: [], censusTotals: {} as never };
    },
    buildErrorExplorerDetails: async (_executor, request, measurementID) => {
      calls.push({ kind: 'details', request, measurementID });
      return { row: null, allErrors: [], relatedRows: [] };
    },
    buildErrorMessageCounts: async (_executor, scope) => {
      calls.push({ kind: 'messageCounts', request: flatRequest(scope) });
      return null;
    },
    exportRows: async (_executor, scope, filters, errorType) => {
      calls.push({ kind: 'export', request: { ...flatRequest(scope), filters }, errorType });
      return null;
    }
  };
}

async function runScenario(name: string, inputs: Parameters<typeof planScenarios>[1]) {
  const calls: RecordedCall[] = [];
  const { scenarios } = planScenarios<typeof RAN>(SCOPE, inputs);
  const scenario = scenarios.find(item => item.name === name);
  if (!scenario) throw new Error(`scenario ${name} was not planned; planned: ${scenarios.map(item => item.name).join(', ')}`);
  await scenario.run(recordingArm(calls), RAN);
  console.log(
    `${name} issued ${JSON.stringify(calls.map(({ kind, request, measurementID, errorType }) => ({ kind, page: request.page, pageSize: request.pageSize, errorType: request.errorType ?? errorType, sortModel: request.sortModel, filters: request.filters, measurementID })))}`
  );
  return calls;
}

const FULL_INPUTS = { flatTotalRows: FLAT_TOTAL_ROWS, topGroup: TOP_GROUP, outsidePartnerMeasurementID: OUTSIDE_PARTNER_ID };

describe('planScenarios', () => {
  it('plans exactly the dev-shaped scenarios when the target has a top group and an outside partner', () => {
    const { scenarios, unavailable } = planScenarios(SCOPE, FULL_INPUTS);
    console.log(`planned ${scenarios.map(item => item.name).join(', ')}; unavailable ${unavailable.join(', ') || 'none'}`);
    expect(scenarios.map(item => item.name).sort()).toEqual(Object.values(SCENARIO_NAMES).sort());
    expect(unavailable).toEqual([]);
  });

  it('reports the group and outside-partner scenarios absent, and keeps the flat ones, when the target has neither', () => {
    const { scenarios, unavailable } = planScenarios(SCOPE, { flatTotalRows: 0, topGroup: null, outsidePartnerMeasurementID: null });
    console.log(`planned ${scenarios.map(item => item.name).join(', ')}; unavailable ${unavailable.join(', ')}`);
    expect(scenarios.map(item => item.name).sort()).toEqual(
      [SCENARIO_NAMES.facetsDefault, SCENARIO_NAMES.queryFlatPage0, SCENARIO_NAMES.queryPastTheEnd, SCENARIO_NAMES.messageCounts].sort()
    );
    expect(unavailable.sort()).toEqual(
      [
        SCENARIO_NAMES.queryTopGroupPage0,
        SCENARIO_NAMES.queryTopGroupPage1,
        SCENARIO_NAMES.queryTopGroupSorted,
        SCENARIO_NAMES.exportTopGroup,
        SCENARIO_NAMES.detailsWithOutsidePartner
      ].sort()
    );
  });

  it('asks for the top group with the oracle identity at pages 0 and 1 in the group page size', async () => {
    const page0 = await runScenario(SCENARIO_NAMES.queryTopGroupPage0, FULL_INPUTS);
    const page1 = await runScenario(SCENARIO_NAMES.queryTopGroupPage1, FULL_INPUTS);
    expect(page0[0].request).toMatchObject({ page: 0, pageSize: GROUP_PAGE_SIZE, errorType: TOP_GROUP });
    expect(page1[0].request).toMatchObject({ page: 1, pageSize: GROUP_PAGE_SIZE, errorType: TOP_GROUP });
  });

  it('asks for the flat grid without an identity, a sort or a column filter', async () => {
    const [call] = await runScenario(SCENARIO_NAMES.queryFlatPage0, FULL_INPUTS);
    expect(call.request.errorType).toBeUndefined();
    expect(call.request.sortModel).toBeUndefined();
    expect(call.request.columnFilters).toBeUndefined();
    expect(call.request).toMatchObject({ page: 0, pageSize: ERRORS_FLAT_GRID_PAGE_SIZE });
  });

  it('sorts the top group by measuredDBH descending, which routes it to the Node path', async () => {
    const [call] = await runScenario(SCENARIO_NAMES.queryTopGroupSorted, FULL_INPUTS);
    expect(call.request.sortModel).toEqual([TOP_GROUP_SORT]);
    expect(TOP_GROUP_SORT).toEqual({ field: 'measuredDBH', sort: 'desc' });
    expect(call.request.errorType).toEqual(TOP_GROUP);
  });

  it('asks for the page one past the last of the flat grid', async () => {
    const [call] = await runScenario(SCENARIO_NAMES.queryPastTheEnd, FULL_INPUTS);
    const lastPage = Math.ceil(FLAT_TOTAL_ROWS / ERRORS_FLAT_GRID_PAGE_SIZE) - 1;
    expect(call.request.page).toBe(lastPage + 1);
  });

  it('opens details on the discovered outside-partner row and exports the top group', async () => {
    const [details] = await runScenario(SCENARIO_NAMES.detailsWithOutsidePartner, FULL_INPUTS);
    expect(details.measurementID).toBe(OUTSIDE_PARTNER_ID);
    const [exported] = await runScenario(SCENARIO_NAMES.exportTopGroup, FULL_INPUTS);
    expect(exported.errorType).toEqual(TOP_GROUP);
  });

  it('marks exactly the past-the-end and sorted scenarios report-only', () => {
    expect([...REPORT_ONLY_SCENARIOS].sort()).toEqual([SCENARIO_NAMES.queryPastTheEnd, SCENARIO_NAMES.queryTopGroupSorted].sort());
  });
});

describe('discoverScenarioInputs', () => {
  const row = (coreMeasurementID: number) => ({ coreMeasurementID }) as ErrorExplorerRow;
  const facet = (identity: typeof TOP_GROUP): ErrorTypeFacet => ({ ...identity, fields: ['treeTag'], count: 3, hasContradiction: false });

  function oracleFake(options: { contradictionIDs: number[]; outsideFor: number | null; errorTypes: ErrorTypeFacet[] }) {
    const detailsAsked: number[] = [];
    const arm: ExplorerCalls<typeof RAN> = {
      ...recordingArm([]),
      queryErrorExplorer: async (_executor, request) =>
        request.filters.contradictionOnly
          ? { rows: options.contradictionIDs.map(row), totalRows: options.contradictionIDs.length }
          : { rows: [], totalRows: FLAT_TOTAL_ROWS },
      buildErrorExplorerFacets: async () => ({ errorTypes: options.errorTypes, censusTotals: {} as never }),
      buildErrorExplorerDetails: async (_executor, _request, measurementID) => {
        detailsAsked.push(measurementID);
        const related = measurementID === options.outsideFor ? [{ coreMeasurementID: 1, inErrorSet: false }] : [{ coreMeasurementID: 2, inErrorSet: true }];
        return { row: null, allErrors: [], relatedRows: related };
      }
    };
    return { arm, detailsAsked };
  }

  it('takes the first error type of the oracle as the top group and the first contradiction row with an outside partner', async () => {
    const { arm, detailsAsked } = oracleFake({
      contradictionIDs: [10, 11, OUTSIDE_PARTNER_ID, 12],
      outsideFor: OUTSIDE_PARTNER_ID,
      errorTypes: [facet(TOP_GROUP), facet({ ...TOP_GROUP, code: '15' })]
    });
    const inputs = await discoverScenarioInputs(arm, RAN, SCOPE);
    console.log(`discovered ${JSON.stringify(inputs)}; details asked for ${detailsAsked.join(', ')}`);
    expect(inputs).toEqual({ flatTotalRows: FLAT_TOTAL_ROWS, topGroup: TOP_GROUP, outsidePartnerMeasurementID: OUTSIDE_PARTNER_ID });
    expect(detailsAsked).toEqual([10, 11, OUTSIDE_PARTNER_ID]);
  });

  it('reports no outside partner and stops after the candidate limit when none of the contradiction rows has one', async () => {
    const contradictionIDs = Array.from({ length: OUTSIDE_PARTNER_CANDIDATE_LIMIT + 5 }, (_, index) => index + 100);
    const { arm, detailsAsked } = oracleFake({ contradictionIDs, outsideFor: null, errorTypes: [] });
    const inputs = await discoverScenarioInputs(arm, RAN, SCOPE);
    console.log(`discovered ${JSON.stringify(inputs)}; details asked ${detailsAsked.length} times`);
    expect(inputs).toEqual({ flatTotalRows: FLAT_TOTAL_ROWS, topGroup: null, outsidePartnerMeasurementID: null });
    expect(detailsAsked).toHaveLength(OUTSIDE_PARTNER_CANDIDATE_LIMIT);
  });

  it('copies only the identity of the top group, not its counts', async () => {
    const { arm } = oracleFake({ contradictionIDs: [], outsideFor: null, errorTypes: [facet(TOP_GROUP)] });
    const { topGroup } = await discoverScenarioInputs(arm, RAN, SCOPE);
    expect(Object.keys(topGroup ?? {}).sort()).toEqual(['code', 'message', 'source']);
  });
});
