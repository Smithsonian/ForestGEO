'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type GridMode = 'paginated' | 'infinite';

export type InfiniteFetcherArgs = { page: number; pageSize: number; signal: AbortSignal };
export type InfiniteFetcherResult<R> = { rows: R[]; totalRows: number };

// strict rejects on fetch failure instead of only setting `error`, so an
// awaiting caller (the post-undo refresh chain) learns refresh failed.
// loadMore/retry/mode-switch never pass this — they stay void/non-throwing.
export type RefreshOptions = { strict?: boolean };

const GRID_REFRESH_CANCELLED_MESSAGE = 'Grid refresh was cancelled before its read completed.';

// Thrown only to a strict caller whose read was aborted with no newer read to
// follow. Never written to the visible `error` state: the read simply never
// happened, it is not a user-facing grid failure.
export class GridRefreshCancelledError extends Error {
  constructor() {
    super(GRID_REFRESH_CANCELLED_MESSAGE);
    this.name = 'GridRefreshCancelledError';
  }
}

type GridReadOutcome = { status: 'completed' } | { status: 'cancelled' } | { status: 'failed'; error: unknown };

const GRID_READ_COMPLETED: GridReadOutcome = { status: 'completed' };
const GRID_READ_CANCELLED: GridReadOutcome = { status: 'cancelled' };

export type UseInfiniteGridRowsOptions<R> = {
  fetcher: (args: InfiniteFetcherArgs) => Promise<InfiniteFetcherResult<R>>;
  initialPageSize: number;
  infiniteChunkSize?: number;
  resetKey: unknown;
  rowIdKey: keyof R;
  paginated: { rows: R[]; totalRows: number; isLoading: boolean };
};

export type UseInfiniteGridRowsResult<R> = {
  mode: GridMode;
  setMode: (next: GridMode) => void;
  rows: R[];
  totalRows: number;
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  loadMore: () => void;
  refresh: (options?: RefreshOptions) => Promise<void>;
  retry: () => void;
  error: Error | null;
  softCapExceeded: boolean;
  upsertRow: (row: R) => void;
  removeRow: (id: R[keyof R]) => void;
};

export const INFINITE_SOFT_CAP = 10_000;
export const INFINITE_DEFAULT_CHUNK = 100;

function appendUniqueRows<R>(existingRows: R[], incomingRows: R[], rowIdKey: keyof R): R[] {
  const nextRows = existingRows.slice();
  const indexByID = new Map<R[keyof R], number>();
  nextRows.forEach((row, index) => indexByID.set(row[rowIdKey], index));

  incomingRows.forEach(row => {
    const id = row[rowIdKey];
    const existingIndex = indexByID.get(id);
    if (existingIndex === undefined) {
      indexByID.set(id, nextRows.length);
      nextRows.push(row);
      return;
    }
    nextRows[existingIndex] = row;
  });

  return nextRows;
}

