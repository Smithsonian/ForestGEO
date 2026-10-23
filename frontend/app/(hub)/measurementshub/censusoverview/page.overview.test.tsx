/**
 * Census Overview redesign (#547): layout, the summary request, its failure
 * state, the Data Quality refresh refetch and the Census Tools row. The cards
 * render for real; only widgets with their own fetches are stubbed.
 */
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useAppStore } from '@/config/store/appstore';
import { HTTPResponses } from '@/config/macros';
import { CENSUS_OVERVIEW_ERROR_CENSUS_IDS_PARAM, CENSUS_OVERVIEW_TEXT, type CensusOverviewSummary } from '@/config/censusoverview';
import CensusOverviewPage from './page';

vi.mock('next/navigation');
vi.mock('next-auth/react');
vi.mock('@/ailogger', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
vi.mock('@/app/contexts/loadingprovider', () => ({ useLoading: () => ({ setLoading: vi.fn() }) }));
vi.mock('@/components/dashboard/dataqualitycard', () => ({
  default: ({ onRefresh }: { onRefresh?: () => Promise<void> }) => (
    <button type="button" data-testid="data-quality-refresh" onClick={() => void onRefresh?.()}>
      Refresh data quality
    </button>
  )
}));
vi.mock('@/components/dashboard/publishcensusbutton', () => ({ default: () => <div data-testid="publish-census-button" /> }));
vi.mock('@/components/dashboard/rebuildviewfulltablebutton', () => ({ default: () => <div data-testid="rebuild-vft-button" /> }));

const URL_BASE = 'http://localhost';
const METRICS_URL_FRAGMENT = '/api/dashboardmetrics/all/';
const SUMMARY_URL_FRAGMENT = '/api/censusoverview/summary/';
const REFRESH_URL_FRAGMENT = '/api/refreshviews/measurementssummary/';
const CLEAR_CENSUS_URL_FRAGMENT = '/api/clearcensus';
const ERRORS_EXPORT_PREVIEW_CARD_TEST_ID = 'errors-export-preview-card';
const DELETE_BUTTON_TEST_ID = 'census-overview-delete-button';
const DELETE_ERROR_TEST_ID = 'census-overview-delete-error';
const MODAL_CONFIRM_LABEL = 'Delete Census';
const CENSUS_LIST_REFRESH_FAILED_MESSAGE = 'Census deleted, but refreshing the census list failed. Reload the page to see the updated list.';
const CENSUS_NOT_FOUND_MESSAGE = 'Census not found';
const PERSONNEL_BOX_TITLE = 'Active Personnel';
const DATA_QUALITY_HEADING = 'Data Quality';
const CENSUS_TOOLS_HEADING = 'Census Tools';
const QUADRAT_COVERAGE_HEADING = 'Quadrat Coverage';
const TREE_COUNT_TEXT = '12,408';

const TEST_SITE = { siteID: 1, siteName: 'Test Site', schemaName: 'forestgeo_testsite' };
const TEST_PLOT = { plotID: 1, plotName: 'Test Plot' };
const SINGLE_RANGE_CENSUS = {
  plotID: 1,
  plotCensusNumber: 2,
  censusIDs: [102],
  dateRanges: [{ censusID: 102, startDate: new Date('2025-01-01'), endDate: new Date('2025-12-31') }],
  description: 'Census 2'
};
const CENSUS_BEING_CREATED = {
  plotID: 1,
  plotCensusNumber: 4,
  censusIDs: [0],
  dateRanges: [{ censusID: 0, startDate: new Date('2027-01-01'), endDate: undefined }],
  description: 'Census 4'
};
const GROUPED_CENSUS = {
  plotID: 1,
  plotCensusNumber: 3,
  censusIDs: [202, 201],
  dateRanges: [
    { censusID: 202, startDate: new Date('2026-01-01'), endDate: new Date('2026-06-30') },
    { censusID: 201, startDate: new Date('2025-07-01'), endDate: new Date('2025-12-31') }
  ],
  description: 'Census 3'
};

const METRICS_RESPONSE = {
  progressTachometer: { TotalQuadrats: 500, PopulatedQuadrats: 492, PopulatedPercent: 98, UnpopulatedQuadrats: 'Q0412;Q0413' },
  activeUsers: { CountActiveUsers: 4 },
  countTrees: { CountTrees: 12408 },
  countStems: { CountStems: 15932 },
  stemTypes: { CountOldStems: 11950, CountMultiStems: 1212, CountNewRecruits: 458, isFirstCensus: false }
};
const SUMMARY_RESPONSE: CensusOverviewSummary = {
  errorOverview: {
    affectedMeasurements: 3,
    totalActiveMeasurements: 20,
    topErrorTypes: [{ message: 'Invalid species reference', count: 3 }],
    remainingErrorTypeCount: 0
  },
  exportPreview: {
    totalActiveMeasurements: 20,
    exportableCount: 18,
    skippedCount: 2,
    skipReasons: [{ kind: 'not-validated', count: 2 }],
    exportedWithUnresolvedErrorCount: 1
  },
  blockers: []
};
const EXPECTED_CENSUS_TOOLS = [
  { label: 'View Data', href: '/measurementshub/summary', description: 'Browse measurement records' },
  { label: 'View Errors', href: '/measurementshub/errors', description: 'Review failed measurements' },
  { label: 'Post-Census Statistics', href: '/measurementshub/postvalidation', description: 'Validation results and quality checks' },
  { label: 'Recent Changes', href: '/measurementshub/recentchanges', description: 'Changelog and activity history' },
  { label: 'Uploaded Files', href: '/measurementshub/uploadedfiles', description: 'View uploaded data files' },
  { label: 'View All Historical Data', href: '/measurementshub/viewfulltable', description: 'Full historical measurement data' },
  { label: 'Validations', href: '/measurementshub/validations', description: 'Data validation rules and results' }
];

const REFRESH_OK_RESPONSE = { ok: true, status: HTTPResponses.OK, json: async () => ({}) } as Response;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(settle => {
    resolve = settle;
  });
  return { promise, resolve };
}

