/**
 * @fileoverview Component tests for the Census Overview page (UX finding F2).
 *
 * Census deletion was moved OFF the sidebar census picker (a destructive affordance
 * a few pixels from a control users click constantly) and onto this page's header.
 * The delete action must:
 * - Render as a danger button in the header.
 * - Be enabled ONLY when the selected census is the highest plotCensusNumber in the
 *   census list (the latest-census-only rule); disabled otherwise, with an explanatory tooltip.
 * - Open the shared CensusDeletionModal on click (same confirm-then-delete flow as the dashboard).
 *
 * @see app/(hub)/measurementshub/censusoverview/page.tsx
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useAppStore } from '@/config/store/appstore';
import { CENSUS_DELETE_GENERIC_FAILURE_MESSAGE } from '@/config/censusdeletion';
import CensusOverviewPage from './page';

const DELETE_BUTTON_TESTID = 'census-overview-delete-button';
const DELETE_ERROR_TESTID = 'census-overview-delete-error';
const DISABLED_TOOLTIP_MATCHER = /only the latest census can be deleted/i;
const UNAUTHORIZED_TOOLTIP_MATCHER = /only global and database administrators can delete census measurements/i;
const MODAL_CONFIRM_LABEL = 'Delete Census';
const CLEAR_CENSUS_ENDPOINT = '/api/clearcensus';
const LATEST_ONLY_REFUSAL = 'Only the latest census can be deleted. Delete newer censuses first.';
const CENSUS_ALREADY_DELETED_REFUSAL = 'That census no longer exists. It may have been deleted by someone else.';
const EMPTY_SELECTION_PROMPT_MATCHER = /please select a site, plot, and census/i;

vi.mock('next/navigation');
// setup.ts stubs this module and its mapper factory. Keep the real selection reconciler and
// hand the fetched census list through unmapped, as the test already serves OrgCensus-shaped rows.
vi.mock('@/lib/db/definitions/timekeeping', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/db/definitions/timekeeping')>()),
  createAndUpdateCensusList: async (censusList: unknown[]) => censusList
}));
vi.mock('next-auth/react');
vi.mock('@/ailogger', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() }
}));
vi.mock('@/app/contexts/loadingprovider', () => ({
  useLoading: () => ({ setLoading: vi.fn() })
}));
// Child widgets carry their own hooks/fetches; stub them so the page renders in isolation.
vi.mock('@/components/dashboard/dataqualitycard', () => ({
  default: () => <div data-testid="data-quality-card" />
}));
vi.mock('@/components/dashboard/publishcensusbutton', () => ({
  default: () => <div data-testid="publish-census-button" />
}));
vi.mock('@/components/dashboard/rebuildviewfulltablebutton', () => ({
  default: () => <div data-testid="rebuild-vft-button" />
}));

const TEST_SITE = { siteID: 1, siteName: 'Test Site', schemaName: 'testschema' };
const TEST_PLOT = { plotID: 1, plotName: 'Test Plot' };
const EARLIER_CENSUS = {
  plotID: 1,
  plotCensusNumber: 1,
  censusIDs: [101],
  dateRanges: [{ censusID: 101, startDate: new Date('2024-01-01'), endDate: new Date('2024-12-31') }],
  description: 'Census 1',
  isActive: true
};
const LATEST_CENSUS = {
  plotID: 1,
  plotCensusNumber: 2,
  censusIDs: [102],
  dateRanges: [{ censusID: 102, startDate: new Date('2025-01-01'), endDate: new Date('2025-12-31') }],
  description: 'Census 2',
  isActive: true
};
const INACTIVE_NEWER_CENSUS = {
  plotID: 1,
  plotCensusNumber: 3,
  censusIDs: [103],
  dateRanges: [{ censusID: 103, startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') }],
  description: 'Census 3 (inactive)',
  isActive: false
};
const CENSUS_LIST = [EARLIER_CENSUS, LATEST_CENSUS];

function seedSelection(currentCensus: typeof LATEST_CENSUS) {
  useAppStore.getState().setSite(TEST_SITE);
  useAppStore.getState().setPlot(TEST_PLOT);
  useAppStore.getState().setCensusList(CENSUS_LIST);
  useAppStore.getState().setCensus(currentCensus);
}

describe('CensusOverviewPage - F2 census deletion action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.getState().clearSelections();
    (useRouter as any).mockReturnValue({ push: vi.fn() });
    (useSession as any).mockReturnValue({
      data: { user: { name: 'Test User', email: 'test@example.com', userStatus: 'global' } },
      status: 'authenticated'
    });
    // loadMetrics fires on mount; a non-ok response is caught and logged, keeping the test hermetic.
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) }) as any;
  });

  afterEach(() => {
    useAppStore.getState().clearSelections();
  });

  it('MUST render a danger delete-census action in the header', () => {
    seedSelection(LATEST_CENSUS);
    render(<CensusOverviewPage />);

    const deleteButton = screen.getByTestId(DELETE_BUTTON_TESTID);
    expect(deleteButton).toBeInTheDocument();
    expect(deleteButton).toHaveTextContent(/delete census/i);
  });

  it('MUST enable the delete action when the selected census is the latest', () => {
    seedSelection(LATEST_CENSUS);
    render(<CensusOverviewPage />);

    expect(screen.getByTestId(DELETE_BUTTON_TESTID)).not.toBeDisabled();
  });

  it('MUST enable the delete action for the latest ACTIVE census even when a higher-numbered inactive census exists (#525)', () => {
    useAppStore.getState().setSite(TEST_SITE);
    useAppStore.getState().setPlot(TEST_PLOT);
    useAppStore.getState().setCensusList([EARLIER_CENSUS, LATEST_CENSUS, INACTIVE_NEWER_CENSUS]);
    useAppStore.getState().setCensus(LATEST_CENSUS);
    render(<CensusOverviewPage />);

    const deleteButton = screen.getByTestId(DELETE_BUTTON_TESTID);
    console.log(`[#525 items 2+3] Census Hub delete disabled with an inactive census 3 present: ${(deleteButton as HTMLButtonElement).disabled}`);
    expect(deleteButton).not.toBeDisabled();
  });

  it('MUST disable the delete action (with explanatory tooltip) for a non-latest census', async () => {
    const user = userEvent.setup();
    seedSelection(EARLIER_CENSUS);
    render(<CensusOverviewPage />);

    const deleteButton = screen.getByTestId(DELETE_BUTTON_TESTID);
    expect(deleteButton).toBeDisabled();

    // The wrapping tooltip must explain WHY it is disabled, not leave the user guessing.
    await user.hover(deleteButton.parentElement as HTMLElement);
    expect(await screen.findByText(DISABLED_TOOLTIP_MATCHER)).toBeInTheDocument();
  });

  it('MUST disable the delete action for non-admin users even when the census is latest', async () => {
    const user = userEvent.setup();
    (useSession as any).mockReturnValue({
      data: { user: { name: 'Field User', email: 'field@example.com', userStatus: 'field crew' } },
      status: 'authenticated'
    });
    seedSelection(LATEST_CENSUS);
    render(<CensusOverviewPage />);

    const deleteButton = screen.getByTestId(DELETE_BUTTON_TESTID);
    expect(deleteButton).toBeDisabled();

    await user.hover(deleteButton.parentElement as HTMLElement);
    expect(await screen.findByText(UNAUTHORIZED_TOOLTIP_MATCHER)).toBeInTheDocument();
  });

  it('MUST open the shared CensusDeletionModal for the selected census on click', async () => {
    const user = userEvent.setup();
    seedSelection(LATEST_CENSUS);
    render(<CensusOverviewPage />);

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    await user.click(screen.getByTestId(DELETE_BUTTON_TESTID));

    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(`Delete Census ${LATEST_CENSUS.plotCensusNumber}?`)).toBeInTheDocument();
  });

  it('MUST render the header census dates using the shared display-date format (F3)', () => {
    // Local-time constructors keep the rendered display date timezone-stable across CI runners.
    const headerCensus = {
      plotID: 1,
      plotCensusNumber: 2,
      censusIDs: [102],
      dateRanges: [{ censusID: 102, startDate: new Date(2025, 0, 1), endDate: new Date(2025, 11, 31) }],
      description: 'Census 2',
      isActive: true
    };
    seedSelection(headerCensus as any);
    render(<CensusOverviewPage />);

    const headerLine = screen.getByText((_, el) => {
      if (el?.tagName.toLowerCase() !== 'p') return false;
      const text = el.textContent ?? '';
      return text.includes('Test Plot') && text.includes('Test Site');
    });

    expect(headerLine.textContent).toContain('— Jan 1, 2025 to Dec 31, 2025');
    // The old toLocaleDateString output ("1/1/2025") must be gone.
    expect(headerLine.textContent).not.toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/);
  });

  it('MUST surface a user-visible error banner when the delete request fails', async () => {
    const user = userEvent.setup();
    seedSelection(LATEST_CENSUS);
    // The global fetch mock returns 500 for everything, so the confirm-delete
    // /api/clearcensus call fails; the failure must NOT be swallowed into the log.
    (global.fetch as any).mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    render(<CensusOverviewPage />);

    expect(screen.queryByTestId(DELETE_ERROR_TESTID)).not.toBeInTheDocument();

    await user.click(screen.getByTestId(DELETE_BUTTON_TESTID));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: MODAL_CONFIRM_LABEL }));

    const errorBanner = await screen.findByTestId(DELETE_ERROR_TESTID);
    expect(errorBanner).toHaveTextContent(CENSUS_DELETE_GENERIC_FAILURE_MESSAGE);
  });

  it("MUST show the server's refusal reason verbatim when /api/clearcensus answers 409", async () => {
    const user = userEvent.setup();
    seedSelection(LATEST_CENSUS);
    (global.fetch as any).mockImplementation(async (url: string) =>
      url === CLEAR_CENSUS_ENDPOINT
        ? { ok: false, status: 409, json: async () => ({ error: LATEST_ONLY_REFUSAL }) }
        : { ok: false, status: 503, json: async () => ({}) }
    );
    render(<CensusOverviewPage />);

    await user.click(screen.getByTestId(DELETE_BUTTON_TESTID));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: MODAL_CONFIRM_LABEL }));

    const errorBanner = await screen.findByTestId(DELETE_ERROR_TESTID);
    console.log(`[#525 hub refusal] banner text: ${errorBanner.textContent}`);
    expect(errorBanner).toHaveTextContent(LATEST_ONLY_REFUSAL);
    expect(errorBanner).not.toHaveTextContent(CENSUS_DELETE_GENERIC_FAILURE_MESSAGE);
  });

  describe('refreshing the census list after a refusal', () => {
    const CENSUS_LIST_URL_FRAGMENT = '/api/fetchall/census/';

    function censusListFetchUrls() {
      return vi
        .mocked(global.fetch)
        .mock.calls.map(([url]) => String(url))
        .filter(url => url.includes(CENSUS_LIST_URL_FRAGMENT));
    }

    async function confirmDeleteWithClearCensusAnswering(clearCensusAnswer: object, censusListAnswer: () => Promise<object>) {
      const user = userEvent.setup();
      seedSelection(LATEST_CENSUS);
      (global.fetch as any).mockImplementation(async (url: string) => {
        if (url === CLEAR_CENSUS_ENDPOINT) return clearCensusAnswer;
        if (String(url).includes(CENSUS_LIST_URL_FRAGMENT)) return censusListAnswer();
        return { ok: false, status: 503, json: async () => ({}) };
      });
      render(<CensusOverviewPage />);
      await user.click(screen.getByTestId(DELETE_BUTTON_TESTID));
      const dialog = await screen.findByRole('alertdialog');
      await user.click(within(dialog).getByRole('button', { name: MODAL_CONFIRM_LABEL }));
      return screen.findByTestId(DELETE_ERROR_TESTID);
    }

    it('refreshes the census list once after a 409 and still shows the server text', async () => {
      const errorBanner = await confirmDeleteWithClearCensusAnswering(
        { ok: false, status: 409, json: async () => ({ error: LATEST_ONLY_REFUSAL }) },
        async () => ({
          ok: true,
          status: 200,
          json: async () => [{ ...LATEST_CENSUS }]
        })
      );

      expect(errorBanner).toHaveTextContent(LATEST_ONLY_REFUSAL);
      console.log(`[#525 hub refused delete] census list fetches: ${JSON.stringify(censusListFetchUrls())}`);
      expect(censusListFetchUrls()).toHaveLength(1);
    });

    it('still shows the server text after a 404 whose refreshed list no longer contains the selected census', async () => {
      await confirmDeleteWithClearCensusAnswering({ ok: false, status: 404, json: async () => ({ error: CENSUS_ALREADY_DELETED_REFUSAL }) }, async () => ({
        ok: true,
        status: 200,
        json: async () => [{ ...EARLIER_CENSUS }]
      }));

      await screen.findByText(EMPTY_SELECTION_PROMPT_MATCHER);
      const errorBanner = screen.queryByTestId(DELETE_ERROR_TESTID);
      console.log(`[#525 hub refused delete] selection emptied; banner text: ${errorBanner?.textContent ?? 'no banner rendered'}`);
      expect(errorBanner).toHaveTextContent(CENSUS_ALREADY_DELETED_REFUSAL);
    });

    it('still shows the server text when the refresh itself fails', async () => {
      const errorBanner = await confirmDeleteWithClearCensusAnswering(
        { ok: false, status: 409, json: async () => ({ error: LATEST_ONLY_REFUSAL }) },
        async () => {
          throw new TypeError('network down');
        }
      );

      expect(errorBanner).toHaveTextContent(LATEST_ONLY_REFUSAL);
      expect(censusListFetchUrls()).toHaveLength(1);
    });

    it('does not refresh the census list after a 500', async () => {
      const errorBanner = await confirmDeleteWithClearCensusAnswering(
        { ok: false, status: 500, json: async () => ({ error: 'ER_LOCK_DEADLOCK' }) },
        async () => ({
          ok: true,
          status: 200,
          json: async () => []
        })
      );

      expect(errorBanner).toHaveTextContent(CENSUS_DELETE_GENERIC_FAILURE_MESSAGE);
      expect(censusListFetchUrls()).toHaveLength(0);
    });
  });
});
