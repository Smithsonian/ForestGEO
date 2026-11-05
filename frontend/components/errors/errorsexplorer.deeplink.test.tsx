import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_ERROR_EXPLORER_FILTERS,
  ERRORS_EXPLORER_MESSAGE_PARAM,
  ERRORS_EXPLORER_VIEW_ALL,
  ERRORS_EXPLORER_VIEW_PARAM,
  type ErrorExplorerFilters
} from '@/config/errorsexplorer';
import { getDateRangeCensusIDs } from '@/lib/censusscope';
import type { OrgCensusRDS } from '@/lib/db/definitions/timekeeping';
import ErrorsExplorer, { getFilterStorageKey } from './errorsexplorer';

const TEST_SCHEMA = 'forestgeo_testing_deeplink';
const TEST_PLOT_ID = 22;
const FIRST_CENSUS_ID = 6;
const SECOND_CENSUS_ID = 7;
const LINKED_MESSAGE = 'Invalid species reference';
const SAVED_MESSAGE = 'Coordinate drift exceeds allowed threshold';
const SECOND_CENSUS_SAVED_MESSAGE = 'Duplicate TreeTag/StemTag within upload batch';
const FACETS_ENDPOINT = '/api/errors/explorer/facets';
const QUERY_ENDPOINT = '/api/errors/explorer/query';

const explorerState = vi.hoisted(() => ({
  search: '',
  census: { dateRanges: [] } as { dateRanges: Array<{ censusID: number }> }
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(explorerState.search),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/measurementshub/errors'
}));
// Factories run lazily at render time, so they may read the module constants above.
vi.mock('@/app/contexts/compat-hooks', () => ({
  useSiteContext: () => ({ schemaName: TEST_SCHEMA }),
  usePlotContext: () => ({ plotID: TEST_PLOT_ID }),
  useOrgCensusContext: () => explorerState.census
}));
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { userStatus: 'global' } } })
}));
vi.mock('@/components/client/clientmacros', () => ({
  loadSelectableOptions: vi.fn(async () => undefined)
}));
vi.mock('@/components/errors/contradictioncomparisonpanel', () => ({ default: () => null }));
vi.mock('@mui/x-data-grid', () => ({
  GridActionsCellItem: () => null,
  GridRowEditStopReasons: { rowFocusOut: 'rowFocusOut' },
  GridRowModes: { Edit: 'edit', View: 'view' },
  useGridApiRef: () => ({ current: { subscribeEvent: () => () => undefined } })
}));
vi.mock('@/components/datagrids/customgridpagination', () => ({ default: () => null }));
vi.mock('@/components/datagrids/infinitegridscrollbridge', () => ({ default: () => null }));
vi.mock('@/components/editplan/previewdialog', () => ({ default: () => null }));
vi.mock('@/components/editplan/undotoast', () => ({ default: () => null }));
vi.mock('@/app/hooks/useEditPreviewFlow', () => ({
  useEditPreviewFlow: () => ({
    beginEdit: vi.fn(),
    confirmDialog: vi.fn(),
    cancelDialog: vi.fn(),
    dialogState: { open: false, plan: null, busy: false, wasRefreshed: false }
  })
}));
vi.mock('@/config/styleddatagrid', () => ({ StyledDataGrid: () => <div data-testid="styled-grid" /> }));

const fetchMock = vi.fn();

function installStorage(): void {
  // Same Map-backed Storage the existing errorsexplorer.test.tsx installs: real
  // get/set semantics, nothing mocked about persistence.
  const store = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: key => (store.has(key) ? (store.get(key) as string) : null),
    key: index => Array.from(store.keys())[index] ?? null,
    removeItem: key => {
      store.delete(key);
    },
    setItem: (key, value) => {
      store.set(key, String(value));
    }
  };
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
}

function saveFilters(censusID: number, exactMessages: string[]): void {
  const key = getFilterStorageKey(TEST_SCHEMA, TEST_PLOT_ID, censusID) as string;
  window.localStorage.setItem(key, JSON.stringify({ ...DEFAULT_ERROR_EXPLORER_FILTERS, exactMessages, presetId: undefined }));
}

function savedFilters(censusID: number): ErrorExplorerFilters {
  const stored = window.localStorage.getItem(getFilterStorageKey(TEST_SCHEMA, TEST_PLOT_ID, censusID) as string);
  if (!stored) throw new Error(`Nothing saved for census ${censusID}`);
  return JSON.parse(stored) as ErrorExplorerFilters;
}

function requestBodies(endpoint: string): Array<{ censusID: number; censusIDs: number[]; filters: ErrorExplorerFilters }> {
  return fetchMock.mock.calls.filter(([input]) => String(input).includes(endpoint)).map(([, init]) => JSON.parse(String((init as RequestInit).body)));
}