type SummaryAnswer = () => { ok: boolean; status: number; body: unknown };
let summaryAnswer: SummaryAnswer = () => ({ ok: true, status: HTTPResponses.OK, body: SUMMARY_RESPONSE });
let summaryGate: Promise<void> = Promise.resolve();
let refreshResponse: Promise<Response> = Promise.resolve(REFRESH_OK_RESPONSE);

function installFetch(): void {
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes(METRICS_URL_FRAGMENT)) return { ok: true, status: HTTPResponses.OK, json: async () => METRICS_RESPONSE } as Response;
    if (url.includes(SUMMARY_URL_FRAGMENT)) {
      await summaryGate;
      const answer = summaryAnswer();
      return { ok: answer.ok, status: answer.status, json: async () => answer.body } as Response;
    }
    if (url.includes(REFRESH_URL_FRAGMENT)) return refreshResponse;
    if (url.includes(CLEAR_CENSUS_URL_FRAGMENT)) return { ok: true, status: HTTPResponses.OK, json: async () => ({}) } as Response;
    return { ok: false, status: HTTPResponses.NOT_FOUND, json: async () => ({}) } as Response;
  }) as unknown as typeof fetch;
}

function fetchedUrls(fragment: string): string[] {
  return vi
    .mocked(global.fetch)
    .mock.calls.map(([input]) => String(input))
    .filter(url => url.includes(fragment));
}

function summaryRequestLog(): { url: string; aborted: boolean }[] {
  return vi
    .mocked(global.fetch)
    .mock.calls.filter(([input]) => String(input).includes(SUMMARY_URL_FRAGMENT))
    .map(([input, init]) => ({ url: String(input), aborted: init?.signal?.aborted ?? false }));
}

function seedSelection(census: typeof SINGLE_RANGE_CENSUS | typeof CENSUS_BEING_CREATED) {
  useAppStore.getState().setSite(TEST_SITE);
  useAppStore.getState().setPlot(TEST_PLOT);
  useAppStore.getState().setCensusList([census]);
  useAppStore.getState().setCensus(census);
}

function isBefore(first: HTMLElement, second: HTMLElement): boolean {
  return Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);
}

