import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_ERROR_EXPLORER_FILTERS,
  ERRORS_EXPLORER_MESSAGE_PARAM,
  ERRORS_EXPLORER_VIEW_ALL,
  ERRORS_EXPLORER_VIEW_PARAM,
  VIEW_ERRORS_TEXT,
  type ErrorExplorerFilters
} from '@/config/errorsexplorer';
import userEvent from '@testing-library/user-event';
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
  useOrgCensusContext: () => explorerState.census,
  useOrgCensusListContext: () => []
}));
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { userStatus: 'global' } } })
}));
vi.mock('@/components/client/clientmacros', () => ({
  loadSelectableOptions: vi.fn(async () => undefined)
}));
vi.mock('@/components/errors/contradictioncomparisonpanel', () => ({ default: () => null }));
vi.mock('@/config/styleddatagrid', async () => (await import('@/tests/fixtures/errorsexplorer/grid-capture')).styledDataGridCaptureModule());
// The page imports the real column builder for its default visibility, which needs the real operator helpers.
vi.mock('@mui/x-data-grid', async importOriginal => ({
  ...(await importOriginal<typeof import('@mui/x-data-grid')>()),
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
    cancelPendingOperation: vi.fn(),
    dialogState: { open: false, plan: null, busy: false, wasRefreshed: false }
  })
}));

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
  window.localStorage.setItem(key, JSON.stringify({ ...DEFAULT_ERROR_EXPLORER_FILTERS, exactMessages }));
}

function savedFilters(censusID: number): ErrorExplorerFilters {
  const stored = window.localStorage.getItem(getFilterStorageKey(TEST_SCHEMA, TEST_PLOT_ID, censusID) as string);
  if (!stored) throw new Error(`Nothing saved for census ${censusID}`);
  return JSON.parse(stored) as ErrorExplorerFilters;
}

function requestBodies(endpoint: string): Array<{ censusID: number; censusIDs: number[]; filters: ErrorExplorerFilters; errorType?: { code: string } }> {
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
    const queries = requestBodies(QUERY_ENDPOINT);
    const lastQuery = queries[queries.length - 1];
    console.log(`[#547 deep link] facets ${JSON.stringify(facets.filters.exactMessages)}, query ${JSON.stringify(lastQuery?.filters.exactMessages ?? null)}`);
    expect(facets.filters.exactMessages).toEqual(exactMessages);
    if (lastQuery) expect(lastQuery.filters.exactMessages).toEqual(exactMessages);
  });
}

const SETTLE_MS = 50;
const settle = () => new Promise(resolve => setTimeout(resolve, SETTLE_MS));

const TOP_GROUP_ERROR_CODE = 'INVALID_SPECIES';

function requestedEndpointsInOrder(): string[] {
  return fetchMock.mock.calls.map(([input]) => String(input)).filter(url => url.includes(FACETS_ENDPOINT) || url.includes(QUERY_ENDPOINT));
}