function lastRequestBody(endpoint: string) {
  const bodies = requestBodies(endpoint);
  if (bodies.length === 0) {
    throw new Error(`No ${endpoint} request yet. Requests so far: ${JSON.stringify(fetchMock.mock.calls.map(([input]) => String(input)))}`);
  }
  return bodies[bodies.length - 1];
}

async function expectLatestRequestsToFilter(exactMessages: string[]): Promise<void> {
  await waitFor(() => {
    const facets = lastRequestBody(FACETS_ENDPOINT);
    const query = lastRequestBody(QUERY_ENDPOINT);
    console.log(`[#547 deep link] facets ${JSON.stringify(facets.filters.exactMessages)}, query ${JSON.stringify(query.filters.exactMessages)}`);
    expect(facets.filters.exactMessages).toEqual(exactMessages);
    expect(query.filters.exactMessages).toEqual(exactMessages);
  });
}

const SETTLE_MS = 50;
const settle = () => new Promise(resolve => setTimeout(resolve, SETTLE_MS));

async function expectExactlyOneLoadRound(exactMessages: string[]): Promise<void> {
  await expectLatestRequestsToFilter(exactMessages);
  await settle();
  const queries = requestBodies(QUERY_ENDPOINT);
  const facets = requestBodies(FACETS_ENDPOINT);
  console.log(
    `[#544 C1] query bodies ${JSON.stringify(queries.map(body => body.filters.exactMessages))}, facets bodies ${JSON.stringify(facets.map(body => body.filters.exactMessages))}`
  );
  expect(queries).toHaveLength(1);
  expect(facets).toHaveLength(1);
}

