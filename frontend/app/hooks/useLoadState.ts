'use client';

import { useState, useCallback } from 'react';

export type LoadState = 'idle' | 'loading' | 'loaded' | 'error';

export interface UseLoadStateReturn {
  state: LoadState;
  isIdle: boolean;
  isLoading: boolean;
  isLoaded: boolean;
  isError: boolean;
  setLoading: () => void;
  setLoaded: () => void;
  setError: () => void;
  reset: () => void;
}

/**
 * Hook for managing async data loading states.
 * Provides a state machine with idle/loading/loaded/error states
 * and convenient boolean flags for each state.
 *
 * @param initial - Initial state (defaults to 'idle')
 * @returns Object with state, boolean flags, and state setters
 *
 * @example
 * const siteList = useLoadState();
 *
 * // In fetch function:
 * siteList.setLoading();
 * try {
 *   await fetchData();
 *   siteList.setLoaded();
 * } catch {
 *   siteList.setError();
 * }
 *
 * // In render:
 * if (siteList.isLoading) return <Spinner />;
 * if (siteList.isError) return <ErrorMessage />;
 */
export function useLoadState(initial: LoadState = 'idle'): UseLoadStateReturn {
  const [state, setState] = useState<LoadState>(initial);

  const setLoading = useCallback(() => setState('loading'), []);
  const setLoaded = useCallback(() => setState('loaded'), []);
  const setError = useCallback(() => setState('error'), []);
  const reset = useCallback(() => setState('idle'), []);

  return {
    state,
    isIdle: state === 'idle',
    isLoading: state === 'loading',
    isLoaded: state === 'loaded',
    isError: state === 'error',
    setLoading,
    setLoaded,
    setError,
    reset
  };
}

/**
 * Combines multiple load states into aggregate status flags.
 * Useful for determining overall loading status across multiple resources.
 *
 * @param states - Array of UseLoadStateReturn objects
 * @returns Object with aggregate boolean flags
 *
 * @example
 * const siteList = useLoadState();
 * const plotList = useLoadState();
 * const { allLoaded, anyError, anyLoading } = combineLoadStates([siteList, plotList]);
 */
export function combineLoadStates(states: UseLoadStateReturn[]) {
  return {
    allLoaded: states.every(s => s.isLoaded),
    allIdle: states.every(s => s.isIdle),
    anyLoading: states.some(s => s.isLoading),
    anyError: states.some(s => s.isError),
    // Returns first error state found, useful for showing which resource failed
    firstError: states.find(s => s.isError)
  };
}
