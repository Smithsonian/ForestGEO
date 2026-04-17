import type { ErrorExplorerQueryRequest, ErrorExplorerRow } from '../../config/errorsexplorer';
import { buildErrorsExplorerDetails, buildErrorsExplorerQueryResponse } from './errors-explorer-helpers';
import type { MeasurementValidationFailure } from './grid-api-helpers';

type GenericRow = Record<string, any>;

interface MockMeasurementHubWorkflowApiOptions {
  summaryRows: GenericRow[];
  viewFullTableRows?: GenericRow[];
  errorRows?: ErrorExplorerRow[];
  validationFailures?: MeasurementValidationFailure[];
  schema?: string;
  queryHandler?: (
    requestBody: any,
    state: {
      summaryRows: GenericRow[];
      viewFullTableRows: GenericRow[];
      errorRows: ErrorExplorerRow[];
      validationFailures: MeasurementValidationFailure[];
    }
  ) => {
    statusCode?: number;
    body?: any;
    summaryRows?: GenericRow[];
    viewFullTableRows?: GenericRow[];
    errorRows?: ErrorExplorerRow[];
    validationFailures?: MeasurementValidationFailure[];
  } | void;
  refreshSummaryResponse?: {
    statusCode: number;
    body: Record<string, unknown>;
  };
}

const DEFAULT_SCHEMA = 'luquillo';

