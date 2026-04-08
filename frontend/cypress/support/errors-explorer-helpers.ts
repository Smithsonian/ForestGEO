import type {
  ContradictionType,
  ErrorDetailRecord,
  ErrorExplorerDetailsResponse,
  ErrorExplorerFacetsResponse,
  ErrorExplorerFilters,
  ErrorExplorerQueryRequest,
  ErrorExplorerQueryResponse,
  ErrorExplorerRow,
  RelatedContradictionRow
} from '../../config/errorsexplorer';

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

function summarizeRows(rows: ErrorExplorerRow[]): ErrorExplorerQueryResponse['summary'] {
  return {
    total: rows.length,
    validation: rows.filter(row => row.errorSources.includes('validation')).length,
    ingestion: rows.filter(row => row.errorSources.includes('ingestion')).length,
    contradictions: rows.filter(row => row.hasContradiction).length,
    duplicateTagStem: rows.filter(row => getContradictionTypes(row).includes('duplicate_tag_stem')).length,
    sameBatchConflict: rows.filter(row => getContradictionTypes(row).includes('same_batch_conflict')).length
  };
}

function deriveFacets(rows: ErrorExplorerRow[]): ErrorExplorerFacetsResponse {
  const messageCounts = new Map<string, number>();
  const fieldCounts = new Map<string, number>();

  rows.forEach(row => {
    row.errorMessages.forEach(message => {
      messageCounts.set(message, (messageCounts.get(message) ?? 0) + 1);
    });

    row.errorFields.forEach(field => {
      fieldCounts.set(field, (fieldCounts.get(field) ?? 0) + 1);
    });
  });

  return {
    messages: Array.from(messageCounts.entries()).map(([value, count]) => ({ value, count })),
    fields: Array.from(fieldCounts.entries()).map(([value, count]) => ({ value, count })),
    sourceCounts: {
      validation: rows.filter(row => row.errorSources.includes('validation')).length,
      ingestion: rows.filter(row => row.errorSources.includes('ingestion')).length
    },
    contradictionCounts: {
      duplicateTagStem: rows.filter(row => getContradictionTypes(row).includes('duplicate_tag_stem')).length,
      sameBatchConflict: rows.filter(row => getContradictionTypes(row).includes('same_batch_conflict')).length
    }
  };
}

function deriveAllErrors(row: ErrorExplorerRow): ErrorDetailRecord[] {
  return row.errorMessages.map((message, index) => ({
    source: row.errorSources[index] ?? row.errorSources[0] ?? 'validation',
    code: row.errorCodes[index] ?? row.errorCodes[0] ?? 'UNKNOWN',
    message,
    fields: row.errorFields.length > 0 ? row.errorFields : []
  }));
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
    errorMessages: row.errorMessages
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
    hasContradiction: overrides.hasContradiction ?? false,
    contradictionTypes: overrides.contradictionTypes ?? (contradictionType ? [contradictionType] : []),
    contradictionType,
    contradictionGroupKey: overrides.contradictionGroupKey ?? null,
    relatedMeasurementIDs: overrides.relatedMeasurementIDs ?? [],
    uploadFileID: overrides.uploadFileID ?? null,
    uploadBatchID: overrides.uploadBatchID ?? null
  };
}

export function buildErrorsExplorerQueryResponse(rows: ErrorExplorerRow[], request: ErrorExplorerQueryRequest): ErrorExplorerQueryResponse {
  const filteredRows = filterRows(rows, request.filters);
  const start = request.page * request.pageSize;
  const end = start + request.pageSize;

  return {
    rows: filteredRows.slice(start, end),
    totalRows: filteredRows.length,
    summary: summarizeRows(filteredRows)
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
  queryHandler?: (request: ErrorExplorerQueryRequest, rows: ErrorExplorerRow[]) => ErrorExplorerQueryResponse;
  detailsByMeasurementID?: Record<number, ErrorExplorerDetailsResponse>;
  patchHandler?: (
    requestBody: { oldRow: Partial<ErrorExplorerRow>; newRow: Partial<ErrorExplorerRow> },
    rows: ErrorExplorerRow[]
  ) => {
    statusCode?: number;
    body?: Record<string, unknown>;
    rows?: ErrorExplorerRow[];
  };
  refreshResponse?: {
    statusCode: number;
    body: Record<string, unknown>;
  };
}

export function mockErrorsExplorerApi({
  rows,
  facets,
  queryHandler,
  detailsByMeasurementID = {},
  patchHandler,
  refreshResponse = { statusCode: 200, body: { message: 'Refresh successful' } }
}: MockErrorsExplorerApiOptions) {
  let currentRows = rows.map(row => ({ ...row }));

  cy.intercept('POST', '**/api/errors/explorer/query', req => {
    const request = req.body as ErrorExplorerQueryRequest;
    const body = queryHandler ? queryHandler(request, currentRows) : buildErrorsExplorerQueryResponse(currentRows, request);
    req.reply({ statusCode: 200, body });
  }).as('fetchErrorsExplorerRows');

  cy.intercept('POST', '**/api/errors/explorer/facets', req => {
    const request = req.body as ErrorExplorerQueryRequest;
    const filteredRows = filterRows(currentRows, request.filters);
    req.reply({
      statusCode: 200,
      body: facets ?? deriveFacets(filteredRows)
    });
  }).as('fetchErrorFacets');

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

  cy.intercept('PATCH', '**/api/fixeddata/measurementssummary/*/coreMeasurementID', req => {
    const requestBody = req.body as { oldRow: Partial<ErrorExplorerRow>; newRow: Partial<ErrorExplorerRow> };

    if (patchHandler) {
      const response = patchHandler(requestBody, currentRows);
      if (response?.rows) {
        currentRows = response.rows.map(row => ({ ...row }));
      }

      req.reply({
        statusCode: response?.statusCode ?? 200,
        body: response?.body ?? {
          message: 'Update successful',
          updatedIDs: { measurementssummary: requestBody.newRow.coreMeasurementID }
        }
      });
      return;
    }

    currentRows = currentRows.map(row => (row.coreMeasurementID === requestBody.newRow.coreMeasurementID ? { ...row, ...requestBody.newRow } : row));

    req.reply({
      statusCode: 200,
      body: {
        message: 'Update successful',
        updatedIDs: { measurementssummary: requestBody.newRow.coreMeasurementID }
      }
    });
  }).as('saveErrorRow');

  cy.intercept('POST', '**/api/refreshviews/measurementssummary/*', {
    statusCode: refreshResponse.statusCode,
    body: refreshResponse.body
  }).as('refreshMeasurementsSummary');
}
