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
  description: 'First census'
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
