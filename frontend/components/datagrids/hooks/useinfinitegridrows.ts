'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type GridMode = 'paginated' | 'infinite';

export type InfiniteFetcherArgs = { page: number; pageSize: number; signal: AbortSignal };
export type InfiniteFetcherResult<R> = { rows: R[]; totalRows: number };

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
  refresh: () => void;
  error: Error | null;
  softCapExceeded: boolean;
  upsertRow: (row: R) => void;
  removeRow: (id: R[keyof R]) => void;
};

export const INFINITE_SOFT_CAP = 10_000;
export const INFINITE_DEFAULT_CHUNK = 100;

export function useInfiniteGridRows<R>(opts: UseInfiniteGridRowsOptions<R>): UseInfiniteGridRowsResult<R> {
  const { fetcher, infiniteChunkSize = INFINITE_DEFAULT_CHUNK, resetKey, rowIdKey, paginated } = opts;

  const [mode, setModeInternal] = useState<GridMode>('paginated');
  const [accumulator, setAccumulator] = useState<R[]>([]);
  const [infiniteTotal, setInfiniteTotal] = useState<number>(0);
  const [page, setPage] = useState<number>(0);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const tokenRef = useRef<number>(0);
  const inflightRef = useRef<boolean>(false);
  const lastResetKey = useRef<unknown>(resetKey);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const abortInFlight = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  const fetchPage = useCallback(
    async (targetPage: number) => {
      abortInFlight();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const token = ++tokenRef.current;
      inflightRef.current = true;
      setIsLoadingMore(true);
      setError(null);
      try {
        const res = await fetcherRef.current({ page: targetPage, pageSize: infiniteChunkSize, signal: ctrl.signal });
        if (token !== tokenRef.current) return;
        setAccumulator(prev => (targetPage === 0 ? res.rows : prev.concat(res.rows)));
        setInfiniteTotal(res.totalRows);
        setPage(targetPage);
      } catch (e) {
        if (token !== tokenRef.current) return;
        const err = e as { name?: string };
        if (err && err.name === 'AbortError') return;
        setError(e as Error);
      } finally {
        if (token === tokenRef.current) {
          inflightRef.current = false;
          setIsLoadingMore(false);
        }
      }
    },
    [abortInFlight, infiniteChunkSize]
  );

  const setMode = useCallback(
    (next: GridMode) => {
      setModeInternal(prev => {
        if (prev === next) return prev;
        if (next === 'infinite') {
          setAccumulator([]);
          setInfiniteTotal(0);
          setPage(0);
          setError(null);
          void fetchPage(0);
        } else {
          abortInFlight();
          setAccumulator([]);
          setInfiniteTotal(0);
          setError(null);
        }
        return next;
      });
    },
    [abortInFlight, fetchPage]
  );

  useEffect(() => {
    if (lastResetKey.current === resetKey) return;
    lastResetKey.current = resetKey;
    if (mode === 'infinite') {
      setAccumulator([]);
      setInfiniteTotal(0);
      setPage(0);
      void fetchPage(0);
    }
  }, [resetKey, mode, fetchPage]);

  useEffect(() => () => abortInFlight(), [abortInFlight]);

  const hasMore = mode === 'infinite' && accumulator.length < infiniteTotal;

  const loadMore = useCallback(() => {
    if (mode !== 'infinite' || isLoadingMore || inflightRef.current || !hasMore) return;
    void fetchPage(page + 1);
  }, [mode, isLoadingMore, hasMore, fetchPage, page]);

  const refresh = useCallback(() => {
    if (mode === 'infinite') void fetchPage(0);
  }, [mode, fetchPage]);

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
      error,
      softCapExceeded: accumulator.length > INFINITE_SOFT_CAP,
      upsertRow,
      removeRow
    };
  }, [mode, setMode, paginated, accumulator, infiniteTotal, isLoadingMore, hasMore, loadMore, refresh, error, upsertRow, removeRow]);
}