describe('CensusOverviewPage — census overview redesign (#547)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.getState().clearSelections();
    (useRouter as any).mockReturnValue({ push: vi.fn() });
    (useSession as any).mockReturnValue({ data: { user: { userStatus: 'global' } }, status: 'authenticated' });
    summaryAnswer = () => ({ ok: true, status: HTTPResponses.OK, body: SUMMARY_RESPONSE });
    summaryGate = Promise.resolve();
    refreshResponse = Promise.resolve(REFRESH_OK_RESPONSE);
    installFetch();
  });

  afterEach(() => {
    useAppStore.getState().clearSelections();
  });

  it('keeps the stat boxes up and shows the message with Retry when the summary fails', async () => {
    const user = userEvent.setup();
    summaryAnswer = () => ({ ok: false, status: HTTPResponses.NOT_FOUND, body: { error: CENSUS_NOT_FOUND_MESSAGE } });
    seedSelection(SINGLE_RANGE_CENSUS);
    render(<CensusOverviewPage />);

    expect(await screen.findByText(TREE_COUNT_TEXT)).toBeInTheDocument();
    expect(await screen.findByText(CENSUS_NOT_FOUND_MESSAGE)).toBeInTheDocument();
    expect(screen.getByText(QUADRAT_COVERAGE_HEADING)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: CENSUS_OVERVIEW_TEXT.retry }));
    await waitFor(() => expect(fetchedUrls(SUMMARY_URL_FRAGMENT)).toHaveLength(2));
  });

  it('refetches the summary exactly once after a successful Data Quality refresh', async () => {
    const user = userEvent.setup();
    seedSelection(SINGLE_RANGE_CENSUS);
    render(<CensusOverviewPage />);
    await screen.findByText(CENSUS_OVERVIEW_TEXT.exportPreviewHeading);
    expect(fetchedUrls(SUMMARY_URL_FRAGMENT)).toHaveLength(1);

    await user.click(screen.getByTestId('data-quality-refresh'));
    await waitFor(() => expect(fetchedUrls(REFRESH_URL_FRAGMENT)).toHaveLength(1));
    await waitFor(() => expect(fetchedUrls(SUMMARY_URL_FRAGMENT)).toHaveLength(2));
    await act(async () => {});
    console.log('[#547 refresh] summary requests:', JSON.stringify(fetchedUrls(SUMMARY_URL_FRAGMENT)));
    expect(fetchedUrls(SUMMARY_URL_FRAGMENT)).toHaveLength(2);
  });

  it('sends nothing for the old census when a refresh started there finishes after the switch, and leaves the new request running', async () => {
    const user = userEvent.setup();
    const refreshPost = createDeferred<Response>();
    refreshResponse = refreshPost.promise;
    seedSelection(SINGLE_RANGE_CENSUS);
    render(<CensusOverviewPage />);
    await screen.findByText(CENSUS_OVERVIEW_TEXT.exportPreviewHeading);

    await user.click(screen.getByTestId('data-quality-refresh'));
    await waitFor(() => expect(fetchedUrls(REFRESH_URL_FRAGMENT)).toHaveLength(1));

    const groupedCensusSummary = createDeferred<void>();
    summaryGate = groupedCensusSummary.promise;
    act(() => {
      useAppStore.getState().setCensus(GROUPED_CENSUS);
    });
    await waitFor(() => expect(fetchedUrls(SUMMARY_URL_FRAGMENT)).toHaveLength(2));

    await act(async () => {
      refreshPost.resolve(REFRESH_OK_RESPONSE);
    });
    await act(async () => {});
    const summaryRequests = summaryRequestLog();
    console.log(`[#547 refresh across scope change] summary requests ${JSON.stringify(summaryRequests)}`);

    expect(summaryRequests, 'no summary request goes out for the census the refresh started on').toHaveLength(2);
    expect(new URL(summaryRequests[1].url, URL_BASE).pathname.endsWith(`/${TEST_PLOT.plotID}/${GROUPED_CENSUS.dateRanges[0].censusID}`)).toBe(true);
    expect(summaryRequests[1].aborted, "the new census's in-flight summary request must not be aborted").toBe(false);

    await act(async () => {
      groupedCensusSummary.resolve();
    });
  });

  it("refetches the same scope's summary after a census delete, even though the census list refresh fails", async () => {
    const user = userEvent.setup();
    seedSelection(SINGLE_RANGE_CENSUS);
    render(<CensusOverviewPage />);
    await screen.findByText(CENSUS_OVERVIEW_TEXT.exportPreviewHeading);
    expect(fetchedUrls(SUMMARY_URL_FRAGMENT)).toHaveLength(1);

    await user.click(screen.getByTestId(DELETE_BUTTON_TEST_ID));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: MODAL_CONFIRM_LABEL }));

    await waitFor(() => expect(fetchedUrls(CLEAR_CENSUS_URL_FRAGMENT)).toHaveLength(1));
    await waitFor(() => expect(fetchedUrls(SUMMARY_URL_FRAGMENT)).toHaveLength(2));
    await act(async () => {});
    const summaryUrls = fetchedUrls(SUMMARY_URL_FRAGMENT);
    console.log('[#547 delete refetch] summary requests:', JSON.stringify(summaryUrls));
    expect(await screen.findByTestId(DELETE_ERROR_TEST_ID)).toHaveTextContent(CENSUS_LIST_REFRESH_FAILED_MESSAGE);
    expect(summaryUrls, 'a delete must not leave the card showing counts for the deleted measurements').toHaveLength(2);
    expect(summaryUrls[1]).toBe(summaryUrls[0]);
  });

  it('renders no Errors & Export Preview card and sends no summary request while the census has no ID yet', async () => {
    seedSelection(CENSUS_BEING_CREATED);
    render(<CensusOverviewPage />);
    await screen.findByText(CENSUS_OVERVIEW_TEXT.treesAndStemsTitle);
    await act(async () => {});

    console.log(`[#547 census without ID] summary requests ${JSON.stringify(fetchedUrls(SUMMARY_URL_FRAGMENT))}`);
    expect(fetchedUrls(SUMMARY_URL_FRAGMENT)).toHaveLength(0);
    expect(screen.queryByText(CENSUS_OVERVIEW_TEXT.errorsBoxTitle), 'a card with no scope would show its skeleton forever').toBeNull();
    expect(screen.queryByTestId(ERRORS_EXPORT_PREVIEW_CARD_TEST_ID)).toBeNull();
  });

  it('no longer shows the Personnel box', async () => {
    seedSelection(SINGLE_RANGE_CENSUS);
    render(<CensusOverviewPage />);
    await screen.findByText(TREE_COUNT_TEXT);

    expect(screen.queryByText(PERSONNEL_BOX_TITLE)).toBeNull();
  });

  it('sends the publish census in the path and every date-range census as the errors scope', async () => {
    seedSelection(GROUPED_CENSUS);
    render(<CensusOverviewPage />);

    await waitFor(() => expect(fetchedUrls(SUMMARY_URL_FRAGMENT)).toHaveLength(1));
    const requested = new URL(fetchedUrls(SUMMARY_URL_FRAGMENT)[0], URL_BASE);
    console.log(`[#547 grouped census] summary request ${requested.pathname}${requested.search}`);
    expect(requested.pathname.endsWith(`/${TEST_PLOT.plotID}/${GROUPED_CENSUS.dateRanges[0].censusID}`)).toBe(true);
    expect(requested.searchParams.get(CENSUS_OVERVIEW_ERROR_CENSUS_IDS_PARAM)).toBe('202,201');
  });

  it('lays the sections out in the spec order', async () => {
    seedSelection(SINGLE_RANGE_CENSUS);
    render(<CensusOverviewPage />);
    await screen.findByText(CENSUS_OVERVIEW_TEXT.exportPreviewHeading);

    const sections = [
      screen.getByText(CENSUS_OVERVIEW_TEXT.treesAndStemsTitle),
      screen.getByText(QUADRAT_COVERAGE_HEADING),
      screen.getByText(CENSUS_OVERVIEW_TEXT.errorsBoxTitle),
      screen.getByText(DATA_QUALITY_HEADING),
      screen.getByText(CENSUS_TOOLS_HEADING)
    ];
    for (let index = 1; index < sections.length; index++) {
      expect(isBefore(sections[index - 1], sections[index]), `${sections[index - 1].textContent} before ${sections[index].textContent}`).toBe(true);
    }
  });

  it('renders the Census Tools as links with their descriptions as tooltips', async () => {
    const user = userEvent.setup();
    seedSelection(SINGLE_RANGE_CENSUS);
    render(<CensusOverviewPage />);

    for (const tool of EXPECTED_CENSUS_TOOLS) {
      expect(screen.getByRole('link', { name: tool.label }), tool.label).toHaveAttribute('href', tool.href);
    }
    const viewErrors = EXPECTED_CENSUS_TOOLS[1];
    await user.hover(screen.getByRole('link', { name: viewErrors.label }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent(viewErrors.description);
  });
});
