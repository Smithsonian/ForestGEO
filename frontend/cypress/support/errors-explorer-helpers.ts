import type {
  ContradictionType,
  ErrorCensusTotals,
  ErrorDetailRecord,
  ErrorExplorerDetailsResponse,
  ErrorExplorerFacetsResponse,
  ErrorExplorerFilters,
  ErrorExplorerQueryRequest,
  ErrorExplorerQueryResponse,
  ErrorExplorerRow,
  ErrorTypeFacet,
  ErrorTypeIdentity,
  RelatedContradictionRow
} from '../../config/errorsexplorer';
import { buildErrorTypeKey, FALLBACK_ERROR_CODE } from '../../config/errorsexplorer';
import { compareRowsBySortItem, matchesColumnFilter, type ColumnValueRow } from '../../lib/errorsexplorer/columnquery';
import { canonicalDiffToRowPatch, mockEditPlanFlow, type EditPlanApplyContext, type EditPlanApplyResponse } from './edit-plan-helpers';

export const MOCK_ACTIVE_MEASUREMENTS = 100;
const CLEAR_ROUTE_PATTERN = '**/api/validations/clearmeasurementerrors';
const CLEARED_ERROR_COUNT = 1;

function getContradictionTypes(row: Pick<ErrorExplorerRow, 'contradictionTypes' | 'contradictionType'>): ContradictionType[] {
  if (row.contradictionTypes.length > 0) {
    return row.contradictionTypes;
  }

  return row.contradictionType ? [row.contradictionType] : [];
}

function includesAny<T>(source: T[], values: T[]) {
  if (values.length === 0) return true;
  return values.some(value => source.includes(value));
}

