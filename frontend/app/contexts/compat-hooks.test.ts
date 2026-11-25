/**
 * Selection dispatch compatibility hooks (#517): a site/plot change cascades in the
 * store, and the cookies of the dependants the cascade dropped are cleared too so
 * server-side cookie reads never see a plotID/censusID from the previous scope.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useAppStore } from '@/config/store/appstore';
import { useOrgCensusDispatch, usePlotDispatch, useRestoreSelectionCookies, useSiteDispatch } from './compat-hooks';
import { submitCookie } from '@/app/actions/cookiemanager';
import { OrgCensus } from '@/lib/db/definitions/timekeeping';

vi.mock('@/app/actions/cookiemanager', () => ({ submitCookie: vi.fn().mockResolvedValue(undefined) }));

const siteA = { siteID: 1, siteName: 'A', schemaName: 'a' };
const siteB = { siteID: 2, siteName: 'B', schemaName: 'b' };
const plot1 = { plotID: 1, plotName: 'P1' };
const plot2 = { plotID: 2, plotName: 'P2' };
const census = { plotID: 1, plotCensusNumber: 1, censusIDs: [1], dateRanges: [], description: '', isActive: true } as OrgCensus;

describe('selection dispatch hooks', () => {
  beforeEach(() => {
    vi.mocked(submitCookie).mockReset().mockResolvedValue(undefined);
    useAppStore.setState({ currentSite: siteA, currentPlot: plot1, currentCensus: census });
  });

  it('a site switch clears plot and census in the store and their cookies', async () => {
    const { result } = renderHook(() => useSiteDispatch());

    await result.current!({ site: siteB });

    const state = useAppStore.getState();
    expect(state.currentSite).toBe(siteB);
    expect(state.currentPlot).toBeUndefined();
    expect(state.currentCensus).toBeUndefined();
    expect(submitCookie).toHaveBeenCalledWith('schema', 'b');
    expect(submitCookie).toHaveBeenCalledWith('plotID', '');
    expect(submitCookie).toHaveBeenCalledWith('censusID', '');
  });

  it('a plot switch clears the census (and its cookie) but not the site', async () => {
    const { result } = renderHook(() => usePlotDispatch());

    await result.current!({ plot: plot2 });

    const state = useAppStore.getState();
    expect(state.currentSite).toBe(siteA);
    expect(state.currentPlot).toBe(plot2);
    expect(state.currentCensus).toBeUndefined();
    expect(submitCookie).toHaveBeenCalledWith('plotID', '2');
    expect(submitCookie).toHaveBeenCalledWith('censusID', '');
    expect(submitCookie).not.toHaveBeenCalledWith('schema', expect.anything());
  });

  it('updates the store synchronously, before any cookie write completes', async () => {
    let releaseCookie!: () => void;
    vi.mocked(submitCookie).mockImplementationOnce(() => new Promise<void>(resolve => (releaseCookie = resolve)));
    const { result } = renderHook(() => usePlotDispatch());

    const pending = result.current!({ plot: plot2 });

    expect(useAppStore.getState().currentPlot).toBe(plot2);
    await new Promise(resolve => setTimeout(resolve, 0));
    releaseCookie();
    await pending;
  });

  it('a slow cookie write for an older selection cannot restore it over a newer selection', async () => {
    const writes: Array<{ name: string; value: string }> = [];
    let releaseFirst!: () => void;
    vi.mocked(submitCookie).mockImplementation(async (name: string, value: string) => {
      writes.push({ name, value });
      if (name === 'plotID' && value === '2') await new Promise<void>(resolve => (releaseFirst = resolve));
    });
    const { result } = renderHook(() => usePlotDispatch());

    const older = result.current!({ plot: plot2 });
    await new Promise(resolve => setTimeout(resolve, 0));
    const newer = result.current!({ plot: plot1 });

    // Latest intent is already in the store while the older cookie write is still in flight.
    expect(useAppStore.getState().currentPlot).toBe(plot1);

    releaseFirst();
    await Promise.all([older, newer]);

    const plotWrites = writes.filter(w => w.name === 'plotID').map(w => w.value);
    expect(plotWrites[plotWrites.length - 1]).toBe('1');
    expect(useAppStore.getState().currentPlot).toBe(plot1);
  });

  it('skips a cookie write whose value was superseded before it started', async () => {
    const { result } = renderHook(() => usePlotDispatch());

    await Promise.all([result.current!({ plot: plot2 }), result.current!({ plot: plot1 })]);

    const plotWrites = vi
      .mocked(submitCookie)
      .mock.calls.filter(([name]) => name === 'plotID')
      .map(([, value]) => value);
    expect(plotWrites).toEqual(['1']);
  });

  describe('after a reload (#516)', () => {
    const censusWithID = { ...census, plotCensusNumber: 3, dateRanges: [{ censusID: 71 }] } as OrgCensus;
    const quadrat = { quadratID: 9, quadratName: 'Q9' };
    const cookieWrites = () => vi.mocked(submitCookie).mock.calls.map(([name, value]) => `${name}=${value}`);

    it('writes the rehydrated selection back to the cookies the unload beacon deleted', async () => {
      useAppStore.setState({ hasHydrated: true, currentCensus: censusWithID, currentQuadrat: quadrat as never });

      renderHook(() => useRestoreSelectionCookies());

      await waitFor(() => expect(submitCookie).toHaveBeenCalledTimes(4));
      console.log(`[#516] cookie writes after rehydration: ${JSON.stringify(cookieWrites())}`);
      expect(cookieWrites()).toEqual(expect.arrayContaining(['schema=a', 'plotID=1', 'censusID=71', 'quadratID=9']));
    });

    it('waits for rehydration, so the pre-hydration empty store never blanks the cookies', async () => {
      useAppStore.setState({ hasHydrated: false, currentSite: undefined, currentPlot: undefined, currentCensus: undefined });
      const { rerender } = renderHook(() => useRestoreSelectionCookies());
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(cookieWrites(), 'nothing is written before the store has rehydrated').toEqual([]);

      act(() => useAppStore.setState({ hasHydrated: true, currentSite: siteA, currentPlot: plot1, currentCensus: censusWithID, currentQuadrat: undefined }));
      rerender();

      await waitFor(() => expect(cookieWrites()).toContain('censusID=71'));
      expect(cookieWrites()).toEqual(expect.arrayContaining(['schema=a', 'plotID=1', 'censusID=71', 'quadratID=']));
    });

    it('lets a census picked right after the reload win over the restored one', async () => {
      useAppStore.setState({ hasHydrated: true, currentCensus: censusWithID });
      let releaseRestore!: () => void;
      vi.mocked(submitCookie).mockImplementation(async (name: string) => {
        if (name === 'censusID' && !releaseRestore) await new Promise<void>(resolve => (releaseRestore = resolve));
      });
      renderHook(() => useRestoreSelectionCookies());
      const { result } = renderHook(() => useOrgCensusDispatch());
      await waitFor(() => expect(releaseRestore).toBeDefined());

      const picked = result.current!({ census: { ...censusWithID, plotCensusNumber: 4, dateRanges: [{ censusID: 72 }] } as OrgCensus });
      releaseRestore();
      await picked;

      const censusWrites = vi
        .mocked(submitCookie)
        .mock.calls.filter(([name]) => name === 'censusID')
        .map(([, value]) => value);
      console.log(`[#516] censusID writes when a pick follows the restore: ${JSON.stringify(censusWrites)}`);
      expect(censusWrites.at(-1)).toBe('72');
    });
  });

  it('re-selecting the same site leaves plot/census and their cookies alone', async () => {
    const { result } = renderHook(() => useSiteDispatch());

    await result.current!({ site: { ...siteA } });

    expect(useAppStore.getState().currentPlot).toBe(plot1);
    expect(submitCookie).toHaveBeenCalledTimes(1);
  });
});
