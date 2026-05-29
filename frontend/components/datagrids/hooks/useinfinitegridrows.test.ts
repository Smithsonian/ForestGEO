import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { INFINITE_SOFT_CAP, useInfiniteGridRows } from './useinfinitegridrows';

type R = { id: number; name: string };

function buildFetcher(total: number) {
  return vi.fn(async ({ page, pageSize, signal }: { page: number; pageSize: number; signal: AbortSignal }) => {
    if (signal.aborted) {
      const err: any = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    }
    const start = page * pageSize;
    const rows: R[] = [];
    for (let i = start; i < Math.min(start + pageSize, total); i++) rows.push({ id: i, name: `row-${i}` });
    return { rows, totalRows: total };
  });
}

const PAGINATED_EMPTY = { rows: [] as R[], totalRows: 0, isLoading: false };

describe('useInfiniteGridRows', () => {
  it('paginated mode passes through caller data and does not call fetcher', () => {
    const fetcher = vi.fn();
    const { result } = renderHook(() =>
      useInfiniteGridRows<R>({
        fetcher,
        initialPageSize: 10,
        resetKey: 'k',
        rowIdKey: 'id',
        paginated: { rows: [{ id: 1, name: 'a' }], totalRows: 1, isLoading: false }
      })
    );
    expect(result.current.mode).toBe('paginated');
    expect(result.current.rows).toEqual([{ id: 1, name: 'a' }]);
    expect(result.current.totalRows).toBe(1);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('switching to infinite fetches page 0 at chunk size 100', async () => {
    const fetcher = buildFetcher(250);
    const { result } = renderHook(() => useInfiniteGridRows<R>({ fetcher, initialPageSize: 10, resetKey: 'k', rowIdKey: 'id', paginated: PAGINATED_EMPTY }));
    act(() => result.current.setMode('infinite'));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    expect(fetcher.mock.calls[0][0]).toMatchObject({ page: 0, pageSize: 100 });
    await waitFor(() => expect(result.current.rows).toHaveLength(100));
    expect(result.current.hasMore).toBe(true);
    expect(result.current.totalRows).toBe(250);
  });

  it('loadMore appends; double-fire while loading is suppressed; stops at total', async () => {
    const fetcher = buildFetcher(250);
    const { result } = renderHook(() => useInfiniteGridRows<R>({ fetcher, initialPageSize: 10, resetKey: 'k', rowIdKey: 'id', paginated: PAGINATED_EMPTY }));
    act(() => result.current.setMode('infinite'));
    await waitFor(() => expect(result.current.rows).toHaveLength(100));

    act(() => {
      result.current.loadMore();
      result.current.loadMore();
    });
    await waitFor(() => expect(result.current.rows).toHaveLength(200));
    expect(fetcher).toHaveBeenCalledTimes(2);

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.rows).toHaveLength(250));
    expect(result.current.hasMore).toBe(false);

    act(() => result.current.loadMore());
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('resetKey change in infinite mode clears accumulator and refetches from page 0', async () => {
    const fetcher = buildFetcher(250);
    const { result, rerender } = renderHook(
      ({ key }: { key: string }) => useInfiniteGridRows<R>({ fetcher, initialPageSize: 10, resetKey: key, rowIdKey: 'id', paginated: PAGINATED_EMPTY }),
      { initialProps: { key: 'k' } }
    );
    act(() => result.current.setMode('infinite'));
    await waitFor(() => expect(result.current.rows).toHaveLength(100));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.rows).toHaveLength(200));

    rerender({ key: 'k2' });
    await waitFor(() => expect(result.current.rows).toHaveLength(100));
    expect(fetcher.mock.calls.at(-1)![0]).toMatchObject({ page: 0 });
  });

  it('upsertRow replaces by id, removeRow drops and decrements totalRows', async () => {
    const fetcher = buildFetcher(150);
    const { result } = renderHook(() => useInfiniteGridRows<R>({ fetcher, initialPageSize: 10, resetKey: 'k', rowIdKey: 'id', paginated: PAGINATED_EMPTY }));
    act(() => result.current.setMode('infinite'));
    await waitFor(() => expect(result.current.rows.length).toBeGreaterThan(0));
    const total0 = result.current.totalRows;

    act(() => result.current.upsertRow({ id: 0, name: 'renamed' }));
    expect(result.current.rows.find(r => r.id === 0)!.name).toBe('renamed');

    act(() => result.current.removeRow(0));
    expect(result.current.rows.find(r => r.id === 0)).toBeUndefined();
    expect(result.current.totalRows).toBe(total0 - 1);
  });

  it('upsertRow on unknown id prepends and bumps totalRows', async () => {
    const fetcher = buildFetcher(100);
    const { result } = renderHook(() => useInfiniteGridRows<R>({ fetcher, initialPageSize: 10, resetKey: 'k', rowIdKey: 'id', paginated: PAGINATED_EMPTY }));
    act(() => result.current.setMode('infinite'));
    await waitFor(() => expect(result.current.rows.length).toBeGreaterThan(0));
    const total0 = result.current.totalRows;

    act(() => result.current.upsertRow({ id: 9999, name: 'new' }));
    expect(result.current.rows[0]).toEqual({ id: 9999, name: 'new' });
    expect(result.current.totalRows).toBe(total0 + 1);
  });

  it('softCapExceeded fires once rows exceed the soft cap', async () => {
    const fetcher = buildFetcher(INFINITE_SOFT_CAP + 50);
    const { result } = renderHook(() => useInfiniteGridRows<R>({ fetcher, initialPageSize: 10, resetKey: 'k', rowIdKey: 'id', paginated: PAGINATED_EMPTY }));
    act(() => result.current.setMode('infinite'));
    await waitFor(() => expect(result.current.isLoadingMore).toBe(false));
    while (result.current.hasMore) {
      act(() => result.current.loadMore());

      await waitFor(() => expect(result.current.isLoadingMore).toBe(false));
    }
    expect(result.current.softCapExceeded).toBe(true);
  });

  it('fetcher error surfaces on error and accumulator preserved', async () => {
    let calls = 0;
    const fetcher = vi.fn(async ({ page, pageSize }: { page: number; pageSize: number }) => {
      calls++;
      if (calls === 2) throw new Error('boom');
      const rows: R[] = [];
      for (let i = 0; i < pageSize; i++) rows.push({ id: page * pageSize + i, name: 'x' });
      return { rows, totalRows: 500 };
    });
    const { result } = renderHook(() => useInfiniteGridRows<R>({ fetcher, initialPageSize: 10, resetKey: 'k', rowIdKey: 'id', paginated: PAGINATED_EMPTY }));
    act(() => result.current.setMode('infinite'));
    await waitFor(() => expect(result.current.rows).toHaveLength(100));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.rows).toHaveLength(100);
  });

  it('retry refetches the failed page instead of restarting at page 0', async () => {
    let calls = 0;
    const fetcher = vi.fn(async ({ page, pageSize }: { page: number; pageSize: number }) => {
      calls++;
      if (page === 1 && calls === 2) throw new Error('boom');
      const rows: R[] = [];
      for (let i = 0; i < pageSize; i++) rows.push({ id: page * pageSize + i, name: `row-${page}-${i}` });
      return { rows, totalRows: 250 };
    });
    const { result } = renderHook(() => useInfiniteGridRows<R>({ fetcher, initialPageSize: 10, resetKey: 'k', rowIdKey: 'id', paginated: PAGINATED_EMPTY }));
    act(() => result.current.setMode('infinite'));
    await waitFor(() => expect(result.current.rows).toHaveLength(100));

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.error).toBeTruthy());
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.rows).toHaveLength(200));

    expect(fetcher.mock.calls.map(call => call[0].page)).toEqual([0, 1, 1]);
  });

  it('dedupes overlapping pages by row id while appending', async () => {
    const fetcher = vi.fn(async ({ page }: { page: number; pageSize: number }) => {
      if (page === 0) {
        return {
          rows: [
            { id: 1, name: 'one' },
            { id: 2, name: 'two' }
          ],
          totalRows: 4
        };
      }
      return {
        rows: [
          { id: 2, name: 'two-updated' },
          { id: 3, name: 'three' }
        ],
        totalRows: 4
      };
    });
    const { result } = renderHook(() =>
      useInfiniteGridRows<R>({ fetcher, initialPageSize: 10, infiniteChunkSize: 2, resetKey: 'k', rowIdKey: 'id', paginated: PAGINATED_EMPTY })
    );
    act(() => result.current.setMode('infinite'));
    await waitFor(() => expect(result.current.rows).toHaveLength(2));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.rows).toHaveLength(3));

    expect(result.current.rows).toEqual([
      { id: 1, name: 'one' },
      { id: 2, name: 'two-updated' },
      { id: 3, name: 'three' }
    ]);
  });

  it('refresh in infinite mode refetches from page 0', async () => {
    const fetcher = buildFetcher(250);
    const { result } = renderHook(() => useInfiniteGridRows<R>({ fetcher, initialPageSize: 10, resetKey: 'k', rowIdKey: 'id', paginated: PAGINATED_EMPTY }));
    act(() => result.current.setMode('infinite'));
    await waitFor(() => expect(result.current.rows).toHaveLength(100));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.rows).toHaveLength(200));

    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.rows).toHaveLength(100);
    expect(fetcher.mock.calls.at(-1)![0]).toMatchObject({ page: 0 });
  });
});