function buildQuickSearchHaystack(row: ErrorExplorerRow) {
  return [row.treeTag, row.stemTag, row.speciesCode, row.quadratName, row.primaryErrorMessage, row.description, ...row.errorMessages]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function filterRows(rows: ErrorExplorerRow[], filters: ErrorExplorerFilters) {
  return rows.filter(row => {
    if (filters.source !== 'all' && !row.errorSources.includes(filters.source)) {
      return false;
    }

    if (!includesAny(row.errorMessages, filters.exactMessages)) {
      return false;
    }

    if (!includesAny(row.errorFields, filters.affectedFields)) {
      return false;
    }

    if (filters.contradictionOnly && !row.hasContradiction) {
      return false;
    }

    if (!includesAny(getContradictionTypes(row), filters.contradictionTypes)) {
      return false;
    }

    if (filters.quickSearch.trim().length > 0) {
      const quickSearch = filters.quickSearch.trim().toLowerCase();
      if (!buildQuickSearchHaystack(row).includes(quickSearch)) {
        return false;
      }
    }

    return true;
  });
}

function deriveAllErrors(row: ErrorExplorerRow): ErrorDetailRecord[] {
  return row.errorMessages.map((message, index) => ({
    source: row.errorSources[index] ?? row.errorSources[0] ?? 'validation',
    code: row.errorCodes[index] ?? row.errorCodes[0] ?? FALLBACK_ERROR_CODE,
    message,
    fields: row.errorFields.length > 0 ? row.errorFields : [],
    comparison: null
  }));
}

/** The occurrences the page filters keep: the server's materializeMatchingErrors for Show and the message chips. */
function deriveMatchingErrors(row: ErrorExplorerRow, filters: ErrorExplorerFilters): ErrorDetailRecord[] {
  return deriveAllErrors(row).filter(
    error =>
      (filters.source === 'all' || error.source === filters.source) && (filters.exactMessages.length === 0 || filters.exactMessages.includes(error.message))
  );
}

function toColumnValueRow(row: ErrorExplorerRow): ColumnValueRow {
  return { ...row, coreMeasurementID: Number(row.coreMeasurementID) };
}

function matchesErrorType(error: ErrorDetailRecord, identity: ErrorTypeIdentity): boolean {
  return buildErrorTypeKey(error) === buildErrorTypeKey(identity);
}

function compareErrorTypeFacets(a: ErrorTypeFacet, b: ErrorTypeFacet): number {
  return b.count - a.count || a.message.localeCompare(b.message) || a.source.localeCompare(b.source) || a.code.localeCompare(b.code);
}

interface ErrorTypeAccumulator {
  identity: ErrorTypeIdentity;
  measurementIDs: Set<number>;
  fields: Set<string>;
  hasContradiction: boolean;
}

export function deriveErrorTypes(rows: ErrorExplorerRow[], filters: ErrorExplorerFilters): ErrorTypeFacet[] {
  const byIdentity = new Map<string, ErrorTypeAccumulator>();
  filterRows(rows, filters).forEach(row => {
    deriveMatchingErrors(row, filters).forEach(error => {
      const key = buildErrorTypeKey(error);
      const entry = byIdentity.get(key) ?? {
        identity: { source: error.source, code: error.code, message: error.message },
        measurementIDs: new Set<number>(),
        fields: new Set<string>(),
        hasContradiction: false
      };
      entry.measurementIDs.add(Number(row.coreMeasurementID));
      error.fields.forEach(field => entry.fields.add(field));
      if (row.hasContradiction) entry.hasContradiction = true;
      byIdentity.set(key, entry);
    });
  });
  return Array.from(byIdentity.values())
    .map(entry => ({ ...entry.identity, fields: Array.from(entry.fields), count: entry.measurementIDs.size, hasContradiction: entry.hasContradiction }))
    .sort(compareErrorTypeFacets);
}

export function deriveCensusTotals(rows: ErrorExplorerRow[], activeMeasurements: number): ErrorCensusTotals {
  const hasSource = (row: ErrorExplorerRow, source: ErrorTypeIdentity['source']) => deriveAllErrors(row).some(error => error.source === source);
  return {
    affectedMeasurements: rows.length,
    activeMeasurements,
    errorTypeCount: new Set(rows.flatMap(row => deriveAllErrors(row).map(buildErrorTypeKey))).size,
    validation: rows.filter(row => hasSource(row, 'validation')).length,
    ingestion: rows.filter(row => hasSource(row, 'ingestion')).length,
    failedMeasurements: rows.filter(row => row.isFailedRow).length,
    contradictions: rows.filter(row => row.hasContradiction).length,
    duplicateTagStem: rows.filter(row => row.contradictionTypes.includes('duplicate_tag_stem')).length,
    sameBatchConflict: rows.filter(row => row.contradictionTypes.includes('same_batch_conflict')).length
  };
}

function buildRelatedRow(row: ErrorExplorerRow): RelatedContradictionRow {
  return {
    coreMeasurementID: row.coreMeasurementID,
    treeTag: row.treeTag,
    stemTag: row.stemTag,
    speciesCode: row.speciesCode,
    quadratName: row.quadratName,
    measurementDate: row.measurementDate,
    measuredDBH: row.measuredDBH,
    measuredHOM: row.measuredHOM,
    stemLocalX: row.stemLocalX,
    stemLocalY: row.stemLocalY,
    description: row.description,
    uploadFileID: row.uploadFileID,
    uploadBatchID: row.uploadBatchID,
    primaryErrorMessage: row.primaryErrorMessage,
    errorCount: row.errorCount,
    errorMessages: row.errorMessages,
    inErrorSet: row.errorCount > 0
  };
}

export function buildErrorsExplorerRow(overrides: Partial<ErrorExplorerRow> = {}): ErrorExplorerRow {
  const coreMeasurementID = overrides.coreMeasurementID ?? 101;
  const contradictionType = overrides.contradictionType ?? null;

  return {
    id: overrides.id ?? coreMeasurementID,
    coreMeasurementID,
    censusID: overrides.censusID ?? 5,
    plotID: overrides.plotID ?? 1,
    quadratID: overrides.quadratID ?? 1,
    treeID: overrides.treeID ?? 1000 + coreMeasurementID,
    stemGUID: overrides.stemGUID ?? 2000 + coreMeasurementID,
    speciesID: overrides.speciesID ?? 3000 + coreMeasurementID,
    quadratName: overrides.quadratName ?? '0001',
    speciesName: overrides.speciesName ?? 'Mock species',
    subspeciesName: overrides.subspeciesName ?? null,
    speciesCode: overrides.speciesCode ?? 'RUBI04',
    treeTag: overrides.treeTag ?? `TREE-${coreMeasurementID}`,
    stemTag: overrides.stemTag ?? '1',
    stemLocalX: overrides.stemLocalX ?? 12.5,
    stemLocalY: overrides.stemLocalY ?? 24.5,
    measurementDate: overrides.measurementDate ?? '2024-06-15',
    measuredDBH: overrides.measuredDBH ?? 15.4,
    measuredHOM: overrides.measuredHOM ?? 1.3,
    isValidated: overrides.isValidated ?? false,
    description: overrides.description ?? 'Invalid species reference',
    attributes: overrides.attributes ?? 'A',
    userDefinedFields: overrides.userDefinedFields ?? null,
    primaryErrorMessage: overrides.primaryErrorMessage ?? 'Invalid species reference',
    errorMessages: overrides.errorMessages ?? ['Invalid species reference'],
    errorSources: overrides.errorSources ?? ['validation'],
    errorFields: overrides.errorFields ?? ['speciesCode'],
    errorCodes: overrides.errorCodes ?? ['INVALID_SPECIES'],
    errorCount: overrides.errorCount ?? 1,
    totalErrorCount: overrides.totalErrorCount ?? overrides.errorCount ?? 1,
    dbhChangePercent: overrides.dbhChangePercent ?? null,
    hasContradiction: overrides.hasContradiction ?? false,
    contradictionTypes: overrides.contradictionTypes ?? (contradictionType ? [contradictionType] : []),
    contradictionType,
    contradictionGroupKey: overrides.contradictionGroupKey ?? null,
    relatedMeasurementIDs: overrides.relatedMeasurementIDs ?? [],
    uploadFileID: overrides.uploadFileID ?? null,
    uploadBatchID: overrides.uploadBatchID ?? null,
    isFailedRow: overrides.isFailedRow ?? false
  };
}

export function buildErrorsExplorerQueryResponse(rows: ErrorExplorerRow[], request: ErrorExplorerQueryRequest): ErrorExplorerQueryResponse {
  const { errorType, columnFilters, sortModel } = request;
  const pageMatchingRows = filterRows(rows, request.filters);
  const identityRows = errorType
    ? pageMatchingRows.filter(row => deriveMatchingErrors(row, request.filters).some(error => matchesErrorType(error, errorType)))
    : pageMatchingRows;
  const columnFilter = columnFilters?.[0];
  const columnFilteredRows = columnFilter ? identityRows.filter(row => matchesColumnFilter(toColumnValueRow(row), columnFilter)) : identityRows;
  const sortItem = sortModel?.[0];
  const sortedRows = sortItem
    ? [...columnFilteredRows].sort((a, b) => compareRowsBySortItem(toColumnValueRow(a), toColumnValueRow(b), sortItem))
    : columnFilteredRows;
  const start = request.page * request.pageSize;

  return {
    rows: sortedRows.slice(start, start + request.pageSize),
    totalRows: sortedRows.length
  };
}

export function buildErrorsExplorerDetails(
  row: ErrorExplorerRow | null,
  relatedRows: RelatedContradictionRow[] = [],
  allErrors?: ErrorDetailRecord[]
): ErrorExplorerDetailsResponse {
  return {
    row,
    allErrors: row ? (allErrors ?? deriveAllErrors(row)) : [],
    relatedRows
  };
}

export interface MockErrorsExplorerApiOptions {
  rows: ErrorExplorerRow[];
  facets?: ErrorExplorerFacetsResponse;
  activeMeasurements?: number;
  queryHandler?: (request: ErrorExplorerQueryRequest, rows: ErrorExplorerRow[]) => ErrorExplorerQueryResponse;
  detailsByMeasurementID?: Record<number, ErrorExplorerDetailsResponse>;
  // Invoked when the app POSTs /api/edits/apply (the edit-plan commit). Return a
  // failure ({ statusCode, body }) to exercise the save-failure path, or omit for
  // a default success. Returning `rows` replaces the mock's current row state.
  applyHandler?: (context: EditPlanApplyContext, rows: ErrorExplorerRow[]) => (EditPlanApplyResponse & { rows?: ErrorExplorerRow[] }) | void;
  refreshResponse?: {
    statusCode: number;
    body: Record<string, unknown>;
  };
}

export function mockErrorsExplorerApi({
  rows,
  facets,
  activeMeasurements = MOCK_ACTIVE_MEASUREMENTS,
  queryHandler,
  detailsByMeasurementID = {},
  applyHandler,
  refreshResponse = { statusCode: 200, body: { message: 'Refresh successful' } }
}: MockErrorsExplorerApiOptions) {
  let currentRows = rows.map(row => ({ ...row }));

  cy.intercept('POST', '**/api/errors/explorer/query', req => {
    const request = req.body as ErrorExplorerQueryRequest;
    const body = queryHandler ? queryHandler(request, currentRows) : buildErrorsExplorerQueryResponse(currentRows, request);
    req.reply({ statusCode: 200, body });
  }).as('fetchErrorsExplorerRows');

  cy.intercept('POST', '**/api/errors/explorer/facets', req => {
    const request = req.body as Pick<ErrorExplorerQueryRequest, 'filters'>;
    const body: ErrorExplorerFacetsResponse = facets ?? {
      errorTypes: deriveErrorTypes(currentRows, request.filters),
      censusTotals: deriveCensusTotals(currentRows, activeMeasurements)
    };
    req.reply({ statusCode: 200, body });
  }).as('fetchErrorFacets');

  cy.intercept('POST', CLEAR_ROUTE_PATTERN, req => {
    const { measurementID } = req.body as { measurementID: number };
    currentRows = currentRows.filter(row => row.coreMeasurementID !== measurementID);
    req.reply({ statusCode: 200, body: { clearedErrorCount: CLEARED_ERROR_COUNT } });
  }).as('clearValidationErrors');

  cy.intercept('GET', '**/api/errors/explorer/details/**', req => {
    const url = new URL(req.url);
    const match = url.pathname.match(/\/api\/errors\/explorer\/details\/(\d+)/);
    const measurementID = match ? Number(match[1]) : NaN;
    const row = currentRows.find(item => item.coreMeasurementID === measurementID) ?? null;
    const defaultRelatedRows = row ? currentRows.filter(item => row.relatedMeasurementIDs.includes(item.coreMeasurementID)).map(buildRelatedRow) : [];

    req.reply({
      statusCode: 200,
      body: detailsByMeasurementID[measurementID] ?? buildErrorsExplorerDetails(row, defaultRelatedRows)
    });
  }).as('fetchErrorDetails');

  // Edits commit through the edit-plan flow (POST /api/edits/preview then
  // /api/edits/apply), not the legacy measurementssummary PATCH. A SpeciesCode
  // change is `warn` severity, so the spec must confirm the PreviewDialog before
  // @applyEdit fires.
  mockEditPlanFlow({
    onApply: context => {
      if (applyHandler) {
        const response = applyHandler(context, currentRows);
        if (response?.rows) {
          currentRows = response.rows.map(row => ({ ...row }));
        }
        return response ?? undefined;
      }

      const patch = canonicalDiffToRowPatch(context.newRow);
      currentRows = currentRows.map(row => (row.coreMeasurementID === context.targetID ? { ...row, ...patch } : row));
      return undefined;
    }
  });

  cy.intercept('POST', '**/api/refreshviews/measurementssummary/*', {
    statusCode: refreshResponse.statusCode,
    body: refreshResponse.body
  }).as('refreshMeasurementsSummary');

  cy.intercept('POST', '**/api/refreshviews/viewfulltable/*', {
    statusCode: refreshResponse.statusCode,
    body: refreshResponse.body
  }).as('refreshViewFullTable');
}
