import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import type { ReactNode } from 'react';
import { StrictRefetchIncompleteError, useForestQuery } from './useForestQuery';
import { queryKey } from './queryKey';

function wrapperFor(fetcher: (url: string) => Promise<unknown>) {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <SWRConfig value={{ provider: () => new Map(), fetcher, dedupingInterval: 0, revalidateOnFocus: false, shouldRetryOnError: false }}>{children}</SWRConfig>
  );
  Wrapper.displayName = 'TestSWRConfigWrapper';
  return Wrapper;
}

describe('useForestQuery', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('returns idle state when key is null and does not call fetcher', () => {
    const fetcher = vi.fn();
    const { result } = renderHook(() => useForestQuery<{ ok: true }>(null, null), { wrapper: wrapperFor(fetcher as (u: string) => Promise<unknown>) });
    expect(result.current).toMatchObject({
      data: undefined,
      isLoading: false,
      isValidating: false,
      error: undefined
    });
    expect(typeof result.current.refetch).toBe('function');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('returns idle state when url is null even if key is present', () => {
    const fetcher = vi.fn();
    const { result } = renderHook(() => useForestQuery(queryKey('grid:measurements', { siteSchema: 's' }), null), {
      wrapper: wrapperFor(fetcher as (u: string) => Promise<unknown>)
    });
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('fetches and exposes data on a valid key + url', async () => {
    const fetcher = vi.fn().mockResolvedValue({ rows: ['a'] });
    const { result } = renderHook(() => useForestQuery<{ rows: string[] }>(queryKey('grid:measurements', { siteSchema: 's' }), '/api/x'), {
      wrapper: wrapperFor(fetcher)
    });
    await waitFor(() => expect(result.current.data).toEqual({ rows: ['a'] }));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isValidating).toBe(false);
    expect(result.current.error).toBeUndefined();
  });

  it('reports isLoading=true while a first fetch is in flight, then false', async () => {
    let resolve: (v: unknown) => void = () => {};
    const fetcher = vi.fn().mockImplementation(
      () =>
        new Promise(r => {
          resolve = r;
        })
    );
    const { result } = renderHook(() => useForestQuery(queryKey('grid:measurements', { siteSchema: 's' }), '/api/x'), { wrapper: wrapperFor(fetcher) });
    await waitFor(() => expect(result.current.isLoading).toBe(true));
    resolve({ rows: [] });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
  });

  it('exposes the thrown error when the fetcher rejects', async () => {
    const err = new Error('boom');
    const fetcher = vi.fn().mockRejectedValue(err);
    const { result } = renderHook(() => useForestQuery(queryKey('grid:errors', { siteSchema: 's' }), '/api/x'), { wrapper: wrapperFor(fetcher) });
    await waitFor(() => expect(result.current.error).toBe(err));
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
  });

  it('refetch() triggers a new fetcher invocation and resolves to latest data', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce({ v: 1 }).mockResolvedValueOnce({ v: 2 });
    const { result } = renderHook(() => useForestQuery<{ v: number }>(queryKey('grid:measurements', { siteSchema: 's' }), '/api/x'), {
      wrapper: wrapperFor(fetcher)
    });
    await waitFor(() => expect(result.current.data).toEqual({ v: 1 }));
    const next = await result.current.refetch();
    expect(next).toEqual({ v: 2 });
    expect(result.current.data).toEqual({ v: 2 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('passes the URL string (not the tuple key) to defaultFetcher / fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useForestQuery<{ ok: true }>(queryKey('grid:measurements', { siteSchema: 's' }), '/api/probe'), {
      wrapper: ({ children }) => (
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false, shouldRetryOnError: false }}>{children}</SWRConfig>
      )
    });
    await waitFor(() => expect(result.current.data).toEqual({ ok: true }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/probe');
    expect(fetchMock.mock.calls[0][1]).toEqual({ credentials: 'include' });
    vi.unstubAllGlobals();
  });

  it('opts.fetcher override receives the URL string and is preferred over the ambient fetcher', async () => {
    const ambient = vi.fn().mockResolvedValue({ from: 'ambient' });
    const override = vi.fn().mockResolvedValue({ from: 'override' });
    const { result } = renderHook(
      () =>
        useForestQuery<{ from: string }>(queryKey('grid:measurements', { siteSchema: 's' }), '/api/over', {
          fetcher: override as (u: string) => Promise<{ from: string }>
        }),
      { wrapper: wrapperFor(ambient) }
    );
    await waitFor(() => expect(result.current.data).toEqual({ from: 'override' }));
    expect(override).toHaveBeenCalledTimes(1);
    expect(override.mock.calls[0][0]).toBe('/api/over');
    expect(ambient).not.toHaveBeenCalled();
  });

  it('does not refetch when the hook rerenders with the same key and url', async () => {
    const fetcher = vi.fn().mockResolvedValue({ rows: ['a'] });
    const { result, rerender } = renderHook(
      ({ uiState }: { uiState: number }) => {
        void uiState;
        return useForestQuery<{ rows: string[] }>(queryKey('grid:measurements', { siteSchema: 's' }), '/api/x');
      },
      {
        initialProps: { uiState: 0 },
        wrapper: ({ children }) => (
          <SWRConfig value={{ provider: () => new Map(), fetcher, dedupingInterval: 0, revalidateOnFocus: false, shouldRetryOnError: false }}>
            {children}
          </SWRConfig>
        )
      }
    );

    await waitFor(() => expect(result.current.data).toEqual({ rows: ['a'] }));
    rerender({ uiState: 1 });

    await waitFor(() => expect(result.current.data).toEqual({ rows: ['a'] }));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('refetch({ strict: true }) rejects with the underlying error and sets error when a later fetch fails', async () => {
    const err = new Error('strict-boom');
    const fetcher = vi.fn().mockResolvedValueOnce({ v: 1 }).mockRejectedValueOnce(err);
    const { result } = renderHook(() => useForestQuery<{ v: number }>(queryKey('grid:measurements', { siteSchema: 'strict' }), '/api/x'), {
      wrapper: wrapperFor(fetcher)
    });
    await waitFor(() => expect(result.current.data).toEqual({ v: 1 }));

    await expect(result.current.refetch({ strict: true })).rejects.toBe(err);
    await waitFor(() => expect(result.current.error).toBe(err));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('refetch() (lenient) still resolves instead of rejecting on the same failing-fetch scenario', async () => {
    const err = new Error('lenient-boom');
    const fetcher = vi.fn().mockResolvedValueOnce({ v: 1 }).mockRejectedValueOnce(err);
    const { result } = renderHook(() => useForestQuery<{ v: number }>(queryKey('grid:measurements', { siteSchema: 'lenient' }), '/api/x'), {
      wrapper: wrapperFor(fetcher)
    });
    await waitFor(() => expect(result.current.data).toEqual({ v: 1 }));

    await expect(result.current.refetch()).resolves.toEqual({ v: 1 });
    await waitFor(() => expect(result.current.error).toBe(err));
  });

  it('recovers: a successful strict refetch after a failed one resolves with fresh data and clears error', async () => {
    const err = new Error('recoverable-boom');
    const fetcher = vi.fn().mockResolvedValueOnce({ v: 1 }).mockRejectedValueOnce(err).mockResolvedValueOnce({ v: 2 });
    const { result } = renderHook(() => useForestQuery<{ v: number }>(queryKey('grid:measurements', { siteSchema: 'recovery' }), '/api/x'), {
      wrapper: wrapperFor(fetcher)
    });
    await waitFor(() => expect(result.current.data).toEqual({ v: 1 }));

    await expect(result.current.refetch({ strict: true })).rejects.toBe(err);
    await waitFor(() => expect(result.current.error).toBe(err));

    await expect(result.current.refetch({ strict: true })).resolves.toEqual({ v: 2 });
    await waitFor(() => expect(result.current.data).toEqual({ v: 2 }));
    await waitFor(() => expect(result.current.error).toBeUndefined());
  });

  it('a strict refetch from one subscriber observes a failure even when another subscriber on the same key owns the revalidator that runs', async () => {
    const err = new Error('shared-key-boom');
    const fetcher = vi.fn().mockResolvedValueOnce({ v: 1 }).mockRejectedValueOnce(err);
    const { result } = renderHook(
      () => ({
        a: useForestQuery<{ v: number }>(queryKey('grid:measurements', { siteSchema: 'shared' }), '/api/shared'),
        b: useForestQuery<{ v: number }>(queryKey('grid:measurements', { siteSchema: 'shared' }), '/api/shared')
      }),
      { wrapper: wrapperFor(fetcher) }
    );

    await waitFor(() => expect(result.current.a.data).toEqual({ v: 1 }));
    await waitFor(() => expect(result.current.b.data).toEqual({ v: 1 }));
    // Both hooks mount on the identical key during the same tick, so SWR
    // dedupes the initial fetch; only one fetcher call backs both instances.
    expect(fetcher).toHaveBeenCalledTimes(1);

    await expect(result.current.b.refetch({ strict: true })).rejects.toBe(err);
    await waitFor(() => expect(result.current.b.error).toBe(err));
    // The failure lives in SWR's keyed cache entry, shared by every
    // subscriber on that key - instance a observes it too.
    await waitFor(() => expect(result.current.a.error).toBe(err));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('a strict refetch on a new key is not rejected by a late failure belonging to the previous key', async () => {
    let rejectOldKeyFetch: (err: unknown) => void = () => {};
    const oldKeyFetch = new Promise((_resolve, reject) => {
      rejectOldKeyFetch = reject;
    });
    const fetcher = vi
      .fn()
      .mockImplementationOnce(() => oldKeyFetch)
      .mockResolvedValueOnce({ v: 'new-initial' })
      .mockResolvedValueOnce({ v: 'new-refetch' });

    const { result, rerender } = renderHook(
      ({ scope }: { scope: string }) => useForestQuery<{ v: string }>(queryKey('grid:measurements', { siteSchema: scope }), '/api/x'),
      { initialProps: { scope: 'old-key' }, wrapper: wrapperFor(fetcher) }
    );
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));

    rerender({ scope: 'new-key' });
    await waitFor(() => expect(result.current.data).toEqual({ v: 'new-initial' }));

    const strictRefetchOnNewKey = result.current.refetch({ strict: true });
    rejectOldKeyFetch(new Error('late-failure-on-old-key'));

    await expect(strictRefetchOnNewKey).resolves.toEqual({ v: 'new-refetch' });
    expect(result.current.error).toBeUndefined();
    expect(result.current.data).toEqual({ v: 'new-refetch' });
  });

  it('an overlapping in-flight success does not mask a concurrent strict refetch failure on the same key', async () => {
    const err = new Error('overlap-boom');
    let resolveOverlappingSuccess: (v: unknown) => void = () => {};
    const overlappingSuccess = new Promise(resolve => {
      resolveOverlappingSuccess = resolve;
    });
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ v: 1 })
      .mockImplementationOnce(() => overlappingSuccess)
      .mockRejectedValueOnce(err);

    const { result } = renderHook(() => useForestQuery<{ v: number }>(queryKey('grid:measurements', { siteSchema: 'overlap' }), '/api/x'), {
      wrapper: wrapperFor(fetcher)
    });
    await waitFor(() => expect(result.current.data).toEqual({ v: 1 }));

    // Started first; its fetch is the slow one and resolves last.
    const overlappingLenientRefetch = result.current.refetch();
    // Started second; SWR tracks it as the current request for this key.
    const strictRefetch = result.current.refetch({ strict: true });

    await expect(strictRefetch).rejects.toBe(err);
    await waitFor(() => expect(result.current.error).toBe(err));

    resolveOverlappingSuccess({ v: 99 });
    await overlappingLenientRefetch;

    // SWR discards the earlier-started request's result once a newer one
    // for the same key has already completed; the failure must stand.
    expect(result.current.error).toBe(err);
    expect(result.current.data).toEqual({ v: 1 });
  });

  it('refetch({ strict: true }) fails closed when SWR discards its revalidation because a later request on the same key is still pending', async () => {
    let resolveFirstStrictFetch: (v: unknown) => void = () => {};
    const firstStrictFetch = new Promise(resolve => {
      resolveFirstStrictFetch = resolve;
    });
    let resolveLaterPendingFetch: (v: unknown) => void = () => {};
    const laterPendingFetch = new Promise(resolve => {
      resolveLaterPendingFetch = resolve;
    });
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ v: 1 })
      .mockImplementationOnce(() => firstStrictFetch)
      .mockImplementationOnce(() => laterPendingFetch);

    const { result } = renderHook(() => useForestQuery<{ v: number }>(queryKey('grid:measurements', { siteSchema: 'discarded-strict' }), '/api/x'), {
      wrapper: wrapperFor(fetcher)
    });
    await waitFor(() => expect(result.current.data).toEqual({ v: 1 }));

    // Started first, as a strict refetch.
    const firstStrictRefetch = result.current.refetch({ strict: true });
    // Started second and stays pending; SWR tracks this as the current
    // request for the key, so the first strict refetch gets discarded.
    const laterLenientRefetch = result.current.refetch();
    await waitFor(() => expect(result.current.isValidating).toBe(true));

    resolveFirstStrictFetch({ v: 'discarded-by-later-request' });
    await expect(firstStrictRefetch).rejects.toBeInstanceOf(StrictRefetchIncompleteError);

    // A discarded revalidation must not look like a completed success: the
    // cache is exactly as it was before the strict call, and a later
    // request is still pending.
    expect(result.current.data).toEqual({ v: 1 });
    expect(result.current.error).toBeUndefined();
    expect(result.current.isValidating).toBe(true);

    await act(async () => {
      resolveLaterPendingFetch({ v: 2 });
      await laterLenientRefetch;
    });

    await waitFor(() => expect(result.current.data).toEqual({ v: 2 }));
    expect(result.current.isValidating).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
