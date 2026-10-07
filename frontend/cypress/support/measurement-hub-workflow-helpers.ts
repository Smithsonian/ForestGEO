import type { ErrorExplorerQueryRequest, ErrorExplorerRow } from '../../config/errorsexplorer';
import { buildErrorsExplorerDetails, buildErrorsExplorerQueryResponse } from './errors-explorer-helpers';
import type { MeasurementValidationFailure } from './grid-api-helpers';
import { canonicalDiffToRowPatch, mockEditPlanFlow } from './edit-plan-helpers';

type GenericRow = Record<string, any>;

interface MockMeasurementHubWorkflowApiOptions {
  summaryRows: GenericRow[];
  viewFullTableRows?: GenericRow[];
  errorRows?: ErrorExplorerRow[];
  validationFailures?: MeasurementValidationFailure[];
  schema?: string;
  // Required for any error row whose errorSources mix 'validation' and
  // 'ingestion' and that gets targeted by a reset/recheck in the test — see
  // resolveErrorRowAfterValidationClear for why this can't be inferred.
  postActionErrorRowsByMeasurementID?: Record<number, ErrorExplorerRow>;
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

// CountUnresolvedLogged counts ANY unresolved measurement_error_log entry
// regardless of source (see config/measurementstatefilters.ts), so it must come
// from the union of validationFailures AND errorRows — not validationFailures
// alone. Otherwise an ingestion-only error row reads as "clean" the moment
// validationFailures is cleared, even though the row still has an unresolved
// log entry and the real app would still count/show it as invalid.
function buildCounts(rows: GenericRow[], validationFailures: MeasurementValidationFailure[], errorRows: ErrorExplorerRow[]) {
  const unresolvedIDs = new Set<number>([
    ...validationFailures.map(failure => Number(failure.coreMeasurementID)),
    ...errorRows.map(row => Number(row.coreMeasurementID))
  ]);

  return {
    CountValid: rows.filter(row => !unresolvedIDs.has(Number(row.coreMeasurementID)) && row.isValidated === true).length,
    CountUnresolvedLogged: rows.filter(row => unresolvedIDs.has(Number(row.coreMeasurementID))).length,
    CountFailedNoLog: rows.filter(row => !unresolvedIDs.has(Number(row.coreMeasurementID)) && row.isValidated === false).length,
    CountPending: rows.filter(row => !unresolvedIDs.has(Number(row.coreMeasurementID)) && row.isValidated == null).length,
    // Mirrors the override modal predicate (IsValidated = FALSE OR IS NULL); intentionally not disjoint.
    CountOverridable: rows.filter(row => row.isValidated === false || row.isValidated == null).length,
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

// Determines an error row's state after reset/recheck resolves its unresolved
// 'validation' occurrences (lib/validations/reset.ts resolves ErrorSource =
// 'validation' links only) and unconditionally sets the underlying row pending
// (buildResetIsValidatedStep sets IsValidated = NULL for every targeted row,
// regardless of which error sources remain).
//
// A single-source row is unambiguous: a pure 'validation' row is fully
// resolved, so it drops out of View Errors entirely (null); a pure
// 'ingestion' row is untouched by reset/recheck and survives with every
// message/code/field intact.
//
// A row mixing 'validation' and 'ingestion' sources cannot be inferred here.
// The real API (app/api/errors/explorer/_shared.ts#toDisplayRow) dedupes
// errorMessages, errorSources, and errorCodes independently — e.g. sources
// ['validation','validation','ingestion'] dedupes to length 2 while messages
// stays length 3, so post-dedup arrays are not index-aligned and there's no
// reliable way to tell which message/code belonged to which source. Guessing
// here would hide exactly the kind of bug this contract exists to catch, so a
// mixed-source row that gets targeted must have its exact resulting row
// supplied via postActionErrorRowsByMeasurementID; omitting it is a fixture
// bug, not something to paper over with inference.
//
// A manager-override marker (config/validationoverride.ts) is recorded already
// resolved, so it never appears in an unresolved errorRows fixture in the
// first place — no special-casing needed for it here.
function resolveErrorRowAfterValidationClear(
  row: ErrorExplorerRow,
  postActionErrorRowsByMeasurementID: Record<number, ErrorExplorerRow>
): ErrorExplorerRow | null {
  const distinctSources = new Set(row.errorSources);

  if (distinctSources.size <= 1) {
    return distinctSources.has('validation') ? null : { ...row, isValidated: null };
  }

  const explicitRow = postActionErrorRowsByMeasurementID[row.coreMeasurementID];
  if (!explicitRow) {
    throw new Error(
      `mockMeasurementHubWorkflowApi: CoreMeasurementID ${row.coreMeasurementID} mixes validation and ingestion error sources. ` +
        `Supply its exact post-action row via postActionErrorRowsByMeasurementID — the mock cannot infer which messages/codes survive deduping.`
    );
  }

  return { ...explicitRow, isValidated: null };
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
  postActionErrorRowsByMeasurementID = {},
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

  // Edits commit through the edit-plan flow (POST /api/edits/preview then
  // /api/edits/apply). A SpeciesCode change is `warn` severity, so consuming specs
  // must confirm the PreviewDialog before @applyEdit fires.
  mockEditPlanFlow({
    onApply: ({ targetID, newRow }) => {
      const patchRow = { coreMeasurementID: targetID, ...canonicalDiffToRowPatch(newRow) } as Partial<GenericRow>;
      state.summaryRows = applyRowUpdate(state.summaryRows, patchRow);
      state.viewFullTableRows = applyRowUpdate(state.viewFullTableRows, patchRow);
      state.errorRows = state.errorRows.map(row => (Number(row.coreMeasurementID) === Number(targetID) ? { ...row, ...patchRow } : row));
      return undefined;
    }
  });

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
      if (body.includes('CountValid') || body.includes('CountUnresolvedLogged') || body.includes('CountPending') || body.includes('CountFailedNoLog')) {
        req.reply({
          statusCode: 200,
          body: [buildCounts(state.summaryRows, state.validationFailures, state.errorRows)]
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
      // Reset/recheck mutations now go through /api/validations/reset and
      // /api/validations/recheck (intercepted below), not raw SQL via /api/query —
      // this branch is a generic fallback for any other query-shaped write.
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

  // Resets every row in scope back to pending and resolves unresolved validation
  // occurrences (ingestion occurrences on the same row survive), matching
  // lib/validations/reset.ts#resetValidationScope. The real route refreshes both
  // measurement views atomically, so callers must see no follow-up
  // @refreshMeasurementHubSummary / @refreshMeasurementHubViewFullTable request.
  cy.intercept('POST', '/api/validations/reset', req => {
    state.summaryRows = state.summaryRows.map(row => ({ ...row, isValidated: null }));
    state.viewFullTableRows = state.viewFullTableRows.map(row => ({ ...row, isValidated: null }));
    const affectedRows = state.summaryRows.length;
    state.validationFailures = [];
    state.errorRows = state.errorRows
      .map(row => resolveErrorRowAfterValidationClear(row, postActionErrorRowsByMeasurementID))
      .filter((row): row is ErrorExplorerRow => row !== null);

    req.reply({ statusCode: 200, body: { affectedRows } });
  }).as('resetValidations');

  // Rechecks a single row by coreMeasurementID; every other row is untouched,
  // matching lib/validations/reset.ts#recheckMeasurementValidation.
  cy.intercept('POST', '/api/validations/recheck', req => {
    const body = normalizeRequestBody(req.body);
    const measurementID = Number(body?.coreMeasurementID);

    state.summaryRows = state.summaryRows.map(row => (Number(row.coreMeasurementID) === measurementID ? { ...row, isValidated: null } : row));
    state.viewFullTableRows = state.viewFullTableRows.map(row => (Number(row.coreMeasurementID) === measurementID ? { ...row, isValidated: null } : row));
    state.validationFailures = state.validationFailures.filter(failure => Number(failure.coreMeasurementID) !== measurementID);
    state.errorRows = state.errorRows
      .map(row => (Number(row.coreMeasurementID) === measurementID ? resolveErrorRowAfterValidationClear(row, postActionErrorRowsByMeasurementID) : row))
      .filter((row): row is ErrorExplorerRow => row !== null);

    req.reply({ statusCode: 200, body: { affectedRows: 1 } });
  }).as('recheckValidation');

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