describe('ErrorsExplorer deep links (#547)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installStorage();
    explorerState.search = '';
    explorerState.census = { dateRanges: [{ censusID: FIRST_CENSUS_ID }] };
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes(QUERY_ENDPOINT)) {
        return {
          ok: true,
          json: async () => ({
            rows: [],
            totalRows: 0,
            summary: { total: 0, validation: 0, ingestion: 0, contradictions: 0, duplicateTagStem: 0, sameBatchConflict: 0 }
          })
        } as Response;
      }
      if (url.includes(FACETS_ENDPOINT)) {
        return {
          ok: true,
          json: async () => ({
            messages: [],
            fields: [],
            sourceCounts: { validation: 0, ingestion: 0 },
            contradictionCounts: { duplicateTagStem: 0, sameBatchConflict: 0 },
            totalMeasurements: 0
          })
        } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    });
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('applies ?message= over a saved filter and saves the result', async () => {
    saveFilters(FIRST_CENSUS_ID, [SAVED_MESSAGE]);
    explorerState.search = new URLSearchParams({ [ERRORS_EXPLORER_MESSAGE_PARAM]: LINKED_MESSAGE }).toString();

    render(<ErrorsExplorer />);

    await expectLatestRequestsToFilter([LINKED_MESSAGE]);
    await waitFor(() => expect(savedFilters(FIRST_CENSUS_ID).exactMessages).toEqual([LINKED_MESSAGE]));
  });

  it('restores the saved filter on a plain visit', async () => {
    saveFilters(FIRST_CENSUS_ID, [SAVED_MESSAGE]);

    render(<ErrorsExplorer />);

    await expectLatestRequestsToFilter([SAVED_MESSAGE]);
  });

  it('resets to the defaults for ?view=all over a saved filter and saves the result', async () => {
    saveFilters(FIRST_CENSUS_ID, [SAVED_MESSAGE]);
    explorerState.search = new URLSearchParams({ [ERRORS_EXPLORER_VIEW_PARAM]: ERRORS_EXPLORER_VIEW_ALL }).toString();

    render(<ErrorsExplorer />);

    await expectLatestRequestsToFilter([]);
    await waitFor(() => expect(savedFilters(FIRST_CENSUS_ID)).toEqual(DEFAULT_ERROR_EXPLORER_FILTERS));
  });

  it('goes back to all errors after a type link: mount ?message=X, unmount, mount ?view=all', async () => {
    explorerState.search = new URLSearchParams({ [ERRORS_EXPLORER_MESSAGE_PARAM]: LINKED_MESSAGE }).toString();
    const typeLinkVisit = render(<ErrorsExplorer />);
    await expectLatestRequestsToFilter([LINKED_MESSAGE]);
    typeLinkVisit.unmount();
    fetchMock.mockClear();

    explorerState.search = new URLSearchParams({ [ERRORS_EXPLORER_VIEW_PARAM]: ERRORS_EXPLORER_VIEW_ALL }).toString();
    render(<ErrorsExplorer />);

    await expectLatestRequestsToFilter([]);
  });

  it("restores the other census's saved filters when the census changes after a ?message= landing", async () => {
    saveFilters(SECOND_CENSUS_ID, [SECOND_CENSUS_SAVED_MESSAGE]);
    explorerState.search = new URLSearchParams({ [ERRORS_EXPLORER_MESSAGE_PARAM]: LINKED_MESSAGE }).toString();
    const { rerender } = render(<ErrorsExplorer />);
    await expectLatestRequestsToFilter([LINKED_MESSAGE]);

    explorerState.census = { dateRanges: [{ censusID: SECOND_CENSUS_ID }] };
    rerender(<ErrorsExplorer />);

    await expectLatestRequestsToFilter([SECOND_CENSUS_SAVED_MESSAGE]);
  });

  it('keeps the ?message= filter under React StrictMode, which re-runs the restore effect', async () => {
    saveFilters(FIRST_CENSUS_ID, [SAVED_MESSAGE]);
    explorerState.search = new URLSearchParams({ [ERRORS_EXPLORER_MESSAGE_PARAM]: LINKED_MESSAGE }).toString();

    render(
      <React.StrictMode>
        <ErrorsExplorer />
      </React.StrictMode>
    );

    await expectLatestRequestsToFilter([LINKED_MESSAGE]);
  });

  it('sends one query and one facets request on a load that restores a saved filter (#544 C1)', async () => {
    saveFilters(FIRST_CENSUS_ID, [SAVED_MESSAGE]);

    render(<ErrorsExplorer />);

    await expectExactlyOneLoadRound([SAVED_MESSAGE]);
  });

  it('sends one query and one facets request on a ?message= load (#544 C1)', async () => {
    explorerState.search = new URLSearchParams({ [ERRORS_EXPLORER_MESSAGE_PARAM]: LINKED_MESSAGE }).toString();

    render(<ErrorsExplorer />);

    await expectExactlyOneLoadRound([LINKED_MESSAGE]);
  });

  it('keeps a plain saved filter under React StrictMode: requests carry it and it stays saved (#544 C1)', async () => {
    saveFilters(FIRST_CENSUS_ID, [SAVED_MESSAGE]);

    render(
      <React.StrictMode>
        <ErrorsExplorer />
      </React.StrictMode>
    );

    await expectLatestRequestsToFilter([SAVED_MESSAGE]);
    await settle();
    const queryMessages = requestBodies(QUERY_ENDPOINT).map(body => body.filters.exactMessages);
    const facetsMessages = requestBodies(FACETS_ENDPOINT).map(body => body.filters.exactMessages);
    const stored = window.localStorage.getItem(getFilterStorageKey(TEST_SCHEMA, TEST_PLOT_ID, FIRST_CENSUS_ID) as string);
    console.log(`[#544 C1 strict] query ${JSON.stringify(queryMessages)}, facets ${JSON.stringify(facetsMessages)}, stored ${stored}`);
    expect(
      queryMessages.every(messages => messages[0] === SAVED_MESSAGE),
      'no query went out with the default filters'
    ).toBe(true);
    expect(
      facetsMessages.every(messages => messages[0] === SAVED_MESSAGE),
      'no facets request went out with the default filters'
    ).toBe(true);
    expect(savedFilters(FIRST_CENSUS_ID).exactMessages).toEqual([SAVED_MESSAGE]);
  });

  it('sends one query and one facets round, both with the new census saved filter, when the census switches (#544 C1)', async () => {
    saveFilters(FIRST_CENSUS_ID, [SAVED_MESSAGE]);
    saveFilters(SECOND_CENSUS_ID, [SECOND_CENSUS_SAVED_MESSAGE]);
    const { rerender } = render(<ErrorsExplorer />);
    await expectLatestRequestsToFilter([SAVED_MESSAGE]);
    await settle();
    fetchMock.mockClear();

    explorerState.census = { dateRanges: [{ censusID: SECOND_CENSUS_ID }] };
    rerender(<ErrorsExplorer />);

    await expectExactlyOneLoadRound([SECOND_CENSUS_SAVED_MESSAGE]);
    expect(requestBodies(QUERY_ENDPOINT)[0].censusID).toBe(SECOND_CENSUS_ID);
    expect(requestBodies(FACETS_ENDPOINT)[0].censusID).toBe(SECOND_CENSUS_ID);
  });

  it('re-reads the saved filter, sending nothing while the scope is gone, when the same census returns (#544 C1)', async () => {
    const changedWhileAway = 'Species code not found';
    saveFilters(FIRST_CENSUS_ID, [SAVED_MESSAGE]);
    const { rerender } = render(<ErrorsExplorer />);
    await expectExactlyOneLoadRound([SAVED_MESSAGE]);
    fetchMock.mockClear();

    explorerState.census = { dateRanges: [] };
    rerender(<ErrorsExplorer />);
    await settle();
    console.log(`[#544 C1 scope gone] requests while no census is selected: ${JSON.stringify(fetchMock.mock.calls.map(([input]) => String(input)))}`);
    expect(requestBodies(QUERY_ENDPOINT), 'no query while the scope is gone').toHaveLength(0);
    expect(requestBodies(FACETS_ENDPOINT), 'no facets request while the scope is gone').toHaveLength(0);

    saveFilters(FIRST_CENSUS_ID, [changedWhileAway]);
    explorerState.census = { dateRanges: [{ censusID: FIRST_CENSUS_ID }] };
    rerender(<ErrorsExplorer />);

    await expectExactlyOneLoadRound([changedWhileAway]);
  });

  it('does not re-apply an already-applied ?message= link when the scope goes away and the same census returns (#544 C1)', async () => {
    const userQuickSearch = 'T-1';
    explorerState.search = new URLSearchParams({ [ERRORS_EXPLORER_MESSAGE_PARAM]: LINKED_MESSAGE }).toString();
    const { rerender, getByLabelText } = render(<ErrorsExplorer />);
    await expectExactlyOneLoadRound([LINKED_MESSAGE]);

    fireEvent.change(getByLabelText('Quick Search'), { target: { value: userQuickSearch } });
    await waitFor(() => expect(savedFilters(FIRST_CENSUS_ID).quickSearch).toBe(userQuickSearch));
    await settle();
    fetchMock.mockClear();

    explorerState.census = { dateRanges: [] };
    rerender(<ErrorsExplorer />);
    await settle();
    explorerState.census = { dateRanges: [{ censusID: FIRST_CENSUS_ID }] };
    rerender(<ErrorsExplorer />);
    await expectLatestRequestsToFilter([LINKED_MESSAGE]);
    await settle();

    const queries = requestBodies(QUERY_ENDPOINT);
    const facets = requestBodies(FACETS_ENDPOINT);
    console.log(
      `[#544 C1 link] query quickSearch ${JSON.stringify(queries.map(body => body.filters.quickSearch))}, facets quickSearch ${JSON.stringify(facets.map(body => body.filters.quickSearch))}, stored ${JSON.stringify(savedFilters(FIRST_CENSUS_ID))}`
    );
    expect(queries).toHaveLength(1);
    expect(facets).toHaveLength(1);
    expect(queries[0].filters.quickSearch, 'the saved quick search, not the link filters').toBe(userQuickSearch);
    expect(facets[0].filters.quickSearch).toBe(userQuickSearch);
    expect(savedFilters(FIRST_CENSUS_ID).quickSearch, 'the link must not overwrite what the user saved').toBe(userQuickSearch);
  });

  it('applies a ?message= link that arrived while no census was selected once the census appears (#544 C1)', async () => {
    explorerState.census = { dateRanges: [] };
    explorerState.search = new URLSearchParams({ [ERRORS_EXPLORER_MESSAGE_PARAM]: LINKED_MESSAGE }).toString();
    const { rerender } = render(<ErrorsExplorer />);
    await settle();
    expect(requestBodies(QUERY_ENDPOINT), 'no query before a census exists').toHaveLength(0);

    explorerState.census = { dateRanges: [{ censusID: FIRST_CENSUS_ID }] };
    rerender(<ErrorsExplorer />);

    await expectExactlyOneLoadRound([LINKED_MESSAGE]);
    await waitFor(() => expect(savedFilters(FIRST_CENSUS_ID).exactMessages).toEqual([LINKED_MESSAGE]));
  });

  it('queries every census behind a grouped plot census, as getDateRangeCensusIDs lists them', async () => {
    explorerState.census = { dateRanges: [{ censusID: 9 }, { censusID: 8 }, { censusID: 9 }] };
    const expectedCensusIDs = getDateRangeCensusIDs(explorerState.census as unknown as OrgCensusRDS);

    render(<ErrorsExplorer />);

    await waitFor(() => {
      const facets = lastRequestBody(FACETS_ENDPOINT);
      const query = lastRequestBody(QUERY_ENDPOINT);
      console.log(
        `[#547 errors scope] expected ${JSON.stringify(expectedCensusIDs)}, facets ${JSON.stringify(facets.censusIDs)}, query ${JSON.stringify(query.censusIDs)}`
      );
      expect(facets.censusIDs).toEqual(expectedCensusIDs);
      expect(query.censusIDs).toEqual(expectedCensusIDs);
      expect(facets.censusID, 'the storage/publish census is dateRanges[0]').toBe(9);
    });
  });
});
