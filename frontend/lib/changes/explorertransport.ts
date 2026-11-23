import { HTTPResponses } from '@/config/macros';
import { CHANGE_EXPORT_ERROR_CODES, MAX_EXPORT_ROWS, type RecentChangesFilters } from '@/config/recentchangesexplorer';
import { extractFilenameFromContentDisposition } from '@/lib/errorsexplorer/explorertransport';

const EXPORT_ENDPOINT = '/api/changes/explorer/export';
const EXPORT_CSV_FALLBACK_FILENAME = 'changelog.csv';
const ROW_LIMIT_LOCALE = 'en-US';

export const CHANGE_EXPORT_FAILURE_MESSAGES = {
  tooLarge: `This export is larger than the ${MAX_EXPORT_ROWS.toLocaleString(ROW_LIMIT_LOCALE)}-row limit. Narrow the date range or pick a table, then export again.`,
  forbidden: 'You do not have access to this site.',
  unavailable: 'The export is temporarily unavailable. Try again shortly.',
  invalidRequest: 'The export request was not accepted. Reload the page and try again.',
  generic: 'The change log could not be exported.'
} as const;

/** What the export route answered with; the server's own text is never shown to the researcher. */
export class ChangeExportRequestError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(status: number, code: string | undefined) {
    super(`Change log export failed with status ${status}`);
    this.name = 'ChangeExportRequestError';
    this.status = status;
    this.code = code;
  }
}

export interface ChangeExportScope {
  schema: string;
  plotID: number;
}

function readErrorCode(body: unknown): string | undefined {
  return body !== null && typeof body === 'object' && 'code' in body && typeof body.code === 'string' ? body.code : undefined;
}

export async function postRecentChangesExport(
  scope: ChangeExportScope,
  filters: RecentChangesFilters,
  signal: AbortSignal
): Promise<{ blob: Blob; filename: string }> {
  const response = await fetch(EXPORT_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({ schema: scope.schema, plotID: scope.plotID, filters })
  });
  if (!response.ok) {
    // An error body is JSON from the route, but a proxy or a crash can answer with anything.
    const body: unknown = await response.json().catch(() => null);
    throw new ChangeExportRequestError(response.status, readErrorCode(body));
  }
  return {
    blob: await response.blob(),
    filename: extractFilenameFromContentDisposition(response.headers.get('Content-Disposition'), EXPORT_CSV_FALLBACK_FILENAME)
  };
}

/** The alert text for a failed export: by code first, then by status. */
export function changeExportFailureMessage(failure: Pick<ChangeExportRequestError, 'status' | 'code'>): string {
  if (failure.code === CHANGE_EXPORT_ERROR_CODES.tooLarge) return CHANGE_EXPORT_FAILURE_MESSAGES.tooLarge;
  if (failure.status === HTTPResponses.FORBIDDEN) return CHANGE_EXPORT_FAILURE_MESSAGES.forbidden;
  if (failure.status === HTTPResponses.SERVICE_UNAVAILABLE) return CHANGE_EXPORT_FAILURE_MESSAGES.unavailable;
  if (failure.status === HTTPResponses.INVALID_REQUEST) return CHANGE_EXPORT_FAILURE_MESSAGES.invalidRequest;
  return CHANGE_EXPORT_FAILURE_MESSAGES.generic;
}
