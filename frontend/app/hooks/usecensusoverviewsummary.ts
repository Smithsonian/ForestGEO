'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CENSUS_OVERVIEW_ERROR_CENSUS_IDS_SEPARATOR,
  CENSUS_OVERVIEW_SUMMARY_ENDPOINT,
  CENSUS_OVERVIEW_TEXT,
  type CensusOverviewSummary
} from '@/config/censusoverview';

export interface CensusOverviewSummaryScope {
  schema: string | undefined;
  plotID: number | undefined;
  /** Publish scope: dateRanges[0].censusID. */
  censusID: number | undefined;
  /** Errors scope: getDateRangeCensusIDs(census). */
  errorCensusIDs: readonly number[];
}

export interface UseCensusOverviewSummaryResult {
  summary: CensusOverviewSummary | null;
  errorMessage: string | null;
  isLoading: boolean;
  /** Bound to the scope it was created for; a no-op once the scope has changed. */
  refetch: () => void;
}

type ScopedSummaryResult =
  | { key: string; summary: CensusOverviewSummary; errorMessage?: undefined }
  | { key: string; summary?: undefined; errorMessage: string };

const SCOPE_KEY_SEPARATOR = '|';
const NO_SCOPE_KEY = '';

async function readErrorMessage(response: Response): Promise<string> {
  const fallback = `${CENSUS_OVERVIEW_TEXT.summaryLoadFailed} (HTTP ${response.status})`;
  try {
    const body: unknown = await response.json();
    if (body !== null && typeof body === 'object' && 'error' in body && typeof body.error === 'string') return body.error;
    return fallback;
  } catch (error: unknown) {
    if (error instanceof SyntaxError) return fallback;
    throw error;
  }
}

/**
 * Loads the census overview summary for one scope. Follows DataQualityCard's
 * request discipline: each fetch has a request id and AbortController, a stale
 * request (superseded, aborted, or for another scope) changes no state, loading
 * is derived from the stored result's scope, and refetch is bound to its scope.
 */
export function useCensusOverviewSummary({ schema, plotID, censusID, errorCensusIDs }: CensusOverviewSummaryScope): UseCensusOverviewSummaryResult {
  const errorCensusIDsKey = errorCensusIDs.join(CENSUS_OVERVIEW_ERROR_CENSUS_IDS_SEPARATOR);
  const scopeKey = schema && plotID && censusID && errorCensusIDsKey ? [schema, plotID, censusID, errorCensusIDsKey].join(SCOPE_KEY_SEPARATOR) : NO_SCOPE_KEY;
  const scopeKeyRef = useRef(scopeKey);
  scopeKeyRef.current = scopeKey;
  const requestRef = useRef<{ id: number; controller: AbortController } | null>(null);
  const requestCounterRef = useRef(0);
  const isMountedRef = useRef(false);
  const [result, setResult] = useState<ScopedSummaryResult | null>(null);

  const abortInFlight = useCallback(() => {
    requestRef.current?.controller.abort();
    requestRef.current = null;
  }, []);

  const fetchSummary = useCallback(async () => {
    if (scopeKey === NO_SCOPE_KEY || !schema || !plotID || !censusID) return;

    abortInFlight();
    const controller = new AbortController();
    const id = ++requestCounterRef.current;
    requestRef.current = { id, controller };
    const key = scopeKey;
    const isStale = () => requestRef.current?.id !== id || controller.signal.aborted || scopeKeyRef.current !== key;

    setResult(previous => (previous?.key === key && previous.summary ? previous : null));
    try {
      const endpoint = CENSUS_OVERVIEW_SUMMARY_ENDPOINT(
        schema,
        plotID,
        censusID,
        errorCensusIDsKey.split(CENSUS_OVERVIEW_ERROR_CENSUS_IDS_SEPARATOR).map(Number)
      );
      const response = await fetch(endpoint, { signal: controller.signal });
      if (isStale()) return;

      if (!response.ok) {
        const message = await readErrorMessage(response);
        if (isStale()) return;
        setResult({ key, errorMessage: message });
        return;
      }

      const summary = (await response.json()) as CensusOverviewSummary;
      if (isStale()) return;
      setResult({ key, summary });
    } catch (error: unknown) {
      if (isStale() || (error instanceof DOMException && error.name === 'AbortError')) return;
      setResult({ key, errorMessage: error instanceof Error ? error.message : String(error) });
    } finally {
      if (requestRef.current?.id === id) requestRef.current = null;
    }
  }, [scopeKey, schema, plotID, censusID, errorCensusIDsKey, abortInFlight]);

  useEffect(() => {
    if (scopeKey !== NO_SCOPE_KEY) void fetchSummary();
    // A scope change (or unmount) aborts the request for the scope being left.
    return abortInFlight;
  }, [scopeKey, fetchSummary, abortInFlight]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const refetch = useCallback(() => {
    // Checked before anything is aborted, so a stale caller cannot cancel the current scope's request.
    if (!isMountedRef.current || scopeKey === NO_SCOPE_KEY || scopeKeyRef.current !== scopeKey) return;
    void fetchSummary();
  }, [scopeKey, fetchSummary]);

  const scopedResult = result && result.key === scopeKey ? result : null;
  return {
    summary: scopedResult?.summary ?? null,
    errorMessage: scopedResult?.errorMessage ?? null,
    isLoading: scopeKey !== NO_SCOPE_KEY && scopedResult === null,
    refetch
  };
}