export function useInfiniteGridRows<R>(opts: UseInfiniteGridRowsOptions<R>): UseInfiniteGridRowsResult<R> {
  const { fetcher, infiniteChunkSize = INFINITE_DEFAULT_CHUNK, resetKey, rowIdKey, paginated } = opts;

  const [mode, setModeInternal] = useState<GridMode>('paginated');
  const [accumulator, setAccumulator] = useState<R[]>([]);
  const [infiniteTotal, setInfiniteTotal] = useState<number>(0);
  const [page, setPage] = useState<number>(0);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);
  const [failedPage, setFailedPage] = useState<number | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const tokenRef = useRef<number>(0);
  const inflightRef = useRef<boolean>(false);
  const lastResetKey = useRef<unknown>(resetKey);
  const lastMode = useRef<GridMode>(mode);
  const latestReadRef = useRef<{ token: number; outcome: Promise<GridReadOutcome> } | null>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const abortInFlight = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  const readPage = useCallback(
    async (targetPage: number, token: number, ctrl: AbortController): Promise<GridReadOutcome> => {
      const isSuperseded = () => token !== tokenRef.current || ctrl.signal.aborted;
      try {
        const res = await fetcherRef.current({ page: targetPage, pageSize: infiniteChunkSize, signal: ctrl.signal });
        if (isSuperseded()) return GRID_READ_CANCELLED;
        setAccumulator(prev => (targetPage === 0 ? res.rows : appendUniqueRows(prev, res.rows, rowIdKey)));
        setInfiniteTotal(res.totalRows);
        setPage(targetPage);
        setFailedPage(null);
        return GRID_READ_COMPLETED;
      } catch (e) {
        if (isSuperseded() || (e as { name?: string } | null)?.name === 'AbortError') return GRID_READ_CANCELLED;
        setError(e as Error);
        setFailedPage(targetPage);
        return { status: 'failed', error: e };
      } finally {
        if (token === tokenRef.current) {
          inflightRef.current = false;
          setIsLoadingMore(false);
        }
      }
    },
    [infiniteChunkSize, rowIdKey]
  );

  // A strict caller whose read was superseded follows the newer read and
  // reports its outcome; it rejects as cancelled only when no newer read exists.
  const confirmStrictRead = useCallback(async (token: number, outcome: GridReadOutcome) => {
    let followedToken = token;
    let followedOutcome = outcome;
    while (followedOutcome.status === 'cancelled') {
      const latest = latestReadRef.current;
      if (!latest || latest.token <= followedToken) throw new GridRefreshCancelledError();
      followedToken = latest.token;
      followedOutcome = await latest.outcome;
    }
    if (followedOutcome.status === 'failed') throw followedOutcome.error;
  }, []);

  const fetchPage = useCallback(
    async (targetPage: number, options?: RefreshOptions) => {
      abortInFlight();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const token = ++tokenRef.current;
      inflightRef.current = true;
      setIsLoadingMore(true);
      setError(null);
      const outcome = readPage(targetPage, token, ctrl);
      latestReadRef.current = { token, outcome };
      const settledOutcome = await outcome;
      if (options?.strict) await confirmStrictRead(token, settledOutcome);
    },
    [abortInFlight, confirmStrictRead, readPage]
  );

  const resetInfiniteState = useCallback(() => {
    setAccumulator([]);
    setInfiniteTotal(0);
    setPage(0);
    setError(null);
    setFailedPage(null);
  }, []);

  const setMode = useCallback((next: GridMode) => setModeInternal(next), []);

  useEffect(() => {
    if (lastMode.current === mode) return;
    lastMode.current = mode;

    if (mode === 'infinite') {
      resetInfiniteState();
      void fetchPage(0);
      return;
    }

    abortInFlight();
    resetInfiniteState();
  }, [abortInFlight, fetchPage, mode, resetInfiniteState]);

  useEffect(() => {
    if (lastResetKey.current === resetKey) return;
    lastResetKey.current = resetKey;
    if (mode === 'infinite') {
      resetInfiniteState();
      void fetchPage(0);
    }
  }, [resetKey, mode, fetchPage, resetInfiniteState]);

  useEffect(() => () => abortInFlight(), [abortInFlight]);

  const hasMore = mode === 'infinite' && accumulator.length < infiniteTotal;

  const loadMore = useCallback(() => {
    if (mode !== 'infinite' || isLoadingMore || inflightRef.current || !hasMore) return;
    void fetchPage(page + 1);
  }, [mode, isLoadingMore, hasMore, fetchPage, page]);

  const refresh = useCallback(
    (options?: RefreshOptions) => {
      if (mode !== 'infinite') return Promise.resolve();
      return fetchPage(0, options);
    },
    [mode, fetchPage]
  );

  const retry = useCallback(() => {
    if (mode !== 'infinite') return;
    void fetchPage(failedPage ?? 0);
  }, [failedPage, fetchPage, mode]);

  const upsertRow = useCallback(
    (row: R) => {
      if (mode !== 'infinite') return;
      setAccumulator(prev => {
        const id = row[rowIdKey];
        const idx = prev.findIndex(r => r[rowIdKey] === id);
        if (idx === -1) {
          setInfiniteTotal(t => t + 1);
          return [row, ...prev];
        }
        const next = prev.slice();
        next[idx] = row;
        return next;
      });
    },
    [mode, rowIdKey]
  );

  const removeRow = useCallback(
    (id: R[keyof R]) => {
      if (mode !== 'infinite') return;
      setAccumulator(prev => {
        const next = prev.filter(r => r[rowIdKey] !== id);
        if (next.length !== prev.length) setInfiniteTotal(t => Math.max(t - 1, 0));
        return next;
      });
    },
    [mode, rowIdKey]
  );

  return useMemo<UseInfiniteGridRowsResult<R>>(() => {
    if (mode === 'paginated') {
      return {
        mode,
        setMode,
        rows: paginated.rows,
        totalRows: paginated.totalRows,
        isLoading: paginated.isLoading,
        isLoadingMore: false,
        hasMore: false,
        loadMore: () => {},
        refresh,
        retry,
        error: null,
        softCapExceeded: false,
        upsertRow: () => {},
        removeRow: () => {}
      };
    }
    return {
      mode,
      setMode,
      rows: accumulator,
      totalRows: infiniteTotal,
      isLoading: accumulator.length === 0 && isLoadingMore,
      isLoadingMore,
      hasMore,
      loadMore,
      refresh,
      retry,
      error,
      softCapExceeded: accumulator.length > INFINITE_SOFT_CAP,
      upsertRow,
      removeRow
    };
  }, [mode, setMode, paginated, accumulator, infiniteTotal, isLoadingMore, hasMore, loadMore, refresh, retry, error, upsertRow, removeRow]);
}
