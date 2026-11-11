/**
 * Hub layout list loading (#517 R1): plot/census/quadrat lists are loaded per exact scope,
 * stale completions are ignored, and the current census is refreshed from the current-scope
 * census list even when its ID is unchanged.
 */

import React from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { allsites: [{ siteID: 1, siteName: 'A', schemaName: 'a' }], permissionsUnavailable: false } } })
}));
vi.mock('next/navigation', () => ({ redirect: vi.fn(), usePathname: () => '/dashboard' }));
vi.mock('@mui/material/useMediaQuery', () => ({ default: () => true }));
vi.mock('@axe-core/react', () => ({ default: () => Promise.resolve() }));
vi.mock('@/components/sidebar', () => ({ default: () => null }));
vi.mock('@/components/header', () => ({ default: () => null }));
vi.mock('@/components/client/uploadjobstatusbadge', () => ({ default: () => null }));
vi.mock('@/components/client/modals/githubfeedbackmodal', () => ({ default: () => null }));
vi.mock('@/app/contexts/lockanimationcontext', () => ({ useLockAnimation: () => ({ isPulsing: false }) }));
vi.mock('@/app/hooks/useAsyncOperation', () => ({
  useAsyncOperation: (fn: () => Promise<unknown>) => ({ execute: () => fn() })
}));
vi.mock('@/app/actions/cookiemanager', () => ({ submitCookie: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/db/definitions/timekeeping', () => ({
  // Rows are already in OrgCensus shape in these tests.
  createAndUpdateCensusList: async (rows: unknown[]) => rows,
  reconcileCurrentCensusSelection: (current: any, list: any[]) =>
    list.find(c => c.dateRanges?.some((r: any) => r.censusID === current.dateRanges?.[0]?.censusID)) ??
    list.find(c => c.plotCensusNumber === current.plotCensusNumber)
}));

import HubLayout from './layout';
import { useAppStore } from '@/config/store/appstore';

const siteA = { siteID: 1, siteName: 'A', schemaName: 'a' };
const siteB = { siteID: 2, siteName: 'B', schemaName: 'b' };
const plot1 = { plotID: 1, plotName: 'P1' };
const plot2 = { plotID: 2, plotName: 'P2' };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => (resolve = res));
  return { promise, resolve };
}
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;
const urls = () => vi.mocked(global.fetch).mock.calls.map(([u]) => String(u));
const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe('HubLayout scope-aware list loading', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
    useAppStore.setState({
      currentSite: undefined,
      currentPlot: undefined,
      currentCensus: undefined,
      currentQuadrat: undefined,
      plotList: [],
      censusList: [],
      quadratList: [],
      hasHydrated: true
    });
  });

  it('ignores a delayed plot-list response for the old site after a new site is selected, and still starts the new load', async () => {
    const slowA = deferred<Response>();
    vi.mocked(global.fetch).mockImplementation((u: any) => {
      const url = String(u);
      if (url.includes('/plots/0/0?schema=a')) return slowA.promise;
      if (url.includes('/plots/0/0?schema=b')) return Promise.resolve(ok([{ plotID: 20, plotName: 'B plot' }]));
      return Promise.resolve(ok([]));
    });
    useAppStore.setState({ currentSite: siteA as any });
    render(<HubLayout>child</HubLayout>);
    await waitFor(() => expect(urls().some(u => u.includes('schema=a'))).toBe(true));

    // A new-scope load starts while the previous one is still in flight.
    act(() => useAppStore.getState().setSite(siteB as any));
    await waitFor(() => expect(urls().some(u => u.includes('/plots/0/0?schema=b'))).toBe(true));
    await waitFor(() => expect(useAppStore.getState().plotList).toEqual([{ plotID: 20, plotName: 'B plot' }]));

    slowA.resolve(ok([{ plotID: 10, plotName: 'A plot' }]));
    await flush();

    expect(useAppStore.getState().plotList).toEqual([{ plotID: 20, plotName: 'B plot' }]);
  });

  it('ignores a delayed census-list response (and does not reconcile its census) after the plot changed', async () => {
    const slowPlot1 = deferred<Response>();
    vi.mocked(global.fetch).mockImplementation((u: any) => {
      const url = String(u);
      if (url.includes('/census/1/0')) return slowPlot1.promise;
      if (url.includes('/census/2/0'))
        return Promise.resolve(ok([{ plotID: 2, plotCensusNumber: 1, censusIDs: [200], dateRanges: [{ censusID: 200 }], description: '' }]));
      return Promise.resolve(ok([]));
    });
    useAppStore.setState({ currentSite: siteA as any, currentPlot: plot1 as any });
    render(<HubLayout>child</HubLayout>);
    await waitFor(() => expect(urls().some(u => u.includes('/census/1/0'))).toBe(true));

    act(() => useAppStore.getState().setPlot(plot2 as any));
    await waitFor(() => expect(useAppStore.getState().censusList).toHaveLength(1));

    slowPlot1.resolve(ok([{ plotID: 1, plotCensusNumber: 5, censusIDs: [100], dateRanges: [{ censusID: 100 }], description: '' }]));
    await flush();

    expect(useAppStore.getState().censusList.map(c => c?.censusIDs)).toEqual([[200]]);
    expect(useAppStore.getState().currentCensus).toBeUndefined();
  });

  it('clears the dependent lists atomically when the site changes, before any new response arrives', async () => {
    vi.mocked(global.fetch).mockImplementation(() => new Promise(() => undefined));
    useAppStore.setState({
      currentSite: siteA as any,
      currentPlot: plot1 as any,
      plotList: [{ plotID: 1 }] as any,
      censusList: [{ plotCensusNumber: 1 }] as any,
      quadratList: [{ quadratID: 1 }] as any
    });
    render(<HubLayout>child</HubLayout>);

    act(() => useAppStore.getState().setSite(siteB as any));

    const state = useAppStore.getState();
    expect(state.plotList).toEqual([]);
    expect(state.censusList).toEqual([]);
    expect(state.quadratList).toEqual([]);
    expect(state.currentPlot).toBeUndefined();
  });

  it('replaces legacy persisted census metadata with the explicit fields when the census ID is unchanged', async () => {
    const fresh = {
      plotID: 1,
      plotCensusNumber: 1,
      censusIDs: [7],
      dateRanges: [{ censusID: 7, censusStartDate: '2024-01-01', censusEndDate: '2024-12-31', firstMeasurementDate: null, lastMeasurementDate: null }],
      description: ''
    };
    vi.mocked(global.fetch).mockImplementation((u: any) => Promise.resolve(String(u).includes('/census/1/0') ? ok([fresh]) : ok([])));
    const legacy = { plotID: 1, plotCensusNumber: 1, censusIDs: [7], dateRanges: [{ censusID: 7, startDate: '2024-01-01' }], description: '' };
    useAppStore.setState({ currentSite: siteA as any, currentPlot: plot1 as any, currentCensus: legacy as any });
    render(<HubLayout>child</HubLayout>);

    await waitFor(() =>
      expect(useAppStore.getState().currentCensus?.dateRanges?.[0]).toMatchObject({ censusStartDate: '2024-01-01', censusEndDate: '2024-12-31' })
    );
    expect(useAppStore.getState().currentCensus?.dateRanges?.[0]).toHaveProperty('lastMeasurementDate', null);
  });
});
