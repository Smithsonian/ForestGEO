import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addPendingScope,
  removePendingScope,
  requestMeasurementViewRebuilds,
  requestScopeViewRebuilds,
  scopeOverlapsRead,
  ViewRebuildFailedError
} from './viewrebuilds';

const SCOPE = { schema: 'forestgeo_testing', plotID: 1, censusID: 6 };
const EDITED_MEASUREMENT_IDS = [101];
const SETTLE_WAIT_MS = 50;

describe('scopeOverlapsRead (P3-4)', () => {
  it.each([
    [{ schema: 'forestgeo_testing', plotID: 1, censusID: 5, censusIDs: [5, 6] }, true],
    [{ schema: 'forestgeo_testing', plotID: 1, censusID: 7, censusIDs: [7] }, false],
    [{ schema: 'forestgeo_testing', plotID: 2, censusID: 6, censusIDs: [6] }, false],
    [{ schema: 'forestgeo_other', plotID: 1, censusID: 6, censusIDs: [6] }, false]
  ])('%j → %s', (readScope, expected) => {
    expect(scopeOverlapsRead(SCOPE, readScope)).toBe(expected);
  });

  it('keeps one entry per scope', () => {
    const once = addPendingScope([], SCOPE);
    expect(addPendingScope(once, { ...SCOPE })).toHaveLength(1);
    expect(removePendingScope(once, { ...SCOPE })).toEqual([]);
  });
});

describe('requestMeasurementViewRebuilds and requestScopeViewRebuilds', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  function postedCalls() {
    return fetchMock.mock.calls.map(([url, init]) => [url, JSON.parse(String(init.body))]);
  }

  it('POSTs both stored views for the edited measurement only after a save or an undo (r3.1, R4)', async () => {
    await requestMeasurementViewRebuilds(SCOPE, EDITED_MEASUREMENT_IDS);
    console.log('[view-errors rebuilds]', JSON.stringify(postedCalls()));
    expect(postedCalls()).toEqual([
      ['/api/refreshviews/measurementssummary/forestgeo_testing', { coreMeasurementIDs: EDITED_MEASUREMENT_IDS }],
      ['/api/refreshviews/viewfulltable/forestgeo_testing', { coreMeasurementIDs: EDITED_MEASUREMENT_IDS }]
    ]);
  });

  it('POSTs both stored views for the whole scope on Retry refresh', async () => {
    await requestScopeViewRebuilds(SCOPE);
    console.log('[view-errors scope rebuilds]', JSON.stringify(postedCalls()));
    expect(postedCalls()).toEqual([
      ['/api/refreshviews/measurementssummary/forestgeo_testing', { plotID: 1, censusID: 6 }],
      ['/api/refreshviews/viewfulltable/forestgeo_testing', { plotID: 1, censusID: 6 }]
    ]);
  });

  it('rejects with the server message when either rebuild fails', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Lock wait timeout exceeded' }), { status: 500 }));
    await expect(requestMeasurementViewRebuilds(SCOPE, EDITED_MEASUREMENT_IDS)).rejects.toThrow(ViewRebuildFailedError);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Lock wait timeout exceeded' }), { status: 500 }));
    await expect(requestScopeViewRebuilds(SCOPE)).rejects.toThrow('Lock wait timeout exceeded');
  });

  it('does not settle on one failure while the other rebuild is still running (P3-2)', async () => {
    let finishFullTable!: (response: Response) => void;
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/measurementssummary/')) return new Response(JSON.stringify({ error: 'Lock wait timeout exceeded' }), { status: 500 });
      return new Promise<Response>(resolve => {
        finishFullTable = resolve;
      });
    });
    let settled = false;
    const observed = requestMeasurementViewRebuilds(SCOPE, EDITED_MEASUREMENT_IDS)
      .finally(() => {
        settled = true;
      })
      .catch((error: unknown) => error);
    await new Promise(resolve => setTimeout(resolve, SETTLE_WAIT_MS));
    console.log('[view-errors rebuilds settle]', JSON.stringify({ settledWhileFullTableRuns: settled, calls: fetchMock.mock.calls.map(([url]) => url) }));
    expect(settled, 'a failed summary rebuild must not settle while viewfulltable is still running').toBe(false);
    finishFullTable(new Response('{}', { status: 200 }));
    const error = await observed;
    expect(settled).toBe(true);
    expect(error).toBeInstanceOf(ViewRebuildFailedError);
    expect((error as Error).message).toBe('Lock wait timeout exceeded');
  });
});