// When the scope returns, the retained facets still name the group, so its query may precede the refreshed facets.
async function expectOneFacetsRequestThenOneTopGroupQuery(exactMessages: string[], { facetsFirst = true }: { facetsFirst?: boolean } = {}): Promise<void> {
  await expectLatestRequestsToFilter(exactMessages);
  await settle();
  const queries = requestBodies(QUERY_ENDPOINT);
  const facets = requestBodies(FACETS_ENDPOINT);
  console.log(
    `[#544 C1] request order ${JSON.stringify(requestedEndpointsInOrder())}, query bodies ${JSON.stringify(queries.map(body => body.filters.exactMessages))}, facets bodies ${JSON.stringify(facets.map(body => body.filters.exactMessages))}`
  );
  expect(facets, 'one facets request, carrying the saved filter').toHaveLength(1);
  expect(queries, 'one query, for the top group').toHaveLength(1);
  if (facetsFirst) expect(requestedEndpointsInOrder()[0], 'the query waits for the facets that name the group').toContain(FACETS_ENDPOINT);
  expect(queries[0].errorType?.code).toBe(TOP_GROUP_ERROR_CODE);
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
          json: async () => ({ rows: [], totalRows: 0 })
        } as Response;
      }
      if (url.includes(FACETS_ENDPOINT)) {
        return {
          ok: true,
          json: async () => ({
            errorTypes: [{ source: 'ingestion', code: 'INVALID_SPECIES', message: LINKED_MESSAGE, fields: ['speciesCode'], count: 1, hasContradiction: false }],
            censusTotals: {
              affectedMeasurements: 1,
              activeMeasurements: 10,
              errorTypeCount: 1,
              validation: 0,
              ingestion: 1,
              failedMeasurements: 1,
              contradictions: 0,
              duplicateTagStem: 0,
              sameBatchConflict: 0
            }
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
    const { source, contradictionOnly, quickSearch, exactMessages } = DEFAULT_ERROR_EXPLORER_FILTERS;
    await waitFor(() => expect(savedFilters(FIRST_CENSUS_ID)).toEqual({ source, contradictionOnly, quickSearch, exactMessages }));
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

  it('sends one facets request, then one query for the top group, both with the saved filter (#544 C1)', async () => {
    saveFilters(FIRST_CENSUS_ID, [SAVED_MESSAGE]);

    render(<ErrorsExplorer />);

    await expectOneFacetsRequestThenOneTopGroupQuery([SAVED_MESSAGE]);
  });

  it('sends one facets request, then one query for the top group, on a ?message= load (#544 C1)', async () => {
    explorerState.search = new URLSearchParams({ [ERRORS_EXPLORER_MESSAGE_PARAM]: LINKED_MESSAGE }).toString();

    render(<ErrorsExplorer />);

    await expectOneFacetsRequestThenOneTopGroupQuery([LINKED_MESSAGE]);
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

  it('sends one facets request, then one query, both with the new census saved filter, when the census switches (#544 C1)', async () => {
    saveFilters(FIRST_CENSUS_ID, [SAVED_MESSAGE]);
    saveFilters(SECOND_CENSUS_ID, [SECOND_CENSUS_SAVED_MESSAGE]);
    const { rerender } = render(<ErrorsExplorer />);
    await expectLatestRequestsToFilter([SAVED_MESSAGE]);
    await settle();
    fetchMock.mockClear();

    explorerState.census = { dateRanges: [{ censusID: SECOND_CENSUS_ID }] };
    rerender(<ErrorsExplorer />);

    await expectOneFacetsRequestThenOneTopGroupQuery([SECOND_CENSUS_SAVED_MESSAGE]);
    expect(requestBodies(QUERY_ENDPOINT)[0].censusID).toBe(SECOND_CENSUS_ID);
    expect(requestBodies(FACETS_ENDPOINT)[0].censusID).toBe(SECOND_CENSUS_ID);
  });

  it('re-reads the saved filter, sending nothing while the scope is gone, when the same census returns (#544 C1)', async () => {
    const changedWhileAway = 'Species code not found';
    saveFilters(FIRST_CENSUS_ID, [SAVED_MESSAGE]);
    const { rerender } = render(<ErrorsExplorer />);
    await expectOneFacetsRequestThenOneTopGroupQuery([SAVED_MESSAGE]);
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

    await expectOneFacetsRequestThenOneTopGroupQuery([changedWhileAway], { facetsFirst: false });
  });

  it('does not re-apply an already-applied ?message= link when the scope goes away and the same census returns (#544 C1)', async () => {
    const userQuickSearch = 'T-1';
    explorerState.search = new URLSearchParams({ [ERRORS_EXPLORER_MESSAGE_PARAM]: LINKED_MESSAGE }).toString();
    const { rerender, getByLabelText } = render(<ErrorsExplorer />);
    await expectOneFacetsRequestThenOneTopGroupQuery([LINKED_MESSAGE]);

    fireEvent.change(getByLabelText(VIEW_ERRORS_TEXT.searchLabel), { target: { value: userQuickSearch } });
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

  it('sends one flat-grid query, with the new census saved filter, when the census switches while ungrouped (#544 C1)', async () => {
    saveFilters(FIRST_CENSUS_ID, [SAVED_MESSAGE]);
    saveFilters(SECOND_CENSUS_ID, [SECOND_CENSUS_SAVED_MESSAGE]);
    const { rerender } = render(<ErrorsExplorer />);
    await expectLatestRequestsToFilter([SAVED_MESSAGE]);
    await userEvent.click(screen.getByRole('combobox', { name: VIEW_ERRORS_TEXT.groupRowsLabel }));
    await userEvent.click(await screen.findByRole('option', { name: VIEW_ERRORS_TEXT.noGrouping }));
    await waitFor(() => expect(screen.getByRole('grid', { name: VIEW_ERRORS_TEXT.flatGridLabel })).toBeInTheDocument());
    await settle();
    fetchMock.mockClear();

    explorerState.census = { dateRanges: [{ censusID: SECOND_CENSUS_ID }] };
    rerender(<ErrorsExplorer />);

    await expectLatestRequestsToFilter([SECOND_CENSUS_SAVED_MESSAGE]);
    await settle();
    const queryMessages = requestBodies(QUERY_ENDPOINT).map(body => body.filters.exactMessages);
    console.log(`[#544 C1 flat] query bodies after the census switch ${JSON.stringify(queryMessages)}`);
    expect(queryMessages, 'one flat query, never one that carries the previous census filter').toEqual([[SECOND_CENSUS_SAVED_MESSAGE]]);
  });

  it('applies a ?message= link that arrived while no census was selected once the census appears (#544 C1)', async () => {
    explorerState.census = { dateRanges: [] };
    explorerState.search = new URLSearchParams({ [ERRORS_EXPLORER_MESSAGE_PARAM]: LINKED_MESSAGE }).toString();
    const { rerender } = render(<ErrorsExplorer />);
    await settle();
    expect(requestBodies(QUERY_ENDPOINT), 'no query before a census exists').toHaveLength(0);

    explorerState.census = { dateRanges: [{ censusID: FIRST_CENSUS_ID }] };
    rerender(<ErrorsExplorer />);

    await expectOneFacetsRequestThenOneTopGroupQuery([LINKED_MESSAGE]);
    await waitFor(() => expect(savedFilters(FIRST_CENSUS_ID).exactMessages).toEqual([LINKED_MESSAGE]));
  });

  describe('stored filters (#544 C1)', () => {
    const storageKeyFor = (censusID: number) => getFilterStorageKey(TEST_SCHEMA, TEST_PLOT_ID, censusID) as string;
    const SUPPORTED_STORED_KEYS = ['contradictionOnly', 'exactMessages', 'quickSearch', 'source'];

    it.each([
      { description: 'is not JSON', stored: '{not json' },
      { description: 'has an invalid source', stored: JSON.stringify({ source: 'bogus-source', exactMessages: [SAVED_MESSAGE] }) }
    ])('restores the defaults and sends them when the stored value $description', async ({ stored }) => {
      window.localStorage.setItem(storageKeyFor(FIRST_CENSUS_ID), stored);

      render(<ErrorsExplorer />);

      await waitFor(() => expect(requestBodies(FACETS_ENDPOINT).length).toBeGreaterThan(0));
      await settle();
      const sentFilters = requestBodies(FACETS_ENDPOINT).map(body => body.filters);
      console.log(`[#544 C1 storage] stored ${stored}, facets filters ${JSON.stringify(sentFilters)}`);
      expect(sentFilters[0]).toEqual(DEFAULT_ERROR_EXPLORER_FILTERS);
      sentFilters.forEach(filters => expect(filters).toEqual(DEFAULT_ERROR_EXPLORER_FILTERS));
    });

    it('restores only the four supported keys, sends no legacy filter and stores exactly the four', async () => {
      window.localStorage.setItem(
        storageKeyFor(FIRST_CENSUS_ID),
        JSON.stringify({
          source: 'ingestion',
          contradictionOnly: false,
          quickSearch: 'T-9',
          exactMessages: [SAVED_MESSAGE],
          affectedFields: ['speciesCode'],
          contradictionTypes: ['hom']
        })
      );

      render(<ErrorsExplorer />);

      await waitFor(() => expect(requestBodies(FACETS_ENDPOINT).length).toBeGreaterThan(0));
      await settle();
      const lastFacets = lastRequestBody(FACETS_ENDPOINT).filters;
      const storedAfterMount = window.localStorage.getItem(storageKeyFor(FIRST_CENSUS_ID)) as string;
      console.log(`[#544 C1 legacy] facets filters ${JSON.stringify(lastFacets)}, stored ${storedAfterMount}`);
      expect(lastFacets).toEqual({
        ...DEFAULT_ERROR_EXPLORER_FILTERS,
        source: 'ingestion',
        quickSearch: 'T-9',
        exactMessages: [SAVED_MESSAGE]
      });
      expect(Object.keys(JSON.parse(storedAfterMount)).sort()).toEqual(SUPPORTED_STORED_KEYS);
    });

    it('restores a saved validation source with contradictionOnly as Show Contradictions (source all)', async () => {
      window.localStorage.setItem(storageKeyFor(FIRST_CENSUS_ID), JSON.stringify({ source: 'validation', contradictionOnly: true }));

      render(<ErrorsExplorer />);

      await waitFor(() => expect(requestBodies(FACETS_ENDPOINT).length).toBeGreaterThan(0));
      await settle();
      const lastFacets = lastRequestBody(FACETS_ENDPOINT).filters;
      console.log(`[#544 C1 broaden] facets filters ${JSON.stringify(lastFacets)}`);
      expect(lastFacets.source).toBe('all');
      expect(lastFacets.contradictionOnly).toBe(true);
      expect(JSON.parse(window.localStorage.getItem(storageKeyFor(FIRST_CENSUS_ID)) as string)).toMatchObject({ source: 'all', contradictionOnly: true });
    });
  });

  it('queries every census behind a grouped plot census, as getDateRangeCensusIDs lists them', async () => {
    explorerState.census = { dateRanges: [{ censusID: 9 }, { censusID: 8 }, { censusID: 9 }] };
    const expectedCensusIDs = getDateRangeCensusIDs(explorerState.census as unknown as OrgCensusRDS);

    render(<ErrorsExplorer />);

    await waitFor(() => {
      const facets = lastRequestBody(FACETS_ENDPOINT);
      const queries = requestBodies(QUERY_ENDPOINT);
      const lastQuery = queries[queries.length - 1];
      console.log(
        `[#547 errors scope] expected ${JSON.stringify(expectedCensusIDs)}, facets ${JSON.stringify(facets.censusIDs)}, query ${JSON.stringify(lastQuery?.censusIDs ?? null)}`
      );
      expect(facets.censusIDs).toEqual(expectedCensusIDs);
      if (lastQuery) expect(lastQuery.censusIDs).toEqual(expectedCensusIDs);
      expect(facets.censusID, 'the storage/publish census is dateRanges[0]').toBe(9);
    });
  });
});
