/**
 * Guarded selection persistence tests (bug F7).
 *
 * zustand's persist middleware rewrites the whole partialized state on ANY
 * set(), so a single spurious writer used to wipe the persisted
 * site/plot/census with `{"state":{}}`. The guarded storage must:
 * - block an UNMARKED all-empty write over a persisted non-empty selection
 *   (and raise the dev console.trace regression alarm), and
 * - allow every deliberate clear path (clearSelections, reset, and the
 *   markExplicitSelectionClear + cascading-dispatch shape used by the hub
 *   layout's manual reset and the sidebar's user deselect) to fully empty
 *   storage without raising the alarm.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { markExplicitSelectionClear, useAppStore } from './appstore';
import { Plot, Site } from '@/lib/db/definitions/zones';
import { OrgCensus } from '@/lib/db/definitions/timekeeping';

const STORAGE_KEY = 'forestgeo-storage';

const testSite: Site = { siteID: 1, siteName: 'Luquillo', schemaName: 'luquillo' };
const testPlot: Plot = { plotID: 1, plotName: 'Luquillo Main Plot' };
const testCensus: OrgCensus = {
  plotID: 1,
  plotCensusNumber: 1,
  censusIDs: [1],
  dateRanges: [],
  description: 'First census',
  isActive: true
};

const readPersistedSelections = (): Record<string, unknown> => {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw ? (JSON.parse(raw).state ?? {}) : {};
};

const seedSelections = () => {
  const { setSite, setPlot, setCensus } = useAppStore.getState();
  setSite(testSite);
  setPlot(testPlot);
  setCensus(testCensus);
};

describe('guarded selection persistence (F7)', () => {
  let traceSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    window.localStorage.removeItem(STORAGE_KEY);
    useAppStore.getState().clearSelections();
    traceSpy = vi.spyOn(console, 'trace').mockImplementation(() => undefined);
  });

  afterEach(() => {
    traceSpy.mockRestore();
  });

  it('persists selections to localStorage as they are set', () => {
    seedSelections();

    const state = readPersistedSelections();
    expect(state.currentSite, 'currentSite persisted').toMatchObject({ siteID: 1 });
    expect(state.currentPlot, 'currentPlot persisted').toMatchObject({ plotID: 1 });
    expect(state.currentCensus, 'currentCensus persisted').toMatchObject({ plotCensusNumber: 1 });
  });

  it('blocks an unmarked all-empty write over a persisted selection and raises the trace alarm', () => {
    seedSelections();

    useAppStore.setState({ currentSite: undefined, currentPlot: undefined, currentCensus: undefined, currentQuadrat: undefined });

    expect(readPersistedSelections().currentSite, 'storage kept the selection despite the wipe attempt').toMatchObject({ siteID: 1 });
    expect(traceSpy, 'regression alarm fired for the blocked wipe').toHaveBeenCalledTimes(1);
  });

  it('clearSelections() empties storage without raising the alarm', () => {
    seedSelections();

    useAppStore.getState().clearSelections();

    expect(readPersistedSelections()).toEqual({});
    expect(traceSpy).not.toHaveBeenCalled();
  });

  it('reset() empties storage without raising the alarm', () => {
    seedSelections();

    useAppStore.getState().reset();

    expect(readPersistedSelections()).toEqual({});
    expect(traceSpy).not.toHaveBeenCalled();
  });

  it('a marked cascading clear (manual reset / user deselect shape) fully empties storage without raising the alarm', () => {
    seedSelections();

    // Mirrors app/(hub)/layout.tsx clearContexts() and the sidebar deselect
    // cascade: one marker, then site -> plot -> census cleared through
    // separate set() calls. Each intermediate write is non-empty; only the
    // final all-empty write consumes the marker.
    markExplicitSelectionClear();
    const { setSite, setPlot, setCensus } = useAppStore.getState();
    setSite(undefined);
    setPlot(undefined);
    setCensus(undefined);

    expect(readPersistedSelections()).toEqual({});
    expect(traceSpy).not.toHaveBeenCalled();
  });

  it('consumes the explicit-clear marker so a later unmarked wipe is still blocked', () => {
    seedSelections();
    useAppStore.getState().clearSelections();
    expect(readPersistedSelections()).toEqual({});

    seedSelections();
    useAppStore.setState({ currentSite: undefined, currentPlot: undefined, currentCensus: undefined, currentQuadrat: undefined });

    expect(readPersistedSelections().currentSite, 'marker did not linger past its clear').toMatchObject({ siteID: 1 });
    expect(traceSpy).toHaveBeenCalledTimes(1);
  });
});

describe('selection cascade (issue #517)', () => {
  const otherSite: Site = { siteID: 2, siteName: 'Other', schemaName: 'other' };
  const otherPlot: Plot = { plotID: 2, plotName: 'Other Plot' };
  const otherCensus: OrgCensus = { ...testCensus, plotID: 2, plotCensusNumber: 2, censusIDs: [2] };
  let traceSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    window.localStorage.removeItem(STORAGE_KEY);
    useAppStore.getState().clearSelections();
    traceSpy = vi.spyOn(console, 'trace').mockImplementation(() => undefined);
  });

  afterEach(() => {
    traceSpy.mockRestore();
  });

  it('changing the site clears plot, census and quadrat in the same update', () => {
    seedSelections();
    useAppStore.getState().setQuadrat({ quadratID: 5 } as any);
    const snapshots: Array<[unknown, unknown, unknown]> = [];
    const unsubscribe = useAppStore.subscribe(s => snapshots.push([s.currentSite, s.currentPlot, s.currentCensus]));

    useAppStore.getState().setSite(otherSite);
    unsubscribe();

    const state = useAppStore.getState();
    expect(state.currentSite).toBe(otherSite);
    expect(state.currentPlot).toBeUndefined();
    expect(state.currentCensus).toBeUndefined();
    expect(state.currentQuadrat).toBeUndefined();
    // atomic: no intermediate state paired the new site with the old plot/census
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toEqual([otherSite, undefined, undefined]);
  });

  it('changing the plot clears the census (and quadrat) but keeps the site', () => {
    seedSelections();

    useAppStore.getState().setPlot(otherPlot);

    const state = useAppStore.getState();
    expect(state.currentSite).toBe(testSite);
    expect(state.currentPlot).toBe(otherPlot);
    expect(state.currentCensus).toBeUndefined();
  });

  it('changing the census leaves site and plot alone', () => {
    seedSelections();

    useAppStore.getState().setCensus(otherCensus);

    const state = useAppStore.getState();
    expect(state.currentSite).toBe(testSite);
    expect(state.currentPlot).toBe(testPlot);
    expect(state.currentCensus).toBe(otherCensus);
  });

  it('re-selecting the same site or plot (even as a new object) does not clear dependants', () => {
    seedSelections();

    useAppStore.getState().setSite({ ...testSite });
    useAppStore.getState().setPlot({ ...testPlot });

    const state = useAppStore.getState();
    expect(state.currentPlot).toMatchObject({ plotID: 1 });
    expect(state.currentCensus).toBe(testCensus);
  });

  it('a first selection (nothing previously selected) does not clear restored dependants', () => {
    useAppStore.setState({ currentCensus: testCensus });

    useAppStore.getState().setPlot(testPlot);

    expect(useAppStore.getState().currentCensus).toBe(testCensus);
  });

  it('deselecting the site clears the whole chain', () => {
    seedSelections();
    markExplicitSelectionClear();

    useAppStore.getState().setSite(undefined);

    const state = useAppStore.getState();
    expect(state.currentPlot).toBeUndefined();
    expect(state.currentCensus).toBeUndefined();
    expect(readPersistedSelections()).toEqual({});
    expect(traceSpy).not.toHaveBeenCalled();
  });

  it('persists the cascaded selection', () => {
    seedSelections();

    useAppStore.getState().setSite(otherSite);

    const persisted = readPersistedSelections();
    expect(persisted.currentSite).toMatchObject({ siteID: 2 });
    expect(persisted.currentPlot).toBeUndefined();
    expect(persisted.currentCensus).toBeUndefined();
  });

  it('rehydrating persisted selections is not wiped by the cascade', async () => {
    seedSelections();
    // blocked by the guarded storage, so the persisted selection stays intact
    useAppStore.setState({ currentSite: undefined, currentPlot: undefined, currentCensus: undefined });

    await useAppStore.persist.rehydrate();

    const state = useAppStore.getState();
    expect(state.currentSite).toMatchObject({ siteID: 1 });
    expect(state.currentPlot).toMatchObject({ plotID: 1 });
    expect(state.currentCensus).toMatchObject({ plotCensusNumber: 1 });
  });
});

describe('dependent list clearing (issue #517 R1)', () => {
  const otherSite: Site = { siteID: 2, siteName: 'Other', schemaName: 'other' };
  const otherPlot: Plot = { plotID: 2, plotName: 'Other Plot' };
  let traceSpy: ReturnType<typeof vi.spyOn>;

  const seedLists = () => {
    useAppStore.setState({
      plotList: [{ plotID: 1 }] as any,
      censusList: [testCensus] as any,
      quadratList: [{ quadratID: 1 }] as any
    });
  };

  beforeEach(() => {
    window.localStorage.removeItem(STORAGE_KEY);
    useAppStore.getState().clearSelections();
    traceSpy = vi.spyOn(console, 'trace').mockImplementation(() => undefined);
  });

  afterEach(() => {
    traceSpy.mockRestore();
  });

  it('a site change clears plot/census/quadrat lists in the same store update as the selection', () => {
    seedSelections();
    seedLists();
    const snapshots: Array<{ site: unknown; plots: number; censuses: number; quadrats: number }> = [];
    const unsubscribe = useAppStore.subscribe(s =>
      snapshots.push({ site: s.currentSite, plots: s.plotList.length, censuses: s.censusList.length, quadrats: s.quadratList.length })
    );

    useAppStore.getState().setSite(otherSite);
    unsubscribe();

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toEqual({ site: otherSite, plots: 0, censuses: 0, quadrats: 0 });
  });

  it('a plot change clears census and quadrat lists but keeps the plot list', () => {
    seedSelections();
    seedLists();

    useAppStore.getState().setPlot(otherPlot);

    const state = useAppStore.getState();
    expect(state.plotList).toHaveLength(1);
    expect(state.censusList).toHaveLength(0);
    expect(state.quadratList).toHaveLength(0);
  });

  it('re-selecting the same site/plot keeps every list', () => {
    seedSelections();
    seedLists();

    useAppStore.getState().setSite({ ...testSite });
    useAppStore.getState().setPlot({ ...testPlot });

    const state = useAppStore.getState();
    expect(state.plotList).toHaveLength(1);
    expect(state.censusList).toHaveLength(1);
    expect(state.quadratList).toHaveLength(1);
  });

  it('a different plot census number clears the quadrat list; the same number keeps it', () => {
    seedSelections();
    seedLists();

    useAppStore.getState().setCensus({ ...testCensus! });
    expect(useAppStore.getState().quadratList).toHaveLength(1);

    useAppStore.getState().setCensus({ ...testCensus!, plotCensusNumber: 2 });
    expect(useAppStore.getState().quadratList).toHaveLength(0);
  });
});
