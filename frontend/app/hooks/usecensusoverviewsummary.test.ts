import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HTTPResponses } from '@/config/macros';
import { CENSUS_OVERVIEW_SUMMARY_ENDPOINT, type CensusOverviewSummary } from '@/config/censusoverview';
import { useCensusOverviewSummary, type CensusOverviewSummaryScope } from './usecensusoverviewsummary';

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

interface PendingRequest {
  url: string;
  signal: AbortSignal;
  response: Deferred<Response>;
}

const SCOPE_A: CensusOverviewSummaryScope = { schema: 'forestgeo_testing', plotID: 1, censusID: 11, errorCensusIDs: [11] };
const SCOPE_B: CensusOverviewSummaryScope = { schema: 'forestgeo_testing', plotID: 1, censusID: 12, errorCensusIDs: [12] };
const CENSUS_NOT_FOUND_MESSAGE = 'Census not found';

let pendingRequests: PendingRequest[] = [];

function summaryLabelled(exportableCount: number): CensusOverviewSummary {
  return {
    errorOverview: { affectedMeasurements: 0, totalActiveMeasurements: exportableCount, topErrorTypes: [], remainingErrorTypeCount: 0 },
    exportPreview: { totalActiveMeasurements: exportableCount, exportableCount, skippedCount: 0, skipReasons: [], exportedWithUnresolvedErrorCount: 0 },
    blockers: []
  };
}

function okResponse(body: Promise<unknown>): Response {
  return { ok: true, status: HTTPResponses.OK, json: () => body } as unknown as Response;
}

function errorResponse(status: number, body: unknown): Response {
  return { ok: false, status, json: async () => body } as unknown as Response;
}

async function resolveRequest(request: PendingRequest, response: Response): Promise<void> {
  await act(async () => {
    request.response.resolve(response);
  });
}

function describeRequests(): string {
  return JSON.stringify(pendingRequests.map(request => ({ url: request.url, aborted: request.signal.aborted })));
}

