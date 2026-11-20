import {
  applyShowValue,
  DEFAULT_ERROR_EXPLORER_FILTERS,
  ERROR_TYPE_GROUP_PAGE_SIZE,
  ERRORS_FLAT_GRID_PAGE_SIZE,
  type ErrorExplorerDetailsResponse,
  type ErrorExplorerFacetsResponse,
  type ErrorExplorerFilters,
  type ErrorExplorerQueryRequest,
  type ErrorExplorerQueryResponse,
  type ErrorExplorerSortItem,
  type ErrorTypeIdentity
} from '@/config/errorsexplorer';
import { pastTheEndPageNumber } from '@/tests/setup/errorsetstatements';

export const SCENARIO_NAMES = {
  facetsDefault: 'facetsDefault',
  queryTopGroupPage0: 'queryTopGroupPage0',
  queryTopGroupPage1: 'queryTopGroupPage1',
  queryFlatPage0: 'queryFlatPage0',
  queryTopGroupSorted: 'queryTopGroupSorted',
  queryPastTheEnd: 'queryPastTheEnd',
  detailsWithOutsidePartner: 'detailsWithOutsidePartner',
  exportTopGroup: 'exportTopGroup',
  messageCounts: 'messageCounts'
} as const;

export const PAGE_LOAD_SERIAL = 'pageLoadSerial';

/** queryPastTheEnd (plan:3225) and queryTopGroupSorted (Node path, plan decision D-A) have no target; they are reported, never gated. */
export const REPORT_ONLY_SCENARIOS: readonly string[] = [SCENARIO_NAMES.queryPastTheEnd, SCENARIO_NAMES.queryTopGroupSorted];

export const TOP_GROUP_SORT: ErrorExplorerSortItem = { field: 'measuredDBH', sort: 'desc' };
export const OUTSIDE_PARTNER_CANDIDATE_LIMIT = 10;
export const FLAT_PAGE_SIZE = ERRORS_FLAT_GRID_PAGE_SIZE;
export const GROUP_PAGE_SIZE = ERROR_TYPE_GROUP_PAGE_SIZE;

export interface ScenarioScope {
  schema: string;
  plotID: number;
  censusIDs: number[];
}

export interface ExplorerCalls<Executor> {
  queryErrorExplorer(executor: Executor, request: ErrorExplorerQueryRequest): Promise<ErrorExplorerQueryResponse>;
  buildErrorExplorerFacets(executor: Executor, request: ErrorExplorerQueryRequest): Promise<ErrorExplorerFacetsResponse>;
  buildErrorExplorerDetails(executor: Executor, request: ErrorExplorerQueryRequest, measurementID: number): Promise<ErrorExplorerDetailsResponse>;
  buildErrorMessageCounts(executor: Executor, scope: ScenarioScope): Promise<unknown>;
  exportRows(executor: Executor, scope: ScenarioScope, filters: ErrorExplorerFilters, errorType?: ErrorTypeIdentity): Promise<unknown>;
}

export interface DiscoveredScenarioInputs {
  flatTotalRows: number;
  topGroup: ErrorTypeIdentity | null;
  outsidePartnerMeasurementID: number | null;
}

export interface TimingScenario<Executor> {
  name: string;
  run: (arm: ExplorerCalls<Executor>, executor: Executor) => Promise<unknown>;
}

export function flatRequest(scope: ScenarioScope): ErrorExplorerQueryRequest {
  return {
    schema: scope.schema,
    plotID: scope.plotID,
    censusID: scope.censusIDs[0],
    censusIDs: scope.censusIDs,
    page: 0,
    pageSize: FLAT_PAGE_SIZE,
    filters: DEFAULT_ERROR_EXPLORER_FILTERS
  };
}

function groupRequest(scope: ScenarioScope, errorType: ErrorTypeIdentity, page: number): ErrorExplorerQueryRequest {
  return { ...flatRequest(scope), page, pageSize: GROUP_PAGE_SIZE, errorType };
}

function identityOf({ source, code, message }: ErrorTypeIdentity): ErrorTypeIdentity {
  return { source, code, message };
}

