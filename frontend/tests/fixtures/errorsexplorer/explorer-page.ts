import { vi } from 'vitest';
import type { ErrorCensusTotals, ErrorExplorerFacetsResponse, ErrorExplorerRow, ErrorTypeFacet } from '@/config/errorsexplorer';

export const PAGE_SCHEMA = 'forestgeo_testing';
export const PAGE_PLOT_ID = 22;
export const FIRST_CENSUS_ID = 6;
export const SECOND_CENSUS_ID = 7;
export const PAGE_ACTIVE_MEASUREMENTS = 88;

export function explorerRow(id: number, overrides: Partial<ErrorExplorerRow> = {}): ErrorExplorerRow {
  return {
    id,
    coreMeasurementID: id,
    plotID: PAGE_PLOT_ID,
    censusID: FIRST_CENSUS_ID,
    treeTag: `T-${id}`,
    stemTag: 'S-1',
    speciesCode: 'ACRU',
    quadratName: '0101',
    measurementDate: '2026-01-01',
    measuredDBH: 10,
    measuredHOM: 1.3,
    stemLocalX: 1.23,
    stemLocalY: 4.56,
    attributes: 'L',
    rawCodes: 'L',
    description: 'desc',
    primaryErrorMessage: 'example error',
    errorMessages: ['example error'],
    errorSources: ['validation'],
    errorFields: ['measuredDBH'],
    errorCodes: ['VLD-1'],
    errorCount: 1,
    totalErrorCount: 1,
    hasContradiction: false,
    contradictionTypes: [],
    contradictionType: null,
    contradictionGroupKey: null,
    relatedMeasurementIDs: [],
    isFailedRow: false,
    priorDBH: null,
    dbhChangePercent: null,
    ...overrides
  } as ErrorExplorerRow;
}

export function facetOf(row: ErrorExplorerRow, count = 1): ErrorTypeFacet {
  return {
    source: row.errorSources[0],
    code: row.errorCodes[0],
    message: row.primaryErrorMessage,
    fields: row.errorFields,
    count,
    hasContradiction: row.hasContradiction
  };
}

export function censusTotals(overrides: Partial<ErrorCensusTotals> = {}): ErrorCensusTotals {
  return {
    affectedMeasurements: 1,
    activeMeasurements: PAGE_ACTIVE_MEASUREMENTS,
    errorTypeCount: 1,
    validation: 1,
    ingestion: 0,
    failedMeasurements: 0,
    contradictions: 0,
    duplicateTagStem: 0,
    sameBatchConflict: 0,
    ...overrides
  };
}

export function facetsResponse(errorTypes: ErrorTypeFacet[], totals: Partial<ErrorCensusTotals> = {}): ErrorExplorerFacetsResponse {
  return { errorTypes, censusTotals: censusTotals(totals) } as ErrorExplorerFacetsResponse;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export interface RecordedRequest {
  url: string;
  body: Record<string, unknown> | null;
  signal: AbortSignal | undefined;
}

export interface FetchRoute {
  match: RegExp;
  respond: (request: RecordedRequest) => Response | Promise<Response>;
}

export function installPageFetch(routes: FetchRoute[]) {
  const requests: RecordedRequest[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request: RecordedRequest = { url: String(input), body: init?.body ? JSON.parse(String(init.body)) : null, signal: init?.signal ?? undefined };
    requests.push(request);
    const route = routes.find(candidate => candidate.match.test(request.url));
    if (!route) return jsonResponse({ error: `No test route for ${request.url}` }, 404);
    return route.respond(request);
  });
  vi.stubGlobal('fetch', fetchMock);
  return {
    fetchMock,
    requests,
    bodiesFor: (pattern: RegExp) => requests.filter(request => pattern.test(request.url)).map(request => request.body),
    urlsSince: (start: number) => requests.slice(start).map(request => request.url)
  };
}

export function installMemoryStorage(): Map<string, string> {
  const store = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: key => (store.has(key) ? (store.get(key) as string) : null),
    key: index => Array.from(store.keys())[index] ?? null,
    removeItem: key => {
      store.delete(key);
    },
    setItem: (key, value) => {
      store.set(key, String(value));
    }
  };
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
  return store;
}

export const ROUTES = {
  facets: /\/api\/errors\/explorer\/facets/,
  query: /\/api\/errors\/explorer\/query/,
  details: /\/api\/errors\/explorer\/details\//,
  export: /\/api\/errors\/explorer\/export/,
  preview: /\/api\/edits\/preview/,
  apply: /\/api\/edits\/apply/,
  revert: /\/api\/edits\/revert/,
  rebuildSummary: /\/api\/refreshviews\/measurementssummary\//,
  rebuildFullTable: /\/api\/refreshviews\/viewfulltable\//,
  rebuild: /\/api\/refreshviews\//,
  clear: /\/api\/validations\/clearmeasurementerrors/
} as const;
