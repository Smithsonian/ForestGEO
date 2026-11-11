import type {
  ErrorExplorerDetailsResponse,
  ErrorExplorerFacetsResponse,
  ErrorExplorerFilters,
  ErrorsExplorerReadScope,
  RowMutationScope
} from '@/config/errorsexplorer';

const FACETS_ENDPOINT = '/api/errors/explorer/facets';
const DETAILS_ENDPOINT = '/api/errors/explorer/details';
const EXPORT_ENDPOINT = '/api/errors/explorer/export';
const FACETS_FALLBACK_MESSAGE = 'Failed to load the census totals';
const DETAILS_FALLBACK_MESSAGE = 'Failed to load row details';
const EXPORT_FALLBACK_MESSAGE = 'Failed to export errors';
const EXPORT_CSV_FALLBACK_FILENAME = 'errors.csv';
const CONTENT_DISPOSITION_FILENAME = /filename="([^"]+)"/;

function wireFilters({ source, exactMessages, affectedFields, contradictionOnly, contradictionTypes, quickSearch }: ErrorExplorerFilters) {
  return { source, exactMessages, affectedFields, contradictionOnly, contradictionTypes, quickSearch };
}

function scopeBody(scope: ErrorsExplorerReadScope, filters: ErrorExplorerFilters) {
  return { schema: scope.schema, plotID: scope.plotID, censusID: scope.censusID, censusIDs: scope.censusIDs, filters: wireFilters(filters) };
}

async function readJsonOrThrow<T>(response: Response, fallback: string): Promise<T> {
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok || data === null || typeof data !== 'object' || 'error' in data) {
    const message = data !== null && typeof data === 'object' && 'error' in data && typeof data.error === 'string' ? data.error : fallback;
    throw new Error(message);
  }
  return data as T;
}

export async function postErrorsExplorerFacets(
  scope: ErrorsExplorerReadScope,
  filters: ErrorExplorerFilters,
  signal: AbortSignal
): Promise<ErrorExplorerFacetsResponse> {
  const response = await fetch(FACETS_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify(scopeBody(scope, filters))
  });
  return readJsonOrThrow<ErrorExplorerFacetsResponse>(response, FACETS_FALLBACK_MESSAGE);
}

export async function getErrorsExplorerDetails(scope: RowMutationScope, measurementID: number, signal: AbortSignal): Promise<ErrorExplorerDetailsResponse> {
  const search = new URLSearchParams({ schema: scope.schema, plotID: String(scope.plotID), censusID: String(scope.censusID) });
  const response = await fetch(`${DETAILS_ENDPOINT}/${measurementID}?${search.toString()}`, { signal });
  return readJsonOrThrow<ErrorExplorerDetailsResponse>(response, DETAILS_FALLBACK_MESSAGE);
}

export function extractFilenameFromContentDisposition(headerValue: string | null): string {
  return headerValue?.match(CONTENT_DISPOSITION_FILENAME)?.[1] ?? EXPORT_CSV_FALLBACK_FILENAME;
}

export async function postErrorsExplorerExport(scope: ErrorsExplorerReadScope, filters: ErrorExplorerFilters): Promise<{ blob: Blob; filename: string }> {
  const response = await fetch(EXPORT_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(scopeBody(scope, filters))
  });
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    throw new Error(data !== null && typeof data === 'object' && 'error' in data && typeof data.error === 'string' ? data.error : EXPORT_FALLBACK_MESSAGE);
  }
  return { blob: await response.blob(), filename: extractFilenameFromContentDisposition(response.headers.get('Content-Disposition')) };
}
