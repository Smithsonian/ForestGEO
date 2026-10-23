import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSession } from 'next-auth/react';
import { usePathname, useRouter } from 'next/navigation';
import Sidebar from './sidebar';
import { useAppStore, markExplicitSelectionClear } from '@/config/store/appstore';

// Sidebar-level regression for R9 (#517): the sidebar must not clear dependent selections AFTER
// awaiting the parent's cookie write, or a slow old write wipes a newer selection. Real handlers,
// real compat-hooks dispatchers and the real store are used; only the cookie server action is
// replaced with promises the test resolves by hand.
vi.mock('next-auth/react');
vi.mock('next/navigation');

const { pendingCookieWrites, markSpy } = vi.hoisted(() => ({
  pendingCookieWrites: [] as Array<() => void>,
  markSpy: vi.fn()
}));

vi.mock('@/app/actions/cookiemanager', () => ({
  submitCookie: vi.fn(() => new Promise<void>(resolve => pendingCookieWrites.push(resolve)))
}));
vi.mock('@/config/store/appstore', async importOriginal => {
  const actual = await importOriginal<typeof import('@/config/store/appstore')>();
  return {
    ...actual,
    markExplicitSelectionClear: (...args: []) => {
      markSpy();
      return actual.markExplicitSelectionClear(...args);
    }
  };
});
vi.mock('@/app/contexts/datavalidityprovider', () => ({
  useDataValidityContext: () => ({
    validity: { attributes: true, species: true, quadrats: true },
    isChecking: false,
    isDataValid: true,
    shouldAddPlot: false,
    shouldAddCensus: false
  })
}));
vi.mock('@/components/client/modals/plotcardmodal', () => ({
  default: () => <div data-testid="plot-card-modal">Plot Card Modal</div>
}));

/** Resolve every pending (and subsequently queued) cookie write. */
const settleCookieWrites = async () => {
  for (let i = 0; i < 20; i++) {
    const batch = pendingCookieWrites.splice(0);
    if (batch.length === 0) await Promise.resolve();
    batch.forEach(resolve => resolve());
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });
  }
};

describe('Sidebar selection cascade (R9, #517)', () => {
  const siteA = { siteID: 1, siteName: 'Site A', schemaName: 'schemaa' };
  const siteB = { siteID: 2, siteName: 'Site B', schemaName: 'schemab' };
  const plotA = { plotID: 11, plotName: 'Plot A', numQuadrats: 4 };
  const plotB = { plotID: 22, plotName: 'Plot B', numQuadrats: 4 };
  const censusFor = (plotID: number, plotCensusNumber: number) => ({
    plotID,
    plotCensusNumber,
    censusIDs: [plotCensusNumber * 100],
    dateRanges: [{ censusID: plotCensusNumber * 100, startDate: new Date(2024, 0, 1), endDate: new Date(2024, 11, 31) }],
    description: `Census ${plotCensusNumber}`
  });

  const renderSidebar = () => render(<Sidebar siteListLoaded={false} coreDataLoaded={false} setCensusListLoaded={vi.fn()} />);

  beforeEach(() => {
    pendingCookieWrites.length = 0;
    markSpy.mockClear();
    global.ResizeObserver = vi.fn().mockImplementation(() => ({ observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() })) as any;
    (useRouter as any).mockReturnValue({ push: vi.fn() });
    (usePathname as any).mockReturnValue('/dashboard');
    (useSession as any).mockReturnValue({
      data: { user: { name: 'T', email: 't@example.com', userStatus: 'global', sites: [] } },
      status: 'authenticated'
    });
    useAppStore.getState().clearSelections();
    useAppStore.getState().setSiteList([siteA, siteB] as any);
    useAppStore.getState().setSite(siteA);
    useAppStore.getState().setPlotList([plotA, plotB] as any);
    useAppStore.getState().setPlot(plotA);
    useAppStore.getState().setCensusList([censusFor(11, 1)] as any);
    useAppStore.getState().setCensus(censusFor(11, 1));
    markSpy.mockClear();
  });

  afterEach(async () => {
    await settleCookieWrites();
    useAppStore.getState().clearSelections();
  });

  it('keeps a newly selected plot when the old site-clear cookie write finishes late', async () => {
    const user = userEvent.setup();
    renderSidebar();

    await user.click(screen.getByRole('combobox', { name: /select a site/i }));
    await user.click(within(await screen.findByRole('listbox')).getByRole('option', { name: 'Clear site selection' }));

    // Store cascade is synchronous: dependants are already gone while the cookie write is pending,
    // and the explicit-clear marker was set for the guarded persist storage.
    expect(useAppStore.getState().currentSite).toBeUndefined();
    expect(useAppStore.getState().currentPlot).toBeUndefined();
    expect(useAppStore.getState().currentCensus).toBeUndefined();
    expect(markSpy).toHaveBeenCalled();
    expect(pendingCookieWrites.length).toBeGreaterThan(0);

    await user.click(screen.getByRole('combobox', { name: /select a site/i }));
    await user.click(within(await screen.findByRole('listbox')).getByRole('option', { name: 'Select Site B site' }));
    expect(useAppStore.getState().currentSite?.siteID).toBe(2);

    act(() => useAppStore.getState().setPlotList([plotB] as any));
    await user.click(await screen.findByRole('combobox', { name: /select a plot/i }));
    await user.click(within(await screen.findByRole('listbox')).getByRole('option', { name: 'plot name option: Plot B' }));
    expect(useAppStore.getState().currentPlot?.plotID).toBe(22);

    // Old completion finally resolves: it must not clear the newer plot.
    await settleCookieWrites();
    expect(useAppStore.getState().currentSite?.siteID).toBe(2);
    expect(useAppStore.getState().currentPlot?.plotID).toBe(22);
  });

  it('keeps a newly selected census when the old plot-clear cookie write finishes late', async () => {
    const user = userEvent.setup();
    renderSidebar();

    await user.click(screen.getByRole('button', { name: 'Clear plot selection' }));
    expect(useAppStore.getState().currentPlot).toBeUndefined();
    expect(useAppStore.getState().currentCensus).toBeUndefined();
    expect(pendingCookieWrites.length).toBeGreaterThan(0);

    act(() => useAppStore.getState().setPlotList([plotA, plotB] as any));
    await user.click(await screen.findByRole('combobox', { name: /select a plot/i }));
    await user.click(within(await screen.findByRole('listbox')).getByRole('option', { name: 'plot name option: Plot B' }));
    expect(useAppStore.getState().currentPlot?.plotID).toBe(22);

    act(() => useAppStore.getState().setCensusList([censusFor(22, 1)] as any));
    await user.click(await screen.findByRole('combobox', { name: /select a census/i }));
    await user.click(within(await screen.findByRole('listbox')).getByRole('option', { name: /^Census 1/ }));
    await waitFor(() => expect(useAppStore.getState().currentCensus?.plotID).toBe(22));

    await settleCookieWrites();
    expect(useAppStore.getState().currentPlot?.plotID).toBe(22);
    expect(useAppStore.getState().currentCensus?.plotID).toBe(22);
  });

  it('exposes the real explicit-clear marker through the mocked module wrapper', () => {
    markExplicitSelectionClear();
    expect(markSpy).toHaveBeenCalledTimes(1);
  });
});
