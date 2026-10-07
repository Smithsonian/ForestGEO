import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GridRefreshCancelledError, INFINITE_SOFT_CAP, useInfiniteGridRows } from './useinfinitegridrows';

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

function buildRows(start: number, end: number): R[] {
  const rows: R[] = [];
  for (let i = start; i < end; i++) rows.push({ id: i, name: `row-${i}` });
  return rows;
}

// Gives the test direct control over when each individual fetcher call
// resolves/rejects, so supersession (a later fetchPage starting before an
// earlier one settles) can be reproduced deterministically by call index.
function createControllableFetcher<Row>() {
  type PendingCall = {
    resolve: (value: { rows: Row[]; totalRows: number }) => void;
    reject: (reason: unknown) => void;
  };
  const pendingCalls: PendingCall[] = [];
  const fetcher = vi.fn((_args: { page: number; pageSize: number; signal: AbortSignal }) => {
    return new Promise<{ rows: Row[]; totalRows: number }>((resolve, reject) => {
      pendingCalls.push({ resolve, reject });
    });
  });
  return {
    fetcher,
    resolveCall: (callIndex: number, result: { rows: Row[]; totalRows: number }) => {
      pendingCalls[callIndex].resolve(result);
    },
    rejectCall: (callIndex: number, reason: unknown) => {
      pendingCalls[callIndex].reject(reason);
    }
  };
}