/** Reads the inputs the scenarios need from the frozen oracle, the reference both arms are compared against. */
export async function discoverScenarioInputs<Executor>(
  oracle: ExplorerCalls<Executor>,
  executor: Executor,
  scope: ScenarioScope
): Promise<DiscoveredScenarioInputs> {
  const request = flatRequest(scope);
  const flat = await oracle.queryErrorExplorer(executor, request);
  const facets = await oracle.buildErrorExplorerFacets(executor, request);
  const contradictionRequest = { ...request, filters: applyShowValue(request.filters, 'contradictions') };
  const contradictionPage = await oracle.queryErrorExplorer(executor, contradictionRequest);
  let outsidePartnerMeasurementID: number | null = null;
  for (const row of contradictionPage.rows.slice(0, OUTSIDE_PARTNER_CANDIDATE_LIMIT)) {
    if (row.coreMeasurementID == null) continue;
    const details = await oracle.buildErrorExplorerDetails(executor, request, row.coreMeasurementID);
    if (details.relatedRows.some(related => !related.inErrorSet)) {
      outsidePartnerMeasurementID = row.coreMeasurementID;
      break;
    }
  }
  const topGroup = facets.errorTypes[0];
  return { flatTotalRows: flat.totalRows, topGroup: topGroup ? identityOf(topGroup) : null, outsidePartnerMeasurementID };
}

export function planScenarios<Executor>(
  scope: ScenarioScope,
  inputs: DiscoveredScenarioInputs
): { scenarios: TimingScenario<Executor>[]; unavailable: string[] } {
  const request = flatRequest(scope);
  const { topGroup, outsidePartnerMeasurementID } = inputs;
  const scenarios: TimingScenario<Executor>[] = [
    { name: SCENARIO_NAMES.facetsDefault, run: (arm, executor) => arm.buildErrorExplorerFacets(executor, request) },
    { name: SCENARIO_NAMES.queryFlatPage0, run: (arm, executor) => arm.queryErrorExplorer(executor, request) },
    {
      name: SCENARIO_NAMES.queryPastTheEnd,
      run: (arm, executor) => arm.queryErrorExplorer(executor, { ...request, page: pastTheEndPageNumber(inputs.flatTotalRows, FLAT_PAGE_SIZE) })
    },
    { name: SCENARIO_NAMES.messageCounts, run: (arm, executor) => arm.buildErrorMessageCounts(executor, scope) }
  ];
  const unavailable: string[] = [];
  if (topGroup) {
    scenarios.push(
      { name: SCENARIO_NAMES.queryTopGroupPage0, run: (arm, executor) => arm.queryErrorExplorer(executor, groupRequest(scope, topGroup, 0)) },
      { name: SCENARIO_NAMES.queryTopGroupPage1, run: (arm, executor) => arm.queryErrorExplorer(executor, groupRequest(scope, topGroup, 1)) },
      {
        name: SCENARIO_NAMES.queryTopGroupSorted,
        run: (arm, executor) => arm.queryErrorExplorer(executor, { ...groupRequest(scope, topGroup, 0), sortModel: [TOP_GROUP_SORT] })
      },
      { name: SCENARIO_NAMES.exportTopGroup, run: (arm, executor) => arm.exportRows(executor, scope, request.filters, topGroup) }
    );
  } else {
    unavailable.push(SCENARIO_NAMES.queryTopGroupPage0, SCENARIO_NAMES.queryTopGroupPage1, SCENARIO_NAMES.queryTopGroupSorted, SCENARIO_NAMES.exportTopGroup);
  }
  if (outsidePartnerMeasurementID !== null) {
    scenarios.push({
      name: SCENARIO_NAMES.detailsWithOutsidePartner,
      run: (arm, executor) => arm.buildErrorExplorerDetails(executor, request, outsidePartnerMeasurementID)
    });
  } else {
    unavailable.push(SCENARIO_NAMES.detailsWithOutsidePartner);
  }
  return { scenarios, unavailable };
}
