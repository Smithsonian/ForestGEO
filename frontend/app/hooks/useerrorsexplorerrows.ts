'use client';

import { useCallback, useMemo } from 'react';
import {
  computeDbhChangePercent,
  toErrorTypeIdentity,
  type ErrorExplorerColumnFilter,
  type ErrorExplorerFilters,
  type ErrorExplorerQueryRequest,
  type ErrorExplorerQueryResponse,
  type ErrorExplorerRow,
  type ErrorExplorerSortItem,
  type ErrorsExplorerReadScope,
  type ErrorTypeIdentity
} from '@/config/errorsexplorer';
import { useErrorsExplorerRequest, type ErrorsExplorerRequestStatus } from './useerrorsexplorerrequest';
import type { RefreshOptions } from '@/components/datagrids/hooks/useinfinitegridrows';

export const ERRORS_EXPLORER_QUERY_ENDPOINT = '/api/errors/explorer/query';
const ROWS_LOAD_FALLBACK_MESSAGE = 'Failed to load errors';

export interface ErrorsExplorerRowsQuery {
  filters: ErrorExplorerFilters;
  errorType?: ErrorTypeIdentity;
  page: number;
  pageSize: number;
  sortModel: ErrorExplorerSortItem[];
  columnFilters: ErrorExplorerColumnFilter[];
}

export function buildErrorsExplorerQueryBody(scope: ErrorsExplorerReadScope, query: ErrorsExplorerRowsQuery): ErrorExplorerQueryRequest {
  const { source, exactMessages, affectedFields, contradictionOnly, contradictionTypes, quickSearch } = query.filters;
  return {
    schema: scope.schema,
    plotID: scope.plotID,
    censusID: scope.censusID,
    censusIDs: scope.censusIDs,
    page: query.page,
    pageSize: query.pageSize,
    filters: { source, exactMessages, affectedFields, contradictionOnly, contradictionTypes, quickSearch },
    ...(query.errorType ? { errorType: toErrorTypeIdentity(query.errorType) } : {}),
    sortModel: query.sortModel,
    columnFilters: query.columnFilters
  };
}

export async function postErrorsExplorerQuery(body: ErrorExplorerQueryRequest, signal: AbortSignal): Promise<ErrorExplorerQueryResponse> {
  const response = await fetch(ERRORS_EXPLORER_QUERY_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify(body)
  });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok || data === null || typeof data !== 'object' || 'error' in data) {
    const message = data !== null && typeof data === 'object' && 'error' in data && typeof data.error === 'string' ? data.error : ROWS_LOAD_FALLBACK_MESSAGE;
    throw new Error(message);
  }
  return data as ErrorExplorerQueryResponse;
}

/** What a grid shows about a row depends on its error type, so another grid's copy of the same row keeps its own values. */
const ERROR_TYPE_VIEW_FIELDS = [
  'primaryErrorMessage',
  'errorMessages',
  'errorSources',
  'errorFields',
  'errorCodes',
  'errorCount',
  'contradictionTypes',
  'contradictionType',
  'contradictionGroupKey',
  'relatedMeasurementIDs',
  'priorCensusID',
  'priorDBH',
  'priorHOM',
  'homChanged'
] as const satisfies ReadonlyArray<keyof ErrorExplorerRow>;

/** Today's syncEditedRowLocally merge (errorsexplorer.tsx:294-300): keeps uploaded codes unless the edit changed them. */
export function mergeEditedRow(existingRow: ErrorExplorerRow, updatedRow: ErrorExplorerRow): ErrorExplorerRow {
  const errorTypeView = Object.fromEntries(ERROR_TYPE_VIEW_FIELDS.map(field => [field, existingRow[field]]));
  const merged = { ...existingRow, ...updatedRow, ...errorTypeView, rawCodes: updatedRow.rawCodes ?? existingRow.rawCodes } as ErrorExplorerRow;
  return { ...merged, dbhChangePercent: computeDbhChangePercent(merged.priorDBH, merged.measuredDBH) };
}

export interface UseErrorsExplorerRowsArgs {
  readScope: ErrorsExplorerReadScope | null;
  readScopeKey: string;
  query: ErrorsExplorerRowsQuery;
  enabled: boolean;
  gated: boolean;
}

export interface UseErrorsExplorerRowsResult {
  rows: ErrorExplorerRow[];
  totalRows: number;
  status: ErrorsExplorerRequestStatus;
  errorMessage: string | null;
  isStale: boolean;
  reload: (options?: RefreshOptions) => Promise<void>;
  patchRow: (row: ErrorExplorerRow) => void;
}

const NO_ROWS: ErrorExplorerRow[] = [];

export function useErrorsExplorerRows({ readScope, readScopeKey, query, enabled, gated }: UseErrorsExplorerRowsArgs): UseErrorsExplorerRowsResult {
  const body = useMemo(() => (readScope ? buildErrorsExplorerQueryBody(readScope, query) : null), [readScope, query]);
  const requestKey = enabled && body ? `rows|${readScopeKey}|${JSON.stringify(body)}` : null;
  const request = useErrorsExplorerRequest<ErrorExplorerQueryResponse>({
    requestKey,
    load: signal => {
      if (!body) throw new Error(ROWS_LOAD_FALLBACK_MESSAGE);
      return postErrorsExplorerQuery(body, signal);
    },
    gated
  });
  const { updateData } = request;
  const patchRow = useCallback(
    (updatedRow: ErrorExplorerRow) =>
      updateData(current => ({
        ...current,
        rows: current.rows.map(row => (row.coreMeasurementID === updatedRow.coreMeasurementID ? mergeEditedRow(row, updatedRow) : row))
      })),
    [updateData]
  );
  return {
    rows: request.data?.rows ?? NO_ROWS,
    totalRows: request.data?.totalRows ?? 0,
    status: request.status,
    errorMessage: request.errorMessage,
    isStale: request.isStale,
    reload: request.reload,
    patchRow
  };
}