function abortError(message: string): Error {
  return Object.assign(new Error(message), { name: 'AbortError' });
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

  // U9 regression: the default (lenient) refresh() contract used by every
  // existing caller — loadMore, retry, mode-switch, resetKey effects — must
  // keep resolving even when the underlying fetch rejects, so none of those
  // void/fire-and-forget call sites turn into an unhandled rejection.
  it('default refresh() resolves even when the fetcher rejects, while still surfacing the error state', async () => {
    let callCount = 0;
    const fetcher = vi.fn(async () => {
      callCount++;
      if (callCount === 1) return { rows: [{ id: 1, name: 'one' }], totalRows: 1 };
      throw new Error('lenient refresh exploded');
    });
    const { result } = renderHook(() => useInfiniteGridRows<R>({ fetcher, initialPageSize: 10, resetKey: 'k', rowIdKey: 'id', paginated: PAGINATED_EMPTY }));
    act(() => result.current.setMode('infinite'));
    await waitFor(() => expect(result.current.rows).toHaveLength(1));

    await expect(
      act(async () => {
        await result.current.refresh();
      })
    ).resolves.toBeUndefined();

    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.error?.message).toBe('lenient refresh exploded');
  });

  // U9 regression: strict refresh({ strict: true }) is the opt-in used ONLY
  // by the awaited post-undo refresh chain — it must reject (not just set
  // `error`) so an awaiting caller learns the refresh failed, while still
  // populating the same visible error state as the lenient path.
  it('refresh({ strict: true }) rejects when the fetcher fails, while still surfacing the error state', async () => {
    let callCount = 0;
    const fetcher = vi.fn(async () => {
      callCount++;
      if (callCount === 1) return { rows: [{ id: 1, name: 'one' }], totalRows: 1 };
      throw new Error('strict refresh exploded');
    });
    const { result } = renderHook(() => useInfiniteGridRows<R>({ fetcher, initialPageSize: 10, resetKey: 'k', rowIdKey: 'id', paginated: PAGINATED_EMPTY }));
    act(() => result.current.setMode('infinite'));
    await waitFor(() => expect(result.current.rows).toHaveLength(1));

    await act(async () => {
      await expect(result.current.refresh({ strict: true })).rejects.toThrow('strict refresh exploded');
    });

    expect(result.current.error?.message).toBe('strict refresh exploded');
  });

  // A strict read superseded by a LATER fetchPage must reject — its own
  // result was discarded, so an awaiting caller must learn the read never
  // completed — but the cancellation must stay invisible to the grid's
  // user-facing `error` state (it is not a real fetch failure).
  it('refresh({ strict: true }) superseded by a later refresh() rejects with GridRefreshCancelledError and does not set error state', async () => {
    const { fetcher, resolveCall } = createControllableFetcher<R>();
    const { result } = renderHook(() => useInfiniteGridRows<R>({ fetcher, initialPageSize: 10, resetKey: 'k', rowIdKey: 'id', paginated: PAGINATED_EMPTY }));

    act(() => result.current.setMode('infinite'));
    resolveCall(0, { rows: buildRows(0, 1), totalRows: 1 });
    await waitFor(() => expect(result.current.rows).toEqual(buildRows(0, 1)));

    let strictPromise!: Promise<void>;
    act(() => {
      strictPromise = result.current.refresh({ strict: true });
    });
    act(() => {
      void result.current.refresh();
    });

    resolveCall(1, { rows: [{ id: 999, name: 'stale-superseded' }], totalRows: 1 });

    await expect(strictPromise, 'strict promise from the superseded call must reject, not resolve').rejects.toBeInstanceOf(GridRefreshCancelledError);
    expect(result.current.error, 'cancellation must never surface as the visible grid error').toBeNull();
    expect(result.current.rows, 'superseded success must not overwrite rows with its stale payload').not.toEqual([{ id: 999, name: 'stale-superseded' }]);

    await act(async () => {
      resolveCall(2, { rows: [{ id: 1000, name: 'current' }], totalRows: 1 });
    });
    await waitFor(() => expect(result.current.rows).toEqual([{ id: 1000, name: 'current' }]));
    expect(result.current.error, 'the superseding call that actually completed must leave error clear').toBeNull();
  });

  // A strict read whose own request was aborted (not superseded by a
  // newer token) must still reject, while leaving `error` untouched.
  it('refresh({ strict: true }) rejects with GridRefreshCancelledError when its own fetch is aborted', async () => {
    const { fetcher, resolveCall, rejectCall } = createControllableFetcher<R>();
    const { result } = renderHook(() => useInfiniteGridRows<R>({ fetcher, initialPageSize: 10, resetKey: 'k', rowIdKey: 'id', paginated: PAGINATED_EMPTY }));

    act(() => result.current.setMode('infinite'));
    resolveCall(0, { rows: buildRows(0, 1), totalRows: 1 });
    await waitFor(() => expect(result.current.rows).toEqual(buildRows(0, 1)));

    let strictPromise!: Promise<void>;
    act(() => {
      strictPromise = result.current.refresh({ strict: true });
    });
    await act(async () => {
      rejectCall(1, abortError('fetch aborted mid-flight'));
      await strictPromise.catch(() => {});
    });

    await expect(strictPromise, 'strict promise whose own fetch aborted must reject').rejects.toBeInstanceOf(GridRefreshCancelledError);
    expect(result.current.error, 'an AbortError must never surface as the visible grid error').toBeNull();
    await waitFor(() => expect(result.current.isLoadingMore, 'the (still current) token must finish clearing isLoadingMore').toBe(false));
  });

  // Lenient refresh() must keep resolving (never reject) when its read is
  // superseded, and a superseded success must not overwrite the rows
  // written by whichever call actually completed last.
  it('default refresh() superseded by a later refresh() still resolves, and the stale payload never reaches rows', async () => {
    const { fetcher, resolveCall } = createControllableFetcher<R>();
    const { result } = renderHook(() => useInfiniteGridRows<R>({ fetcher, initialPageSize: 10, resetKey: 'k', rowIdKey: 'id', paginated: PAGINATED_EMPTY }));

    act(() => result.current.setMode('infinite'));
    resolveCall(0, { rows: buildRows(0, 1), totalRows: 1 });
    await waitFor(() => expect(result.current.rows).toEqual(buildRows(0, 1)));

    let lenientPromise!: Promise<void>;
    act(() => {
      lenientPromise = result.current.refresh();
    });
    act(() => {
      void result.current.refresh();
    });

    resolveCall(1, { rows: [{ id: 999, name: 'stale-superseded' }], totalRows: 1 });
    await expect(lenientPromise, 'lenient refresh must resolve even when superseded').resolves.toBeUndefined();
    expect(result.current.rows, 'the superseded payload must not land in state').not.toEqual([{ id: 999, name: 'stale-superseded' }]);

    await act(async () => {
      resolveCall(2, { rows: [{ id: 1000, name: 'current' }], totalRows: 1 });
    });
    await waitFor(() => expect(result.current.rows).toEqual([{ id: 1000, name: 'current' }]));
    expect(result.current.error).toBeNull();
  });

  // loadMore() is fire-and-forget (`void fetchPage(...)`), so it can never
  // throw. If supersession still mutated the accumulator, a stale page-1
  // payload would silently corrupt the rows written by the refresh() that
  // actually won — assert none of those stale ids ever appear.
  it('loadMore() superseded by refresh() never rejects and its stale page never reaches the accumulator', async () => {
    const { fetcher, resolveCall } = createControllableFetcher<R>();
    const { result } = renderHook(() =>
      useInfiniteGridRows<R>({ fetcher, initialPageSize: 10, infiniteChunkSize: 100, resetKey: 'k', rowIdKey: 'id', paginated: PAGINATED_EMPTY })
    );

    act(() => result.current.setMode('infinite'));
    resolveCall(0, { rows: buildRows(0, 100), totalRows: 250 });
    await waitFor(() => expect(result.current.rows).toHaveLength(100));

    act(() => result.current.loadMore());
    act(() => {
      void result.current.refresh();
    });

    resolveCall(1, { rows: buildRows(100, 200), totalRows: 250 });

    await act(async () => {
      resolveCall(2, { rows: buildRows(0, 100), totalRows: 250 });
    });
    await waitFor(() => expect(result.current.rows).toHaveLength(100));
    expect(result.current.error, 'loadMore supersession must not surface as a grid error').toBeNull();
    expect(
      result.current.rows.some(row => row.id >= 100),
      'the superseded loadMore page (ids 100-199) must never appear once refresh() won'
    ).toBe(false);
  });

  // retry() must stay lenient even when its own retried fetch is both
  // aborted AND superseded by a refresh() started while the retry was
  // still in flight.
  it("retry() superseded and aborted never rejects and leaves the hook in the superseding call's state", async () => {
    const { fetcher, resolveCall, rejectCall } = createControllableFetcher<R>();
    const { result } = renderHook(() =>
      useInfiniteGridRows<R>({ fetcher, initialPageSize: 10, infiniteChunkSize: 100, resetKey: 'k', rowIdKey: 'id', paginated: PAGINATED_EMPTY })
    );

    act(() => result.current.setMode('infinite'));
    resolveCall(0, { rows: buildRows(0, 100), totalRows: 250 });
    await waitFor(() => expect(result.current.rows).toHaveLength(100));

    act(() => result.current.loadMore());
    rejectCall(1, new Error('page 1 boom'));
    await waitFor(() => expect(result.current.error?.message).toBe('page 1 boom'));

    act(() => result.current.retry());
    act(() => {
      void result.current.refresh();
    });

    rejectCall(2, abortError('retry aborted mid-flight'));

    await act(async () => {
      resolveCall(3, { rows: buildRows(0, 100), totalRows: 250 });
    });
    await waitFor(() => expect(result.current.rows).toHaveLength(100));
    expect(result.current.error, 'refresh() clears error on start and its success must be the final state').toBeNull();
  });

  // abort() is cooperative: a fetcher can resolve successfully after its own
  // signal was aborted. A mode switch aborts without advancing the token, so
  // a token-only guard would wrongly treat this late success as completion.
  it('refresh({ strict: true }) rejects with GridRefreshCancelledError when a mode switch aborts it and the fetcher later resolves successfully anyway', async () => {
    const { fetcher, resolveCall } = createControllableFetcher<R>();
    const { result } = renderHook(() => useInfiniteGridRows<R>({ fetcher, initialPageSize: 10, resetKey: 'k', rowIdKey: 'id', paginated: PAGINATED_EMPTY }));

    act(() => result.current.setMode('infinite'));
    resolveCall(0, { rows: buildRows(0, 1), totalRows: 1 });
    await waitFor(() => expect(result.current.rows).toEqual(buildRows(0, 1)));

    let strictPromise!: Promise<void>;
    act(() => {
      strictPromise = result.current.refresh({ strict: true });
    });

    act(() => result.current.setMode('paginated'));

    await act(async () => {
      resolveCall(1, { rows: [{ id: 777, name: 'late-success-after-abort' }], totalRows: 99 });
      await strictPromise.catch(() => {});
    });

    await expect(
      strictPromise,
      'a late success arriving after the mode switch aborted this read must still reject, not resolve as if it had completed'
    ).rejects.toBeInstanceOf(GridRefreshCancelledError);
    expect(result.current.error, 'cancellation from an aborted-then-late-resolved read must never surface as the visible grid error').toBeNull();
    expect(result.current.rows, "the paginated-mode view must not be contaminated by the aborted read's stale payload").toEqual(PAGINATED_EMPTY.rows);
    expect(fetcher, 'the aborted read must not trigger any further fetch on its own').toHaveBeenCalledTimes(2);

    act(() => result.current.setMode('infinite'));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    await act(async () => {
      resolveCall(2, { rows: buildRows(0, 1), totalRows: 1 });
    });
    await waitFor(() => expect(result.current.rows).toEqual(buildRows(0, 1)));
    expect(
      result.current.rows.some(row => row.id === 777),
      'the stale row from the aborted-then-late-resolved read must never reach the accumulator, even after switching back'
    ).toBe(false);
    expect(result.current.error).toBeNull();
  });

  // The happy path for the strict contract — a strict refresh that is
  // never superseded or aborted must resolve normally and still update rows.
  it('refresh({ strict: true }) resolves and updates rows/total when the read completes normally', async () => {
    const fetcher = buildFetcher(150);
    const { result } = renderHook(() => useInfiniteGridRows<R>({ fetcher, initialPageSize: 10, resetKey: 'k', rowIdKey: 'id', paginated: PAGINATED_EMPTY }));
    act(() => result.current.setMode('infinite'));
    await waitFor(() => expect(result.current.rows).toHaveLength(100));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.rows).toHaveLength(150));

    let strictPromise!: Promise<void>;
    await act(async () => {
      strictPromise = result.current.refresh({ strict: true });
      await expect(strictPromise, 'a clean strict refresh must resolve').resolves.toBeUndefined();
    });

    expect(result.current.rows, 'strict refresh must reset back to page 0').toEqual(buildRows(0, 100));
    expect(result.current.totalRows).toBe(150);
    expect(result.current.error).toBeNull();
  });
});