beforeEach(() => {
  pendingRequests = [];
  global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const response = createDeferred<Response>();
    pendingRequests.push({ url: String(input), signal: init?.signal as AbortSignal, response });
    return response.promise;
  }) as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useCensusOverviewSummary', () => {
  it('requests the scope endpoint and shows its summary', async () => {
    const { result } = renderHook(scope => useCensusOverviewSummary(scope), { initialProps: SCOPE_A });

    expect(result.current.isLoading).toBe(true);
    expect(pendingRequests[0].url).toBe(
      CENSUS_OVERVIEW_SUMMARY_ENDPOINT(SCOPE_A.schema as string, SCOPE_A.plotID as number, SCOPE_A.censusID as number, SCOPE_A.errorCensusIDs)
    );
    await resolveRequest(pendingRequests[0], okResponse(Promise.resolve(summaryLabelled(1))));

    expect(result.current.isLoading).toBe(false);
    expect(result.current.summary?.exportPreview.exportableCount).toBe(1);
  });

  it('never renders a slow A response that lands after the scope moved to B', async () => {
    const { result, rerender } = renderHook(scope => useCensusOverviewSummary(scope), { initialProps: SCOPE_A });
    rerender(SCOPE_B);
    const [requestA, requestB] = pendingRequests;

    await resolveRequest(requestB, okResponse(Promise.resolve(summaryLabelled(2))));
    await resolveRequest(requestA, okResponse(Promise.resolve(summaryLabelled(1))));
    console.log(`[#547 out of order] requests ${describeRequests()}, shown ${result.current.summary?.exportPreview.exportableCount}`);

    expect(result.current.summary?.exportPreview.exportableCount).toBe(2);
  });

  it('ignores the first A request by request id after A -> B -> A, and shows the second', async () => {
    const { result, rerender } = renderHook(scope => useCensusOverviewSummary(scope), { initialProps: SCOPE_A });
    rerender(SCOPE_B);
    rerender(SCOPE_A);
    const [firstA, , secondA] = pendingRequests;

    await resolveRequest(firstA, okResponse(Promise.resolve(summaryLabelled(1))));
    console.log(`[#547 A-B-A] after first A: loading ${result.current.isLoading}, summary ${JSON.stringify(result.current.summary)}`);
    expect(result.current.isLoading, 'the stale same-scope response must not end loading').toBe(true);
    expect(result.current.summary).toBeNull();

    await resolveRequest(secondA, okResponse(Promise.resolve(summaryLabelled(3))));
    expect(result.current.summary?.exportPreview.exportableCount).toBe(3);
  });

  it('ignores a response whose JSON finishes parsing after the scope changed', async () => {
    const { result, rerender } = renderHook(scope => useCensusOverviewSummary(scope), { initialProps: SCOPE_A });
    const slowJson = createDeferred<unknown>();
    await resolveRequest(pendingRequests[0], okResponse(slowJson.promise));
    rerender(SCOPE_B);

    await act(async () => {
      slowJson.resolve(summaryLabelled(1));
    });

    expect(result.current.summary).toBeNull();
    expect(result.current.isLoading).toBe(true);
  });

  it('keeps the current request loading when a superseded request finishes', async () => {
    const { result, rerender } = renderHook(scope => useCensusOverviewSummary(scope), { initialProps: SCOPE_A });
    rerender(SCOPE_B);

    await resolveRequest(pendingRequests[0], errorResponse(HTTPResponses.INTERNAL_SERVER_ERROR, { error: 'boom' }));

    expect(result.current.isLoading).toBe(true);
    expect(result.current.errorMessage).toBeNull();
  });

  it('makes a refetch bound to A a no-op after the scope moved to B, without aborting B', () => {
    const { result, rerender } = renderHook(scope => useCensusOverviewSummary(scope), { initialProps: SCOPE_A });
    const refetchBoundToA = result.current.refetch;
    rerender(SCOPE_B);
    const requestB = pendingRequests[1];

    act(() => {
      refetchBoundToA();
    });
    console.log(`[#547 bound refetch] requests ${describeRequests()}`);

    expect(pendingRequests).toHaveLength(2);
    expect(requestB.signal.aborted).toBe(false);
  });

  it('aborts the request in flight on unmount', () => {
    const { unmount } = renderHook(scope => useCensusOverviewSummary(scope), { initialProps: SCOPE_A });
    unmount();
    expect(pendingRequests[0].signal.aborted).toBe(true);
  });

  it('starts no request when a refetch captured before unmount is called afterwards', async () => {
    const { result, unmount } = renderHook(scope => useCensusOverviewSummary(scope), { initialProps: SCOPE_A });
    await resolveRequest(pendingRequests[0], okResponse(Promise.resolve(summaryLabelled(1))));
    const refetchCapturedWhileMounted = result.current.refetch;
    const requestCountBeforeUnmount = pendingRequests.length;

    unmount();
    act(() => {
      refetchCapturedWhileMounted();
    });
    console.log(`[#547 refetch after unmount] requests before unmount ${requestCountBeforeUnmount}, after ${pendingRequests.length}, ${describeRequests()}`);

    expect(pendingRequests, 'a refetch called after unmount must not start a summary request nobody will abort').toHaveLength(requestCountBeforeUnmount);
  });

  it("reports the server's error message, and Retry clears it to loading", async () => {
    const { result } = renderHook(scope => useCensusOverviewSummary(scope), { initialProps: SCOPE_A });
    await resolveRequest(pendingRequests[0], errorResponse(HTTPResponses.NOT_FOUND, { error: CENSUS_NOT_FOUND_MESSAGE }));
    expect(result.current.errorMessage).toBe(CENSUS_NOT_FOUND_MESSAGE);

    act(() => {
      result.current.refetch();
    });

    expect(pendingRequests).toHaveLength(2);
    expect(result.current.errorMessage).toBeNull();
    expect(result.current.isLoading).toBe(true);
  });

  it('keeps the same-scope summary visible while a refetch runs', async () => {
    const { result } = renderHook(scope => useCensusOverviewSummary(scope), { initialProps: SCOPE_A });
    await resolveRequest(pendingRequests[0], okResponse(Promise.resolve(summaryLabelled(1))));

    act(() => {
      result.current.refetch();
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.summary?.exportPreview.exportableCount).toBe(1);
  });
});
