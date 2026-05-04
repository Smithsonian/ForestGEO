import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import type { ReactNode } from 'react';
import { useForestQuery } from './useForestQuery';
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
});
