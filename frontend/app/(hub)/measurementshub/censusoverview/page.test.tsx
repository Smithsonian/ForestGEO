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
import CensusOverviewPage from './page';

const DELETE_BUTTON_TESTID = 'census-overview-delete-button';
const DELETE_ERROR_TESTID = 'census-overview-delete-error';
const DISABLED_TOOLTIP_MATCHER = /only the latest census can be deleted/i;
const UNAUTHORIZED_TOOLTIP_MATCHER = /only global and database administrators can delete census measurements/i;
const DELETE_FAILURE_MESSAGE = 'Failed to delete census. Please try again.';
const MODAL_CONFIRM_LABEL = 'Delete Census';

vi.mock('next/navigation');
vi.mock('next-auth/react');
vi.mock('@/ailogger', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() }
}));
vi.mock('@/app/contexts/loadingprovider', () => ({
  useLoading: () => ({ setLoading: vi.fn() })
}));
// Child widgets carry their own hooks/fetches; stub them so the page renders in isolation.
vi.mock('@/components/dashboard/censusstatsview', () => ({
  default: () => <div data-testid="census-stats-view" />
}));
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
  description: 'Census 1'
};
const LATEST_CENSUS = {
  plotID: 1,
  plotCensusNumber: 2,
  censusIDs: [102],
  dateRanges: [{ censusID: 102, startDate: new Date('2025-01-01'), endDate: new Date('2025-12-31') }],
  description: 'Census 2'
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
      description: 'Census 2'
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
    expect(errorBanner).toHaveTextContent(DELETE_FAILURE_MESSAGE);
  });
});
