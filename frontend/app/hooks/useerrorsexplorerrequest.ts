'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefreshOptions } from '@/components/datagrids/hooks/useinfinitegridrows';
import { VIEW_ERRORS_ALERTS } from '@/config/errorsexplorer';

export type ErrorsExplorerRequestStatus = 'idle' | 'loading' | 'ready' | 'error';

/** A strict read the pending-rebuild gate kept from running (or aborted): the caller's refresh did not happen. */
export class ErrorsExplorerReadGatedError extends Error {
  constructor() {
    super(VIEW_ERRORS_ALERTS.pendingRebuild);
    this.name = 'ErrorsExplorerReadGatedError';
  }
}

type RunOutcome = { status: 'completed' } | { status: 'dropped' } | { status: 'failed'; error: Error };
const RUN_COMPLETED: RunOutcome = { status: 'completed' };
const RUN_DROPPED: RunOutcome = { status: 'dropped' };

export interface UseErrorsExplorerRequestOptions<T> {
  /** null: nothing to load (no scope, or the unit is closed). Include the read scope key so a census change is a new key. */
  requestKey: string | null;
  load: (signal: AbortSignal) => Promise<T>;
  /** A pending view rebuild overlaps this read: run nothing and show stale until the gate lifts. */
  gated?: boolean;
  /** Data loaded under another data scope is never shown (the totals across a census change; the sheet across rows). Omit to keep data across keys. */
  dataScopeKey?: string | null;
}

export interface UseErrorsExplorerRequestResult<T> {
  data: T | null;
  status: ErrorsExplorerRequestStatus;
  errorMessage: string | null;
  /** Older data is shown after a failed refresh, or the read is gated. */
  isStale: boolean;
  reload: (options?: RefreshOptions) => Promise<void>;
  updateData: (updater: (current: T) => T) => void;
}

interface RequestState<T> {
  data: T | null;
  dataScopeKey: string | null | undefined;
  status: ErrorsExplorerRequestStatus;
  errorMessage: string | null;
  refreshFailed: boolean;
  staleUntilSuccess: boolean;
}

const INITIAL_STATE = { data: null, dataScopeKey: undefined, status: 'idle', errorMessage: null, refreshFailed: false, staleUntilSuccess: false } as const;

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/** The census overview hook's discipline (usecensusoverviewsummary.ts): request id + AbortController, stale responses change no state. */
export function useErrorsExplorerRequest<T>({
  requestKey,
  load,
  gated = false,
  dataScopeKey
}: UseErrorsExplorerRequestOptions<T>): UseErrorsExplorerRequestResult<T> {
  const loadRef = useRef(load);
  loadRef.current = load;
  const requestKeyRef = useRef(requestKey);
  requestKeyRef.current = requestKey;
  const gatedRef = useRef(gated);
  gatedRef.current = gated;
  const dataScopeKeyRef = useRef(dataScopeKey);
  dataScopeKeyRef.current = dataScopeKey;
  const requestRef = useRef<{ id: number; controller: AbortController } | null>(null);
  const requestCounterRef = useRef(0);
  const latestRunRef = useRef<{ id: number; key: string; outcome: Promise<RunOutcome> } | null>(null);
  const mountedRef = useRef(true);
  const [state, setState] = useState<RequestState<T>>(INITIAL_STATE);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const abortInFlight = useCallback(() => {
    requestRef.current?.controller.abort();
    requestRef.current = null;
  }, []);

  const readOnce = useCallback(async (key: string, id: number, controller: AbortController): Promise<RunOutcome> => {
    const isStale = () => requestRef.current?.id !== id || controller.signal.aborted || requestKeyRef.current !== key;
    setState(previous => ({ ...previous, status: 'loading' }));
    try {
      const data = await loadRef.current(controller.signal);
      if (isStale()) return RUN_DROPPED;
      setState({ data, dataScopeKey: dataScopeKeyRef.current, status: 'ready', errorMessage: null, refreshFailed: false, staleUntilSuccess: false });
      return RUN_COMPLETED;
    } catch (error: unknown) {
      if (isStale() || isAbortError(error)) return RUN_DROPPED;
      const failure = error instanceof Error ? error : new Error(String(error));
      setState(previous => ({ ...previous, status: 'error', errorMessage: failure.message, refreshFailed: previous.data !== null }));
      return { status: 'failed', error: failure };
    } finally {
      if (requestRef.current?.id === id) requestRef.current = null;
    }
  }, []);

  // A strict run that a same-key run superseded follows that run's outcome; the gate aborting it is a gated failure;
  // a run dropped because the key changed or the unit unmounted resolves quietly.
  const confirmStrictRun = useCallback(async (key: string, id: number, outcome: RunOutcome): Promise<void> => {
    let followedID = id;
    let followed = outcome;
    while (followed.status === 'dropped') {
      if (!mountedRef.current || requestKeyRef.current !== key) return;
      const latest = latestRunRef.current;
      if (!latest || latest.id <= followedID || latest.key !== key) {
        if (gatedRef.current) throw new ErrorsExplorerReadGatedError();
        return;
      }
      followedID = latest.id;
      followed = await latest.outcome;
    }
    if (followed.status === 'failed') throw followed.error;
  }, []);

  const run = useCallback(
    async (options?: RefreshOptions) => {
      const key = requestKeyRef.current;
      if (key === null) return;
      if (gatedRef.current) {
        if (options?.strict) throw new ErrorsExplorerReadGatedError();
        return;
      }
      abortInFlight();
      const controller = new AbortController();
      const id = ++requestCounterRef.current;
      requestRef.current = { id, controller };
      const outcome = readOnce(key, id, controller);
      latestRunRef.current = { id, key, outcome };
      const settled = await outcome;
      if (options?.strict) await confirmStrictRun(key, id, settled);
    },
    [abortInFlight, confirmStrictRun, readOnce]
  );

  useEffect(() => {
    if (requestKey === null) return;
    if (gated) {
      // The gate aborted any read in flight (the previous run's cleanup), and an aborted read settles nothing itself.
      setState(previous => ({
        ...previous,
        staleUntilSuccess: true,
        status: previous.status === 'loading' ? (previous.data !== null ? 'ready' : 'idle') : previous.status
      }));
      return;
    }
    void run();
    return abortInFlight;
  }, [requestKey, gated, run, abortInFlight]);

  const updateData = useCallback((updater: (current: T) => T) => {
    setState(previous => (previous.data === null ? previous : { ...previous, data: updater(previous.data) }));
  }, []);

  const showsData = dataScopeKey === undefined || state.dataScopeKey === dataScopeKey;
  const data = showsData ? state.data : null;
  const status: ErrorsExplorerRequestStatus = !showsData && requestKey !== null && state.status !== 'error' ? 'loading' : state.status;
  return {
    data,
    status,
    errorMessage: state.errorMessage,
    isStale: gated || state.staleUntilSuccess || (state.refreshFailed && data !== null),
    reload: run,
    updateData
  };
}