function normalizeRequestBody(body: any) {
  if (typeof body !== 'string') {
    return body;
  }

  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

function extractPagination(url: string) {
  const pathname = new URL(url).pathname;
  const match = pathname.match(/\/api\/(?:fixeddata|fixeddatafilter)\/[^/]+\/[^/]+\/(\d+)\/(\d+)(?:\/|$)/);

  return {
    page: Number(match?.[1] ?? 0),
    pageSize: Number(match?.[2] ?? 10)
  };
}

function normalizeText(value: unknown): string {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(normalizeText).join(' ');
  if (typeof value === 'object')
    return Object.values(value as Record<string, unknown>)
      .map(normalizeText)
      .join(' ');
  return String(value).toLowerCase();
}

function matchesQuickFilter(row: GenericRow, quickFilterValues: unknown[] = []) {
  if (!quickFilterValues.length) return true;

  const haystack = Object.values(row).map(normalizeText).join(' ');
  return quickFilterValues.every(value => haystack.includes(String(value).toLowerCase()));
}

function paginateRows<Row extends GenericRow>(rows: Row[], url: string) {
  const { page, pageSize } = extractPagination(url);
  const start = page * pageSize;
  const end = start + pageSize;

  return {
    output: rows.slice(start, end),
    totalCount: rows.length
  };
}

function findRowIndex<Row extends GenericRow>(rows: Row[], candidate: Partial<Row>) {
  return rows.findIndex(row => {
    const rowID = Number(row.coreMeasurementID ?? row.id);
    const candidateID = Number(candidate.coreMeasurementID ?? candidate.id);
    return Number.isFinite(candidateID) && rowID === candidateID;
  });
}

function applyRowUpdate<Row extends GenericRow>(rows: Row[], newRow: Partial<Row>) {
  const nextRows = [...rows];
  const index = findRowIndex(nextRows, newRow);
  if (index === -1) return nextRows;

  nextRows[index] = {
    ...nextRows[index],
    ...newRow
  };

  return nextRows;
}

function buildCounts(rows: GenericRow[], validationFailures: MeasurementValidationFailure[]) {
  const failedIDs = new Set(validationFailures.map(failure => Number(failure.coreMeasurementID)));

  return {
    CountValid: rows.filter(row => !failedIDs.has(Number(row.coreMeasurementID)) && row.isValidated === true).length,
    CountInvalid: rows.filter(row => failedIDs.has(Number(row.coreMeasurementID))).length,
    CountValidationErrors: rows.filter(row => failedIDs.has(Number(row.coreMeasurementID))).length,
    CountPending: rows.filter(row => !failedIDs.has(Number(row.coreMeasurementID)) && row.isValidated == null).length,
    CountOldTrees: rows.filter(row => normalizeText(row.userDefinedFields).includes('old tree')).length,
    CountNewRecruits: rows.filter(row => normalizeText(row.userDefinedFields).includes('new recruit')).length,
    CountMultiStems: rows.filter(row => normalizeText(row.userDefinedFields).includes('multi stem')).length
  };
}

function buildLookupRows(rows: GenericRow[], field: string, key: string) {
  return Array.from(new Set(rows.map(row => row[field]).filter(value => value !== undefined && value !== null && `${value}`.trim() !== '')))
    .sort()
    .map(value => ({
      [key]: value
    }));
}

function buildFacetEntries(values: string[]) {
  const counts = new Map<string, number>();

  values.forEach(value => {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  });

  return Array.from(counts.entries()).map(([value, count]) => ({ value, count }));
}

function buildErrorFacets(rows: ErrorExplorerRow[]) {
  return {
    messages: buildFacetEntries(rows.flatMap(row => row.errorMessages)),
    fields: buildFacetEntries(rows.flatMap(row => row.errorFields)),
    sourceCounts: {
      validation: rows.filter(row => row.errorSources.includes('validation')).length,
      ingestion: rows.filter(row => row.errorSources.includes('ingestion')).length
    },
    contradictionCounts: {
      duplicateTagStem: rows.filter(row => row.contradictionTypes.includes('duplicate_tag_stem')).length,
      sameBatchConflict: rows.filter(row => row.contradictionTypes.includes('same_batch_conflict')).length
    }
  };
}

export function mockMeasurementHubWorkflowApi({
  summaryRows,
  viewFullTableRows = summaryRows,
  errorRows = [],
  validationFailures = [],
  schema = DEFAULT_SCHEMA,
  queryHandler,
  refreshSummaryResponse = { statusCode: 200, body: { success: true } }
}: MockMeasurementHubWorkflowApiOptions) {
  const state = {
    summaryRows: summaryRows.map(row => ({ ...row })),
    viewFullTableRows: viewFullTableRows.map(row => ({ ...row })),
    errorRows: errorRows.map(row => ({ ...row })),
    validationFailures: [...validationFailures]
  };

  cy.intercept('POST', `**/api/fixeddatafilter/measurementssummary/${schema}/**`, req => {
    const quickFilterValues = req.body?.filterModel?.quickFilterValues ?? [];
    const filteredRows = state.summaryRows.filter(row => matchesQuickFilter(row, quickFilterValues));

    req.reply({
      statusCode: 200,
      body: paginateRows(filteredRows, req.url)
    });
  }).as('fetchMeasurementHubSummaryRows');

  cy.intercept('GET', `**/api/fixeddata/viewfulltable/${schema}/**`, req => {
    req.reply({
      statusCode: 200,
      body: paginateRows(state.viewFullTableRows, req.url)
    });
  }).as('fetchMeasurementHubFullRows');

  cy.intercept('POST', `**/api/fixeddatafilter/viewfulltable/${schema}/**`, req => {
    const quickFilterValues = req.body?.filterModel?.quickFilterValues ?? [];
    const filteredRows = state.viewFullTableRows.filter(row => matchesQuickFilter(row, quickFilterValues));

    req.reply({
      statusCode: 200,
      body: paginateRows(filteredRows, req.url)
    });
  }).as('filterMeasurementHubFullRows');

  cy.intercept('PATCH', `**/api/fixeddata/measurementssummary/${schema}/coreMeasurementID`, req => {
    const newRow = (req.body?.newRow ?? {}) as Partial<GenericRow>;

    state.summaryRows = applyRowUpdate(state.summaryRows, newRow);
    state.viewFullTableRows = applyRowUpdate(state.viewFullTableRows, newRow);
    state.errorRows = state.errorRows.map(row =>
      Number(row.coreMeasurementID) === Number(newRow.coreMeasurementID)
        ? {
            ...row,
            ...newRow
          }
        : row
    );

    req.reply({
      statusCode: 200,
      body: {
        message: 'Update successful',
        updatedIDs: { measurementssummary: newRow.coreMeasurementID }
      }
    });
  }).as('saveMeasurementHubRow');

  cy.intercept('GET', '**/api/validations/validationerrordisplay?*', req => {
    req.reply({
      statusCode: 200,
      body: {
        failed: state.validationFailures.map((failure, index) => ({
          coreMeasurementID: failure.coreMeasurementID,
          validationErrorIDs: failure.validationErrorIDs ?? failure.descriptions.map((_description, descriptionIndex) => index * 10 + descriptionIndex + 1),
          descriptions: failure.descriptions,
          criteria: failure.criteria
        }))
      }
    });
  }).as('fetchMeasurementHubValidationErrors');

  cy.intercept('POST', '/api/query', req => {
    const body = normalizeRequestBody(req.body);
    const customResponse = queryHandler?.(body, state);

    if (customResponse) {
      if (customResponse.summaryRows) {
        state.summaryRows = customResponse.summaryRows.map(row => ({ ...row }));
      }
      if (customResponse.viewFullTableRows) {
        state.viewFullTableRows = customResponse.viewFullTableRows.map(row => ({ ...row }));
      }
      if (customResponse.errorRows) {
        state.errorRows = customResponse.errorRows.map(row => ({ ...row }));
      }
      if (customResponse.validationFailures) {
        state.validationFailures = [...customResponse.validationFailures];
      }

      req.reply({
        statusCode: customResponse.statusCode ?? 200,
        body: customResponse.body ?? { success: true }
      });
      return;
    }

    if (typeof body === 'string') {
      if (body.includes('CountValid') || body.includes('CountInvalid') || body.includes('CountPending') || body.includes('CountValidationErrors')) {
        req.reply({
          statusCode: 200,
          body: [buildCounts(state.summaryRows, state.validationFailures)]
        });
        return;
      }

      req.reply({
        statusCode: 200,
        body: state.summaryRows
      });
      return;
    }

    if (body?.query && typeof body.query === 'string') {
      if (body.query.includes('DELETE mel')) {
        const measurementID = Number(body.params?.[2]);
        state.validationFailures = state.validationFailures.filter(failure => Number(failure.coreMeasurementID) !== measurementID);
        state.errorRows = state.errorRows.filter(row => Number(row.coreMeasurementID) !== measurementID);
      }

      if (body.query.includes('UPDATE ??.coremeasurements SET IsValidated = NULL')) {
        const measurementID = Number(body.params?.[1]);
        state.summaryRows = state.summaryRows.map(row =>
          Number(row.coreMeasurementID) === measurementID
            ? {
                ...row,
                isValidated: null
              }
            : row
        );
        state.viewFullTableRows = state.viewFullTableRows.map(row =>
          Number(row.coreMeasurementID) === measurementID
            ? {
                ...row,
                isValidated: null
              }
            : row
        );
      }

      req.reply({
        statusCode: 200,
        body: { success: true }
      });
      return;
    }

    req.reply({
      statusCode: 200,
      body: []
    });
  }).as('runMeasurementHubQuery');

  cy.intercept('POST', `**/api/refreshviews/measurementssummary/${schema}**`, {
    statusCode: refreshSummaryResponse.statusCode,
    body: refreshSummaryResponse.body
  }).as('refreshMeasurementHubSummary');

  cy.intercept('POST', `**/api/refreshviews/viewfulltable/${schema}**`, {
    statusCode: 200,
    body: { success: true }
  }).as('refreshMeasurementHubViewFullTable');

  cy.intercept('GET', '**/api/fetchall/attributes/**', {
    statusCode: 200,
    body: buildLookupRows(state.summaryRows, 'attributes', 'Code').map(row => ({
      Code: row.Code,
      Description: `Attribute ${row.Code}`,
      Status: 'active'
    }))
  });

  cy.intercept('GET', '**/api/fetchall/trees/**', {
    statusCode: 200,
    body: buildLookupRows(state.summaryRows, 'treeTag', 'TreeTag')
  });

  cy.intercept('GET', '**/api/fetchall/stems/**', {
    statusCode: 200,
    body: buildLookupRows(state.summaryRows, 'stemTag', 'StemTag')
  });

  cy.intercept('GET', '**/api/fetchall/quadrats/**', {
    statusCode: 200,
    body: buildLookupRows(state.summaryRows, 'quadratName', 'QuadratName')
  });

  cy.intercept('GET', '**/api/fetchall/species/**', {
    statusCode: 200,
    body: buildLookupRows(state.summaryRows, 'speciesCode', 'SpeciesCode')
  });

  cy.intercept('POST', '**/api/errors/explorer/query', req => {
    req.reply({
      statusCode: 200,
      body: buildErrorsExplorerQueryResponse(state.errorRows, req.body as ErrorExplorerQueryRequest)
    });
  }).as('fetchErrorsExplorerRows');

  cy.intercept('POST', '**/api/errors/explorer/facets', req => {
    req.reply({
      statusCode: 200,
      body: buildErrorFacets(state.errorRows)
    });
  }).as('fetchErrorFacets');

  cy.intercept('GET', '**/api/errors/explorer/details/**', req => {
    const url = new URL(req.url);
    const match = url.pathname.match(/\/api\/errors\/explorer\/details\/(\d+)/);
    const measurementID = match ? Number(match[1]) : NaN;
    const row = state.errorRows.find(item => item.coreMeasurementID === measurementID) ?? null;

    req.reply({
      statusCode: 200,
      body: buildErrorsExplorerDetails(row)
    });
  }).as('fetchErrorDetails');

  return state;
}
