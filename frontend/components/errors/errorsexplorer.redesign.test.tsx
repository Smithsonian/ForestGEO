import React from 'react';
import { act, configure, render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { PointerEventsCheckLevel } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CLEAR_MEASUREMENT_ERRORS_CODES,
  CLEAR_NOTHING_TO_CLEAR_MESSAGE,
  CLEAR_UNCONFIRMED_MESSAGE,
  CLEAR_VALIDATION_ERRORS_FAILED_MESSAGE,
  CLEAR_VALIDATION_ERRORS_SUCCESS,
  buildErrorTypeKey,
  DETAILS_SHEET_TEXT,
  EDIT_LOCK_TOOLTIPS,
  EDIT_THIS_ROW_UNAVAILABLE_TOOLTIP,
  FALLBACK_ERROR_CODE,
  FALLBACK_ERROR_MESSAGE,
  formatShowMoreErrorTypes,
  MARKED_INVALID_NO_ERROR_LOGGED_LABEL,
  VIEW_ERRORS_ALERTS,
  VIEW_ERRORS_TEXT,
  type ErrorExplorerRow,
  type ErrorTypeFacet
} from '@/config/errorsexplorer';
import { TRANSACTION_COMMIT_OUTCOME_UNKNOWN_CODE } from '@/lib/db/transactionerrors';
import { ERRORS_LABEL_FIELD } from './errorsexplorercolumns';

// Each save runs preview, apply, two rebuilds and several reads through the real flow; under load that outlasts waitFor's 1000 ms default.
// The margin only lengthens polling and never changes what a passing assertion proves.
const ASYNC_UTIL_TIMEOUT_MS = 5000;
configure({ asyncUtilTimeout: ASYNC_UTIL_TIMEOUT_MS });

import { capturedGrids, enterEdit, requireGrid, requireRow, resetCapturedGrids, saveRowThroughGrid } from '@/tests/fixtures/errorsexplorer/grid-capture';
import {
  explorerRow,
  facetOf,
  facetsResponse,
  FIRST_CENSUS_ID,
  installMemoryStorage,
  installPageFetch,
  jsonResponse,
  PAGE_PLOT_ID,
  PAGE_SCHEMA,
  ROUTES,
  SECOND_CENSUS_ID,
  type FetchRoute
} from '@/tests/fixtures/errorsexplorer/explorer-page';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(onResolve => {
    resolve = onResolve;
  });
  return { promise, resolve };
}

const page = vi.hoisted(() => ({
  userStatus: 'global' as string,
  censusIDs: [6, 7] as number[],
  search: '',
  censusList: [] as unknown[]
}));

vi.mock('@/app/contexts/compat-hooks', () => ({
  useSiteContext: () => ({ schemaName: 'forestgeo_testing' }),
  usePlotContext: () => ({ plotID: 22 }),
  useOrgCensusContext: () => ({ dateRanges: page.censusIDs.map(censusID => ({ censusID })) }),
  useOrgCensusListContext: () => page.censusList
}));
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { userStatus: page.userStatus } } }) }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(page.search),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/measurementshub/errors'
}));
vi.mock('@/components/client/clientmacros', () => ({ loadSelectableOptions: vi.fn(async () => undefined) }));
vi.mock('@/config/styleddatagrid', async () => (await import('@/tests/fixtures/errorsexplorer/grid-capture')).styledDataGridCaptureModule());
vi.mock('@mui/x-data-grid', async importOriginal => ({
  ...(await importOriginal<typeof import('@mui/x-data-grid')>()),
  GridActionsCellItem: (await import('@/tests/fixtures/errorsexplorer/grid-capture')).GridActionsCellItemStub,
  useGridApiRef: () => ({ current: { hideFilterPanel: () => undefined, scrollToIndexes: () => undefined } })
}));
vi.mock('@/components/datagrids/customgridpagination', () => ({ default: () => null }));
vi.mock('@/components/datagrids/infinitegridscrollbridge', () => ({ default: () => null }));
vi.mock('@/ailogger', () => ({ default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), event: vi.fn() } }));

let storage: Map<string, string> = new Map();
const STORAGE_KEY = `errors-explorer-filters:${PAGE_SCHEMA}:${PAGE_PLOT_ID}:${FIRST_CENSUS_ID}`;

const VALIDATION_ROW = explorerRow(101, {
  errorCodes: ['14'],
  primaryErrorMessage: 'Flagged;Different species',
  errorMessages: ['Flagged;Different species'],
  errorFields: ['speciesCode']
});
const SECOND_CENSUS_ROW = explorerRow(102, {
  censusID: SECOND_CENSUS_ID,
  errorCodes: ['14'],
  primaryErrorMessage: 'Flagged;Different species',
  errorMessages: ['Flagged;Different species']
});
const VALIDATION_FACET: ErrorTypeFacet = { ...facetOf(VALIDATION_ROW, 2) };
const FALLBACK_ROW = explorerRow(201, {
  errorSources: ['ingestion'],
  errorCodes: [FALLBACK_ERROR_CODE],
  primaryErrorMessage: FALLBACK_ERROR_MESSAGE,
  errorMessages: [FALLBACK_ERROR_MESSAGE],
  errorFields: []
});
const FALLBACK_FACET = facetOf(FALLBACK_ROW);
const GROUP_LABEL = 'Different species rows';
const FALLBACK_LABEL = `${MARKED_INVALID_NO_ERROR_LOGGED_LABEL} rows`;
const FLAT_LABEL = VIEW_ERRORS_TEXT.flatGridLabel;
const APPLY_RESULT = { updatedIDs: { coremeasurements: 102 }, applyErrors: [], editOperationID: 900, validationPending: false };
const WARN_PLAN = {
  dataType: 'measurementssummary',
  targetID: 102,
  fieldChanges: [{ field: 'MeasuredDBH', from: 10, to: 12 }],
  effects: [],
  maxSeverity: 'warn',
  planHash: 'b'.repeat(64),
  generatedAt: '2026-11-04T00:00:00Z'
};

function rowsFor(code: string | undefined): ErrorExplorerRow[] {
  if (code === FALLBACK_ERROR_CODE) return [FALLBACK_ROW];
  return [VALIDATION_ROW, SECOND_CENSUS_ROW];
}

function defaultRoutes(overrides: Partial<Record<keyof typeof ROUTES, FetchRoute['respond']>> = {}): FetchRoute[] {
  const respond: Record<keyof typeof ROUTES, FetchRoute['respond']> = {
    facets: () =>
      jsonResponse(facetsResponse([VALIDATION_FACET, FALLBACK_FACET], { affectedMeasurements: 3, errorTypeCount: 2, ingestion: 1, failedMeasurements: 1 })),
    query: request => {
      const rows = rowsFor((request.body?.errorType as { code?: string } | undefined)?.code);
      return jsonResponse({ rows, totalRows: rows.length });
    },
    details: request => {
      const id = Number(/details\/(\d+)/.exec(request.url)?.[1]);
      const row = [VALIDATION_ROW, SECOND_CENSUS_ROW, FALLBACK_ROW].find(candidate => candidate.coreMeasurementID === id) ?? null;
      const allErrors =
        row === FALLBACK_ROW
          ? [{ source: 'ingestion', code: FALLBACK_ERROR_CODE, message: FALLBACK_ERROR_MESSAGE, fields: [], comparison: null }]
          : [{ source: 'validation', code: '14', message: 'Flagged;Different species', fields: ['speciesCode'], comparison: null }];
      return jsonResponse({ row, allErrors: row ? allErrors : [], relatedRows: [] });
    },
    export: () => new Response('csv', { status: 200 }),
    preview: () => jsonResponse(WARN_PLAN),
    apply: () => jsonResponse(APPLY_RESULT),
    revert: () => jsonResponse({ ...APPLY_RESULT, editOperationID: 901 }),
    rebuildSummary: () => jsonResponse({ success: true }),
    rebuildFullTable: () => jsonResponse({ success: true }),
    rebuild: () => jsonResponse({ success: true }),
    clear: () => jsonResponse({ clearedErrorCount: 1 }),
    ...overrides
  };
  return (Object.keys(ROUTES) as Array<keyof typeof ROUTES>).map(key => ({ match: ROUTES[key], respond: respond[key] }));
}

/** A save that stays open on the preview dialog: processRowUpdate runs outside act, so the dialog can render while the save is pending. */
function beginRowSaveAwaitingDialog(label: string, rowID: number, changes: Record<string, unknown>): Promise<unknown> {
  enterEdit(label, rowID);
  const oldRow = requireRow(label, rowID);
  const processRowUpdate = requireGrid(label).processRowUpdate;
  if (!processRowUpdate) throw new Error(`"${label}" has no processRowUpdate`);
  return processRowUpdate({ ...oldRow, ...changes }, oldRow).then(
    saved => saved,
    (error: unknown) => error
  );
}

type PageNetwork = ReturnType<typeof installPageFetch>;

/** Waits for the preview dialog; the failure message lists the requests so a missing dialog can be traced to the call that did not happen. */
async function findPreviewApply(network: PageNetwork, pendingSave: Promise<unknown>): Promise<HTMLElement> {
  try {
    return await screen.findByTestId('edit-preview-apply');
  } catch (error: unknown) {
    const settled = await Promise.race([pendingSave, Promise.resolve('(save still pending)')]);
    throw new Error(
      `The preview dialog never opened. Requests: ${JSON.stringify(network.requests.map(request => request.url))}. Save settled with: ${String(settled)}. ${String(error).slice(0, 80)}`
    );
  }
}

async function mountPage(routes = defaultRoutes(), { awaitGroupGrid = true, awaitRows = true }: { awaitGroupGrid?: boolean; awaitRows?: boolean } = {}) {
  const network = installPageFetch(routes);
  const { default: ErrorsExplorer } = await import('./errorsexplorer');
  const view = render(<ErrorsExplorer />);
  if (awaitGroupGrid) await waitFor(() => expect(capturedGrids.has(GROUP_LABEL)).toBe(true));
  if (awaitGroupGrid && awaitRows)
    await waitFor(() => expect(capturedGrids.get(GROUP_LABEL)?.rows.length, 'the first group has loaded its rows').toBeGreaterThan(0));
  return { ...view, network };
}

beforeEach(() => {
  page.userStatus = 'global';
  page.censusIDs = [FIRST_CENSUS_ID, SECOND_CENSUS_ID];
  page.search = '';
  page.censusList = [];
  resetCapturedGrids();
  storage = installMemoryStorage();
});

afterEach(() => vi.unstubAllGlobals());

describe('Show control and census totals', () => {
  it.each([
    ['All', { source: 'all', contradictionOnly: false }],
    ['Validation', { source: 'validation', contradictionOnly: false }],
    ['Ingestion', { source: 'ingestion', contradictionOnly: false }],
    ['Contradictions', { source: 'all', contradictionOnly: true }]
  ])('maps %s to the facets filters', async (label, expected) => {
    const { network } = await mountPage();
    await userEvent.click(within(screen.getByRole('group', { name: VIEW_ERRORS_TEXT.showLabel })).getByRole('button', { name: new RegExp(`^${label}`) }));
    await waitFor(() => expect(network.bodiesFor(ROUTES.facets).at(-1)?.filters).toMatchObject(expected));
  });

  it('keeps the tiles on census totals while Show and Search change, and drives the Failed tile and Fix button from failedMeasurements', async () => {
    await mountPage();
    await waitFor(() => expect(within(screen.getByTestId('errors-tile-failed')).getByText('1')).toBeInTheDocument());
    expect(screen.getByTestId('errorsexplorer-fix-failed-link')).toHaveTextContent(/^Fix 1 failed upload$/);
    await userEvent.type(screen.getByRole('textbox', { name: VIEW_ERRORS_TEXT.searchLabel }), 'zz');
    expect(within(screen.getByTestId('errors-tile-affected')).getByText('3')).toBeInTheDocument();
  });

  it('keeps the real totals and offers Clear filters when the filters match nothing', async () => {
    await mountPage(defaultRoutes({ facets: () => jsonResponse(facetsResponse([], { affectedMeasurements: 3 })) }), { awaitGroupGrid: false });
    expect(await screen.findByText(VIEW_ERRORS_TEXT.emptyFiltered)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: VIEW_ERRORS_TEXT.clearFilters })).toBeInTheDocument();
    expect(within(screen.getByTestId('errors-tile-affected')).getByText('3')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/✓|This census is clear/);
  });

  it('clears a flat-grid column filter too, so Clear filters brings the rows back (P2-6)', async () => {
    const { network } = await mountPage(
      defaultRoutes({
        query: request => {
          const rows = (request.body?.columnFilters as unknown[] | undefined)?.length ? [] : rowsFor(undefined);
          return jsonResponse({ rows, totalRows: rows.length });
        }
      })
    );
    await userEvent.click(screen.getByRole('combobox', { name: VIEW_ERRORS_TEXT.groupRowsLabel }));
    await userEvent.click(await screen.findByRole('option', { name: VIEW_ERRORS_TEXT.noGrouping }));
    await waitFor(() => expect(capturedGrids.has(FLAT_LABEL)).toBe(true));
    act(() => requireGrid(FLAT_LABEL).onFilterModelChange?.({ items: [{ field: 'treeTag', operator: 'contains', value: 'zz' }] }));
    expect(await screen.findByText(VIEW_ERRORS_TEXT.emptyFiltered)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: VIEW_ERRORS_TEXT.clearFilters }));
    await waitFor(() => expect(requireGrid(FLAT_LABEL).rows.map(row => Number(row.id))).toEqual([101, 102]));
    console.log(
      '[view-errors clear filters flat]',
      JSON.stringify({ filterModel: requireGrid(FLAT_LABEL).filterModel, lastQuery: network.bodiesFor(ROUTES.query).at(-1) })
    );
    expect(requireGrid(FLAT_LABEL).filterModel?.items).toEqual([]);
    expect(network.bodiesFor(ROUTES.query).at(-1)?.columnFilters).toEqual([]);
    expect(screen.queryByText(VIEW_ERRORS_TEXT.emptyFiltered)).toBeNull();
  });
});

async function openDetailsFor(rowID: number, label = GROUP_LABEL) {
  await waitFor(() => expect(screen.getByTestId(`captured-row-${label}-${rowID}`)).toBeInTheDocument());
  await userEvent.click(within(screen.getByTestId(`captured-row-${label}-${rowID}`)).getByRole('menuitem', { name: 'Details' }));
  await waitFor(() => expect(screen.getByRole('heading', { name: `Measurement ${rowID}` })).toBeInTheDocument());
}

describe('Clear validation errors outcomes (P3-3 of r4)', () => {
  async function openSheetAndClear(clearResponse: FetchRoute['respond'], overrides: Parameters<typeof defaultRoutes>[0] = {}) {
    const { network } = await mountPage(defaultRoutes({ clear: clearResponse, ...overrides }));
    await waitFor(() => expect(screen.getAllByRole('menuitem', { name: 'Details' }).length).toBeGreaterThan(1));
    await userEvent.click(within(screen.getByTestId(`captured-row-${GROUP_LABEL}-102`)).getByRole('menuitem', { name: 'Details' }));
    const clear = await screen.findByRole('button', { name: DETAILS_SHEET_TEXT.clearValidationErrors });
    const beforeClear = network.requests.length;
    await userEvent.click(clear);
    return { network, beforeClear };
  }

  it('sends the row census, does no client rebuild, refreshes every read with every census and shows the success text', async () => {
    const { network, beforeClear } = await openSheetAndClear(() => jsonResponse({ clearedErrorCount: 1 }));
    expect(await screen.findByText(CLEAR_VALIDATION_ERRORS_SUCCESS)).toBeInTheDocument();
    const after = network.requests.slice(beforeClear);
    console.log('[view-errors clear page]', JSON.stringify(after.map(request => request.url)));
    expect(after[0].body).toMatchObject({ schema: PAGE_SCHEMA, plotID: PAGE_PLOT_ID, censusID: SECOND_CENSUS_ID, measurementID: 102 });
    expect(after.some(request => ROUTES.rebuild.test(request.url))).toBe(false);
    expect(
      after
        .filter(request => ROUTES.facets.test(request.url) || ROUTES.query.test(request.url))
        .every(request => JSON.stringify(request.body?.censusIDs) === JSON.stringify([FIRST_CENSUS_ID, SECOND_CENSUS_ID]))
    ).toBe(true);
  });

  it('shows the failed message for a plain 500', async () => {
    await openSheetAndClear(() => jsonResponse({ code: 'CLEAR_VALIDATION_ERRORS_FAILED' }, 500));
    expect(await screen.findByText(CLEAR_VALIDATION_ERRORS_FAILED_MESSAGE)).toBeInTheDocument();
  });

  it("says nothing changed for a 409 NOTHING_TO_CLEAR and re-reads the sheet's row (r3, R2)", async () => {
    const { network, beforeClear } = await openSheetAndClear(() => jsonResponse({ code: CLEAR_MEASUREMENT_ERRORS_CODES.nothingToClear }, 409));
    expect(await screen.findByText(CLEAR_NOTHING_TO_CLEAR_MESSAGE)).toBeInTheDocument();
    await waitFor(() =>
      expect(
        network.requests.slice(beforeClear).some(request => ROUTES.details.test(request.url)),
        "the open sheet's details are fetched again"
      ).toBe(true)
    );
    const after = network.requests.slice(beforeClear);
    console.log('[view-errors clear nothing to clear page]', JSON.stringify(after.map(request => request.url)));
    expect(screen.queryByText(CLEAR_VALIDATION_ERRORS_FAILED_MESSAGE), 'not reported as a failure to clear').toBeNull();
    expect(
      after.some(request => ROUTES.facets.test(request.url)),
      'the page reads refresh too'
    ).toBe(true);
    expect(
      after.filter(request => ROUTES.clear.test(request.url)),
      'no second clear'
    ).toHaveLength(1);
  });

  it.each([
    ['a rejected fetch', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['an unreadable 2xx body', () => new Response('not json', { status: 200 })],
    ['the unknown-commit code', () => jsonResponse({ code: TRANSACTION_COMMIT_OUTCOME_UNKNOWN_CODE }, 500)]
  ])('treats %s as unconfirmed, keeps Clear disabled until the refresh settles, and sends no second clear', async (_label, respond) => {
    const refreshedFacets = deferred<Response>();
    let clearSent = false;
    let heldFacetsRequests = 0;
    const servedFacets = () =>
      jsonResponse(facetsResponse([VALIDATION_FACET, FALLBACK_FACET], { affectedMeasurements: 3, errorTypeCount: 2, ingestion: 1, failedMeasurements: 1 }));
    const { network, beforeClear } = await openSheetAndClear(
      request => {
        clearSent = true;
        return (respond as FetchRoute['respond'])(request);
      },
      {
        facets: () => {
          if (!clearSent) return servedFacets();
          heldFacetsRequests += 1;
          return refreshedFacets.promise;
        }
      }
    );
    expect(await screen.findByText(CLEAR_UNCONFIRMED_MESSAGE)).toBeInTheDocument();
    await waitFor(() => expect(heldFacetsRequests, 'the read refresh started and is held').toBe(1));
    const clear = screen.getByRole('button', { name: DETAILS_SHEET_TEXT.clearValidationErrors });
    console.log('[view-errors clear unconfirmed]', JSON.stringify({ disabledWhileRefreshing: (clear as HTMLButtonElement).disabled }));
    expect(clear, 'not offered again before the refresh settles').toBeDisabled();
    await userEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never }).click(clear);
    await act(async () => refreshedFacets.resolve(servedFacets()));
    await waitFor(() => expect(screen.getByRole('button', { name: DETAILS_SHEET_TEXT.clearValidationErrors })).toBeEnabled());
    const after = network.requests.slice(beforeClear);
    expect(
      after.filter(request => ROUTES.clear.test(request.url)),
      'no second clear'
    ).toHaveLength(1);
  });

  it("never shows A's notice on B's sheet and disables B's Clear while A's Clear is in flight (P3-3)", async () => {
    const clearResponse = deferred<Response>();
    const { network } = await openSheetAndClear(() => clearResponse.promise);
    await userEvent.click(screen.getByRole('button', { name: DETAILS_SHEET_TEXT.closeDetails }));
    await openDetailsFor(101);
    const clearB = await screen.findByRole('button', { name: DETAILS_SHEET_TEXT.clearValidationErrors });
    expect(clearB, "B's Clear waits for A's").toBeDisabled();
    await act(async () => clearResponse.resolve(jsonResponse({ clearedErrorCount: 1 })));
    await waitFor(() => expect(screen.getByRole('button', { name: DETAILS_SHEET_TEXT.clearValidationErrors })).toBeEnabled());
    console.log('[view-errors clear keyed B]', screen.getByTestId('error-row-details-sheet').textContent);
    expect(screen.queryByText(CLEAR_VALIDATION_ERRORS_SUCCESS), "A's notice never lands in B's sheet").toBeNull();
    expect(network.bodiesFor(ROUTES.clear)).toEqual([expect.objectContaining({ measurementID: 102 })]);
  });

  it('keeps Clear disabled when its sheet is closed and reopened mid-flight, and shows the notice there when it lands (P3-3)', async () => {
    const clearResponse = deferred<Response>();
    const { network } = await openSheetAndClear(() => clearResponse.promise);
    await userEvent.click(screen.getByRole('button', { name: DETAILS_SHEET_TEXT.closeDetails }));
    await openDetailsFor(102);
    const clearA = await screen.findByRole('button', { name: DETAILS_SHEET_TEXT.clearValidationErrors });
    expect(clearA, 'the in-flight guard survives closing the sheet').toBeDisabled();
    await userEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never }).click(clearA);
    expect(network.bodiesFor(ROUTES.clear), 'no second request').toHaveLength(1);
    await act(async () => clearResponse.resolve(jsonResponse({ clearedErrorCount: 1 })));
    expect(await screen.findByText(CLEAR_VALIDATION_ERRORS_SUCCESS)).toBeInTheDocument();
  });

  it('shows a cleared fallback row as resolved, without the fallback line or Clear (P2-5)', async () => {
    let cleared = false;
    const { network } = await mountPage(
      defaultRoutes({
        clear: () => {
          cleared = true;
          return jsonResponse({ clearedErrorCount: 0 });
        },
        details: request => {
          const id = Number(/details\/(\d+)/.exec(request.url)?.[1]);
          if (id !== FALLBACK_ROW.coreMeasurementID) return jsonResponse({ row: VALIDATION_ROW, allErrors: [], relatedRows: [] });
          return cleared
            ? jsonResponse({ row: null, allErrors: [], relatedRows: [] })
            : jsonResponse({
                row: FALLBACK_ROW,
                allErrors: [{ source: 'ingestion', code: FALLBACK_ERROR_CODE, message: FALLBACK_ERROR_MESSAGE, fields: [], comparison: null }],
                relatedRows: []
              });
        }
      })
    );
    await userEvent.click(
      within(
        screen.getAllByRole('heading', { level: 2 }).find(heading => heading.textContent?.includes(MARKED_INVALID_NO_ERROR_LOGGED_LABEL)) as HTMLElement
      ).getByRole('button')
    );
    await openDetailsFor(Number(FALLBACK_ROW.coreMeasurementID), FALLBACK_LABEL);
    await userEvent.click(await screen.findByRole('button', { name: DETAILS_SHEET_TEXT.clearValidationErrors }));
    expect(await screen.findByText(CLEAR_VALIDATION_ERRORS_SUCCESS)).toBeInTheDocument();
    const sheet = screen.getByTestId('error-row-details-sheet');
    console.log('[view-errors cleared fallback sheet]', sheet.textContent, JSON.stringify(network.bodiesFor(ROUTES.clear)));
    expect(within(sheet).getByText(DETAILS_SHEET_TEXT.rowResolved)).toBeInTheDocument();
    expect(within(sheet).queryByText(MARKED_INVALID_NO_ERROR_LOGGED_LABEL)).toBeNull();
    expect(within(sheet).queryByRole('button', { name: DETAILS_SHEET_TEXT.clearValidationErrors })).toBeNull();
  });
});

describe('Edit this row on a related-row sheet (P5-2)', () => {
  it('is shown disabled with its tooltip when the sheet was reached through a related row', async () => {
    const related = { coreMeasurementID: 101, treeTag: 'T-101', stemTag: 'S-1', errorCount: 1, errorMessages: ['Flagged;Different species'], inErrorSet: true };
    await mountPage(
      defaultRoutes({
        details: request => {
          const id = Number(/details\/(\d+)/.exec(request.url)?.[1]);
          const allErrors = [{ source: 'validation', code: '14', message: 'Flagged;Different species', fields: ['speciesCode'], comparison: null }];
          return id === 102
            ? jsonResponse({ row: { ...SECOND_CENSUS_ROW, hasContradiction: true, relatedMeasurementIDs: [101] }, allErrors, relatedRows: [related] })
            : jsonResponse({ row: VALIDATION_ROW, allErrors, relatedRows: [] });
        }
      })
    );
    await openDetailsFor(102);
    await userEvent.click(await screen.findByRole('button', { name: 'Open row 101' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Measurement 101' })).toBeInTheDocument());
    const edit = screen.getByRole('button', { name: DETAILS_SHEET_TEXT.editThisRow });
    console.log('[view-errors related edit]', edit.outerHTML.slice(0, 120));
    expect(edit).toBeDisabled();
    await userEvent.hover(edit.parentElement as HTMLElement);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(EDIT_THIS_ROW_UNAVAILABLE_TOOLTIP);
  });
});

describe('Scope cancellation on a census change (P2-8)', () => {
  it('closes an open dialog, sends no apply and shows the not-saved notice', async () => {
    const { network, rerender } = await mountPage();
    const pendingSave = beginRowSaveAwaitingDialog(GROUP_LABEL, 102, { measuredDBH: 12 });
    expect(await findPreviewApply(network, pendingSave)).toBeInTheDocument();
    page.censusIDs = [9];
    const { default: ErrorsExplorer } = await import('./errorsexplorer');
    rerender(<ErrorsExplorer />);
    await waitFor(() => expect(screen.queryByTestId('edit-preview-apply')).toBeNull());
    expect(network.bodiesFor(ROUTES.apply)).toHaveLength(0);
    expect(await screen.findByText(VIEW_ERRORS_ALERTS.editCancelledByCensusChange('T-102', 'S-1'))).toBeInTheDocument();
  });

  it('logs no React warning when unmounted with the dialog open', async () => {
    const consoleError = vi.spyOn(console, 'error');
    const { network, unmount } = await mountPage();
    const pendingSave = beginRowSaveAwaitingDialog(GROUP_LABEL, 102, { measuredDBH: 12 });
    await findPreviewApply(network, pendingSave);
    unmount();
    await act(async () => undefined);
    expect(network.bodiesFor(ROUTES.apply)).toHaveLength(0);
    expect(consoleError.mock.calls.filter(call => /unmounted|state update/i.test(String(call[0])))).toHaveLength(0);
  });
});

describe('View rebuild recovery (P3-2, P3-4)', () => {
  it('gates every read after a failed rebuild and recovers rebuilds-first through Retry refresh', async () => {
    let rebuildFails = true;
    const { network } = await mountPage(
      defaultRoutes({
        preview: () => jsonResponse({ ...WARN_PLAN, maxSeverity: 'info' }),
        rebuildSummary: () => (rebuildFails ? jsonResponse({ error: 'Lock wait timeout exceeded' }, 500) : jsonResponse({ success: true }))
      })
    );
    await saveRowThroughGrid(GROUP_LABEL, 102, { measuredDBH: 12 });
    expect(await screen.findByText(VIEW_ERRORS_ALERTS.savedButRefreshFailed('Lock wait timeout exceeded'))).toBeInTheDocument();
    expect(await screen.findByText(VIEW_ERRORS_TEXT.totalsStale)).toBeInTheDocument();
    rebuildFails = false;
    const start = network.requests.length;
    await userEvent.click(screen.getByRole('button', { name: VIEW_ERRORS_TEXT.retryRefresh }));
    await waitFor(() => expect(screen.queryByText(VIEW_ERRORS_TEXT.totalsStale)).toBeNull());
    const urls = network.urlsSince(start);
    console.log('[view-errors recovery order]', JSON.stringify(urls));
    const firstRead = urls.findIndex(url => ROUTES.facets.test(url) || ROUTES.query.test(url));
    const rebuilds = urls.filter(url => ROUTES.rebuild.test(url));
    expect(rebuilds).toHaveLength(2);
    expect(urls.findIndex(url => ROUTES.rebuild.test(url))).toBeLessThan(firstRead);
    expect(
      urls.some(url => ROUTES.apply.test(url)),
      'the save is never re-sent'
    ).toBe(false);
  });
});

const TWELVE_GROUP_COUNT = 12;
const INITIAL_GROUP_LIMIT = 10;
const UNMAPPED_MESSAGE = 'A message nobody has given a friendlier label';
const DBH_CHANGE_VALIDATION_CODE = '1';
const SHARED_MESSAGE = 'Flagged;Different species';

function groupHeadingTexts(): string[] {
  return screen.getAllByRole('heading', { level: 2 }).map(heading => heading.textContent ?? '');
}

function groupHeading(labelPart: string): HTMLElement {
  const heading = screen.getAllByRole('heading', { level: 2 }).find(candidate => candidate.textContent?.includes(labelPart));
  if (!heading) throw new Error(`No group heading contains "${labelPart}". Headings: ${JSON.stringify(groupHeadingTexts())}`);
  return heading;
}

function ownFacet(
  code: string,
  message: string,
  fields: string[] = ['measuredDBH'],
  count = 1,
  source: 'validation' | 'ingestion' = 'validation'
): ErrorTypeFacet {
  return { source, code, message, fields, count, hasContradiction: false };
}

describe('Show control tiles and empty states', () => {
  it('shows the census empty state, with no Clear filters, for a census that has no errors', async () => {
    await mountPage(defaultRoutes({ facets: () => jsonResponse(facetsResponse([], { affectedMeasurements: 0, errorTypeCount: 0, validation: 0 })) }), {
      awaitGroupGrid: false
    });
    expect(await screen.findByText(VIEW_ERRORS_TEXT.emptyCensus)).toBeInTheDocument();
    console.log(
      '[view-errors empty census]',
      document.body.textContent?.includes(VIEW_ERRORS_TEXT.clearFilters),
      document.body.textContent?.includes('This census is clear')
    );
    expect(screen.queryByRole('button', { name: VIEW_ERRORS_TEXT.clearFilters }), 'nothing is filtered, so there is nothing to clear').toBeNull();
    expect(screen.queryByText(VIEW_ERRORS_TEXT.emptyFiltered)).toBeNull();
    expect(document.body.textContent).not.toMatch(/✓|This census is clear/);
  });

  it('keeps the Failed tile and Fix button on failedMeasurements, not on the Ingestion count', async () => {
    await mountPage(
      defaultRoutes({ facets: () => jsonResponse(facetsResponse([VALIDATION_FACET], { affectedMeasurements: 9, ingestion: 7, failedMeasurements: 2 })) })
    );
    const failedTile = await screen.findByTestId('errors-tile-failed');
    console.log('[view-errors failed tile]', failedTile.textContent, screen.getByTestId('errorsexplorer-fix-failed-link').textContent);
    expect(within(failedTile).getByText('2')).toBeInTheDocument();
    expect(screen.getByTestId('errorsexplorer-fix-failed-link')).toHaveTextContent(/^Fix 2 failed uploads$/);
  });

  it('offers no Fix button to a user who cannot edit', async () => {
    page.userStatus = 'pending';
    await mountPage(defaultRoutes({ facets: () => jsonResponse(facetsResponse([VALIDATION_FACET], { failedMeasurements: 2 })) }));
    await screen.findByTestId('errors-tile-failed');
    expect(screen.queryByTestId('errorsexplorer-fix-failed-link')).toBeNull();
    expect(screen.getByTestId('errorsexplorer-readonly-banner')).toBeInTheDocument();
  });

  it('leaves the totals tiles on the census totals whatever the facets filters are', async () => {
    const { network } = await mountPage(
      defaultRoutes({
        facets: request => {
          const source = (request.body?.filters as { source?: string } | undefined)?.source;
          return jsonResponse(
            facetsResponse(source === 'ingestion' ? [FALLBACK_FACET] : [VALIDATION_FACET, FALLBACK_FACET], {
              affectedMeasurements: 3,
              validation: 2,
              ingestion: 1
            })
          );
        }
      })
    );
    await userEvent.click(within(screen.getByRole('group', { name: VIEW_ERRORS_TEXT.showLabel })).getByRole('button', { name: /^Ingestion/ }));
    await waitFor(() => expect(network.bodiesFor(ROUTES.facets).at(-1)?.filters).toMatchObject({ source: 'ingestion' }));
    await waitFor(() => expect(screen.queryByRole('heading', { level: 2, name: new RegExp(GROUP_LABEL.replace(' rows', '')) })).toBeNull());
    console.log(
      '[view-errors tiles under Ingestion]',
      screen.getByTestId('errors-tile-affected').textContent,
      screen.getByTestId('errors-tile-validation').textContent
    );
    expect(within(screen.getByTestId('errors-tile-affected')).getByText('3')).toBeInTheDocument();
    expect(within(screen.getByTestId('errors-tile-validation')).getByText('2')).toBeInTheDocument();
  });
});

describe('Error-type groups', () => {
  it('lists the groups in the order served and expands only the first on load', async () => {
    const second = ownFacet('2', UNMAPPED_MESSAGE, ['measuredHOM'], 4);
    const third = ownFacet('3', 'Another unmapped message', ['description'], 1);
    await mountPage(defaultRoutes({ facets: () => jsonResponse(facetsResponse([second, VALIDATION_FACET, third])) }), { awaitGroupGrid: false });
    await waitFor(() => expect(groupHeadingTexts()).toHaveLength(3));
    const headings = groupHeadingTexts();
    console.log('[view-errors group order]', JSON.stringify(headings));
    expect(headings[0]).toContain(UNMAPPED_MESSAGE);
    expect(headings[1]).toContain('Different species');
    expect(headings[2]).toContain('Another unmapped message');
    const expandedStates = screen.getAllByRole('heading', { level: 2 }).map(heading => within(heading).getByRole('button').getAttribute('aria-expanded'));
    console.log('[view-errors group expansion]', JSON.stringify(expandedStates), JSON.stringify([...capturedGrids.keys()]));
    expect(expandedStates).toEqual(['true', 'false', 'false']);
    expect([...capturedGrids.keys()]).toEqual([`${UNMAPPED_MESSAGE} rows`]);
  });

  it('lists ten groups, then every group after "Show n more"', async () => {
    const facets = Array.from({ length: TWELVE_GROUP_COUNT }, (_unused, index) => ownFacet(`CODE-${index}`, `Message number ${index}`));
    await mountPage(defaultRoutes({ facets: () => jsonResponse(facetsResponse(facets, { errorTypeCount: TWELVE_GROUP_COUNT })) }), { awaitGroupGrid: false });
    await waitFor(() => expect(groupHeadingTexts()).toHaveLength(INITIAL_GROUP_LIMIT));
    const showMore = screen.getByRole('button', { name: formatShowMoreErrorTypes(TWELVE_GROUP_COUNT - INITIAL_GROUP_LIMIT) });
    await userEvent.click(showMore);
    console.log('[view-errors show more]', groupHeadingTexts().length);
    expect(groupHeadingTexts()).toHaveLength(TWELVE_GROUP_COUNT);
    expect(screen.queryByRole('button', { name: /^Show \d+ more error type/ })).toBeNull();
  });

  it('shows the display label in the heading while the group request carries the stored message', async () => {
    const { network } = await mountPage();
    expect(groupHeading('Different species').textContent).not.toContain(SHARED_MESSAGE);
    const body = network.bodiesFor(ROUTES.query).find(candidate => candidate?.errorType);
    console.log('[view-errors group identity]', JSON.stringify(body?.errorType));
    expect(body?.errorType).toEqual({ source: 'validation', code: '14', message: SHARED_MESSAGE });
  });

  it('shows an unmapped message as stored, in the heading and in the request', async () => {
    const unmapped = ownFacet('77', UNMAPPED_MESSAGE);
    const { network } = await mountPage(defaultRoutes({ facets: () => jsonResponse(facetsResponse([unmapped])) }), { awaitGroupGrid: false });
    await waitFor(() => expect(capturedGrids.has(`${UNMAPPED_MESSAGE} rows`)).toBe(true));
    console.log('[view-errors unmapped message]', groupHeadingTexts()[0], JSON.stringify(network.bodiesFor(ROUTES.query)[0]?.errorType));
    expect(groupHeadingTexts()[0]).toContain(UNMAPPED_MESSAGE);
    expect(network.bodiesFor(ROUTES.query)[0]?.errorType).toEqual({ source: 'validation', code: '77', message: UNMAPPED_MESSAGE });
  });

  it('gives each group its own visible columns, and the DBH-change columns only to the DBH-change codes', async () => {
    const dbhChange = ownFacet(DBH_CHANGE_VALIDATION_CODE, 'DBH shrank', ['measuredDBH']);
    const coordinates = ownFacet('9', 'Coordinates are off', ['stemLocalX', 'stemLocalY']);
    await mountPage(defaultRoutes({ facets: () => jsonResponse(facetsResponse([dbhChange, coordinates])) }), { awaitGroupGrid: false });
    await waitFor(() => expect(capturedGrids.has('DBH shrank rows')).toBe(true));
    await userEvent.click(within(groupHeading('Coordinates are off')).getByRole('button'));
    await waitFor(() => expect(capturedGrids.has('Coordinates are off rows')).toBe(true));
    const dbhVisibility = requireGrid('DBH shrank rows').columnVisibilityModel;
    const coordinateVisibility = requireGrid('Coordinates are off rows').columnVisibilityModel;
    console.log('[view-errors column visibility]', JSON.stringify({ dbhVisibility, coordinateVisibility }));
    expect(dbhVisibility).toMatchObject({ priorDBH: true, measuredDBH: true, dbhChangePercent: true, stemLocalX: false });
    expect(coordinateVisibility).toMatchObject({ stemLocalX: true, stemLocalY: true, priorDBH: false, dbhChangePercent: false, measuredDBH: false });
  });

  it.each([
    ['names the census the prior DBH came from', [{ censusIDs: [5], plotCensusNumber: 3 }], 'DBH in Census 3'],
    [
      'falls back to "Prior DBH" when the census list does not know the prior census',
      [{ censusIDs: [99], plotCensusNumber: 3 }],
      VIEW_ERRORS_TEXT.priorDbhColumn
    ]
  ])('the Prior DBH header %s', async (_label, censusList, expectedHeader) => {
    page.censusList = censusList;
    const priorRow = explorerRow(103, { errorCodes: [DBH_CHANGE_VALIDATION_CODE], priorDBH: 8, priorCensusID: 5 });
    const dbhChange = ownFacet(DBH_CHANGE_VALIDATION_CODE, 'DBH shrank', ['measuredDBH']);
    await mountPage(
      defaultRoutes({
        facets: () => jsonResponse(facetsResponse([dbhChange])),
        query: () => jsonResponse({ rows: [priorRow], totalRows: 1 })
      }),
      { awaitGroupGrid: false }
    );
    await waitFor(() => expect(capturedGrids.get('DBH shrank rows')?.rows).toHaveLength(1));
    const header = requireGrid('DBH shrank rows').columns.find(column => column.field === 'priorDBH')?.headerName;
    console.log('[view-errors prior dbh header]', header);
    expect(header).toBe(expectedHeader);
  });

  it('lists both identities that share a ?message= link, expands only the first and shows the Filtered-to chip', async () => {
    page.search = new URLSearchParams({ message: SHARED_MESSAGE }).toString();
    const validation = ownFacet('14', SHARED_MESSAGE, ['speciesCode'], 2);
    const ingestion = ownFacet('SPECIES_CONFLICT', SHARED_MESSAGE, ['speciesCode'], 1, 'ingestion');
    const { network } = await mountPage(defaultRoutes({ facets: () => jsonResponse(facetsResponse([validation, ingestion])) }));
    await waitFor(() => expect(groupHeadingTexts()).toHaveLength(2));
    const expandedStates = screen.getAllByRole('heading', { level: 2 }).map(heading => within(heading).getByRole('button').getAttribute('aria-expanded'));
    const facetsFilters = network.bodiesFor(ROUTES.facets).at(-1)?.filters;
    console.log('[view-errors message link]', JSON.stringify({ expandedStates, facetsFilters, grids: [...capturedGrids.keys()] }));
    expect(expandedStates).toEqual(['true', 'false']);
    expect(facetsFilters).toMatchObject({ exactMessages: [SHARED_MESSAGE] });
    expect(screen.getByText(`${VIEW_ERRORS_TEXT.filteredToPrefix} Different species`)).toBeInTheDocument();
    expect(capturedGrids.size, 'only the first group loads rows').toBe(1);
  });
});

async function expandGroup(labelPart: string, gridLabel: string) {
  await userEvent.click(within(groupHeading(labelPart)).getByRole('button'));
  await waitFor(() => expect(capturedGrids.has(gridLabel)).toBe(true));
}

/** The closed Drawer keeps its content mounted but hidden, so "open" means a visible measurement heading. */
function queryOpenSheetHeading(): HTMLElement | null {
  return screen.queryByRole('heading', { name: /^Measurement \d+$/ });
}

function sheetElement(): HTMLElement {
  return screen.getByTestId('error-row-details-sheet');
}

interface CellColumn {
  field: string;
  renderCell?: (params: { row: ErrorExplorerRow }) => React.ReactNode;
}

describe('Rows marked invalid with no error logged (D-h)', () => {
  const FAILED_FALLBACK_ROW = explorerRow(202, {
    errorSources: ['ingestion'],
    errorCodes: [FALLBACK_ERROR_CODE],
    primaryErrorMessage: FALLBACK_ERROR_MESSAGE,
    errorMessages: [FALLBACK_ERROR_MESSAGE],
    errorFields: [],
    isFailedRow: true
  });

  it('shows the plain label in the Errors cell, the heading and the sheet, with no source chip and no error card', async () => {
    await mountPage();
    expect(within(groupHeading(MARKED_INVALID_NO_ERROR_LOGGED_LABEL)).queryByText(VIEW_ERRORS_TEXT.ingestionChip), 'the heading has no source chip').toBeNull();
    expect(within(groupHeading(MARKED_INVALID_NO_ERROR_LOGGED_LABEL)).queryByText(VIEW_ERRORS_TEXT.validationChip)).toBeNull();
    await expandGroup(MARKED_INVALID_NO_ERROR_LOGGED_LABEL, FALLBACK_LABEL);

    const errorsColumn = requireGrid(FALLBACK_LABEL).columns.find(column => column.field === ERRORS_LABEL_FIELD) as unknown as CellColumn;
    const cell = render(<>{errorsColumn.renderCell?.({ row: FALLBACK_ROW })}</>);
    console.log('[view-errors fallback cell]', cell.container.textContent);
    expect(cell.container.textContent).toContain(MARKED_INVALID_NO_ERROR_LOGGED_LABEL);
    expect(cell.container.textContent).not.toContain(FALLBACK_ERROR_MESSAGE);
    cell.unmount();

    await openDetailsFor(Number(FALLBACK_ROW.coreMeasurementID), FALLBACK_LABEL);
    const sheet = await screen.findByTestId('error-row-details-fallback');
    console.log('[view-errors fallback sheet]', sheetElement().textContent);
    expect(sheet).toHaveTextContent(MARKED_INVALID_NO_ERROR_LOGGED_LABEL);
    expect(within(sheetElement()).queryByTestId('error-row-details-error-card')).toBeNull();
    expect(within(sheetElement()).queryByText(VIEW_ERRORS_TEXT.ingestionChip)).toBeNull();
    expect(within(sheetElement()).queryByText(VIEW_ERRORS_TEXT.validationChip)).toBeNull();
  });

  it('asks for the group with the stored identity, never the display label', async () => {
    const { network } = await mountPage();
    await expandGroup(MARKED_INVALID_NO_ERROR_LOGGED_LABEL, FALLBACK_LABEL);
    const identities = network.bodiesFor(ROUTES.query).map(body => body?.errorType);
    console.log('[view-errors fallback identity]', JSON.stringify(identities));
    expect(identities).toContainEqual({ source: 'ingestion', code: FALLBACK_ERROR_CODE, message: FALLBACK_ERROR_MESSAGE });
  });

  it('is listed under Show, Ingestion', async () => {
    const { network } = await mountPage(
      defaultRoutes({
        facets: request => {
          const source = (request.body?.filters as { source?: string } | undefined)?.source;
          return jsonResponse(facetsResponse(source === 'ingestion' ? [FALLBACK_FACET] : [VALIDATION_FACET], { ingestion: 1 }));
        }
      })
    );
    expect(
      groupHeadingTexts().some(text => text.includes(MARKED_INVALID_NO_ERROR_LOGGED_LABEL)),
      'not listed under All in this fixture'
    ).toBe(false);
    await userEvent.click(within(screen.getByRole('group', { name: VIEW_ERRORS_TEXT.showLabel })).getByRole('button', { name: /^Ingestion/ }));
    await waitFor(() => expect(groupHeadingTexts().some(text => text.includes(MARKED_INVALID_NO_ERROR_LOGGED_LABEL))).toBe(true));
    console.log(
      '[view-errors fallback under ingestion]',
      JSON.stringify(groupHeadingTexts()),
      JSON.stringify(network.bodiesFor(ROUTES.facets).at(-1)?.filters)
    );
    expect(network.bodiesFor(ROUTES.facets).at(-1)?.filters).toMatchObject({ source: 'ingestion' });
  });

  it('offers Clear to an editor on a linked fallback row', async () => {
    await mountPage();
    await expandGroup(MARKED_INVALID_NO_ERROR_LOGGED_LABEL, FALLBACK_LABEL);
    await openDetailsFor(Number(FALLBACK_ROW.coreMeasurementID), FALLBACK_LABEL);
    expect(await screen.findByRole('button', { name: DETAILS_SHEET_TEXT.clearValidationErrors })).toBeEnabled();
  });

  it('offers no Clear for a failed fallback row, which the route refuses with 409', async () => {
    await mountPage(
      defaultRoutes({
        query: request => {
          const code = (request.body?.errorType as { code?: string } | undefined)?.code;
          const rows = code === FALLBACK_ERROR_CODE ? [FAILED_FALLBACK_ROW] : rowsFor(code);
          return jsonResponse({ rows, totalRows: rows.length });
        },
        details: () =>
          jsonResponse({
            row: FAILED_FALLBACK_ROW,
            allErrors: [{ source: 'ingestion', code: FALLBACK_ERROR_CODE, message: FALLBACK_ERROR_MESSAGE, fields: [], comparison: null }],
            relatedRows: []
          })
      })
    );
    await expandGroup(MARKED_INVALID_NO_ERROR_LOGGED_LABEL, FALLBACK_LABEL);
    await openDetailsFor(Number(FAILED_FALLBACK_ROW.coreMeasurementID), FALLBACK_LABEL);
    await screen.findByTestId('error-row-details-fallback');
    console.log('[view-errors failed fallback sheet]', sheetElement().textContent);
    expect(within(sheetElement()).queryByRole('button', { name: DETAILS_SHEET_TEXT.clearValidationErrors })).toBeNull();
  });

  it('offers no Clear to a pending user, who can still open the details', async () => {
    page.userStatus = 'pending';
    await mountPage();
    await expandGroup(MARKED_INVALID_NO_ERROR_LOGGED_LABEL, FALLBACK_LABEL);
    await openDetailsFor(Number(FALLBACK_ROW.coreMeasurementID), FALLBACK_LABEL);
    await screen.findByTestId('error-row-details-fallback');
    expect(within(sheetElement()).queryByRole('button', { name: DETAILS_SHEET_TEXT.clearValidationErrors })).toBeNull();
    expect(within(sheetElement()).queryByRole('button', { name: DETAILS_SHEET_TEXT.editThisRow })).toBeNull();
  });
});

describe('Details sheet', () => {
  it('does not open on a row click: the grid has no row click handler', async () => {
    await mountPage();
    await waitFor(() => expect(screen.getByTestId(`captured-row-${GROUP_LABEL}-101`)).toBeInTheDocument());
    await userEvent.click(screen.getByTestId(`captured-row-${GROUP_LABEL}-101`));
    const gridProps = requireGrid(GROUP_LABEL) as unknown as Record<string, unknown>;
    console.log('[view-errors row click]', typeof gridProps.onRowClick, queryOpenSheetHeading() === null);
    expect(gridProps.onRowClick).toBeUndefined();
    expect(queryOpenSheetHeading()).toBeNull();
  });

  it.each([
    ['an editor', 'global'],
    ['a read-only user', 'pending']
  ])('opens from the Details action for %s', async (_label, userStatus) => {
    page.userStatus = userStatus;
    await mountPage();
    await openDetailsFor(101);
    console.log('[view-errors details action]', userStatus, sheetElement().textContent);
    expect(within(sheetElement()).getByText('Different species')).toBeInTheDocument();
  });

  it('enables Edit this row when the origin row is on screen and nothing is locked, and starts the edit on that row', async () => {
    await mountPage();
    await openDetailsFor(102);
    const edit = await screen.findByRole('button', { name: DETAILS_SHEET_TEXT.editThisRow });
    expect(edit).toBeEnabled();
    await userEvent.click(edit);
    await waitFor(() => expect(queryOpenSheetHeading()).toBeNull());
    const actions = within(screen.getByTestId(`captured-row-${GROUP_LABEL}-102`))
      .getAllByRole('menuitem')
      .map(item => item.getAttribute('aria-label'));
    console.log('[view-errors edit this row]', JSON.stringify(actions));
    expect(actions).toEqual([VIEW_ERRORS_TEXT.detailsAction, VIEW_ERRORS_TEXT.saveAction, VIEW_ERRORS_TEXT.cancelAction]);
  });

  it('disables Edit this row and Clear, each with the lock tooltip, while another row is being edited', async () => {
    await mountPage();
    await openDetailsFor(102);
    await screen.findByRole('button', { name: DETAILS_SHEET_TEXT.clearValidationErrors });
    enterEdit(GROUP_LABEL, 101);
    const edit = await screen.findByRole('button', { name: DETAILS_SHEET_TEXT.editThisRow });
    const clear = screen.getByRole('button', { name: DETAILS_SHEET_TEXT.clearValidationErrors });
    console.log(
      '[view-errors locked sheet]',
      JSON.stringify({ editDisabled: (edit as HTMLButtonElement).disabled, clearDisabled: (clear as HTMLButtonElement).disabled })
    );
    await waitFor(() => expect(edit).toBeDisabled());
    expect(clear).toBeDisabled();
    await userEvent.hover(edit.parentElement as HTMLElement);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(EDIT_LOCK_TOOLTIPS.editing);
  });

  it('disables Edit this row, with its own tooltip, once the origin row is no longer on screen', async () => {
    await mountPage(
      defaultRoutes({
        query: request => {
          const filtered = (request.body?.columnFilters as unknown[] | undefined)?.length;
          const rows = filtered ? [VALIDATION_ROW] : rowsFor(undefined);
          return jsonResponse({ rows, totalRows: rows.length });
        }
      })
    );
    await openDetailsFor(102);
    act(() => requireGrid(GROUP_LABEL).onFilterModelChange?.({ items: [{ field: 'treeTag', operator: 'contains', value: 'T-101' }] }));
    await waitFor(() => expect(requireGrid(GROUP_LABEL).rows.map(row => Number(row.id))).toEqual([101]));
    await waitFor(() => expect(screen.getByRole('button', { name: DETAILS_SHEET_TEXT.editThisRow })).toBeDisabled());
    const edit = screen.getByRole('button', { name: DETAILS_SHEET_TEXT.editThisRow });
    await userEvent.hover(edit.parentElement as HTMLElement);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(EDIT_THIS_ROW_UNAVAILABLE_TOOLTIP);
  });

  it('shows a related row outside the error set in the comparison, without a way to inspect it', async () => {
    const outsideSet = { coreMeasurementID: 150, treeTag: 'T-150', stemTag: 'S-1', errorCount: 0, errorMessages: [], inErrorSet: false };
    const insideSet = { coreMeasurementID: 151, treeTag: 'T-151', stemTag: 'S-1', errorCount: 1, errorMessages: [SHARED_MESSAGE], inErrorSet: true };
    await mountPage(
      defaultRoutes({
        details: () =>
          jsonResponse({
            row: { ...SECOND_CENSUS_ROW, hasContradiction: true, contradictionTypes: ['duplicate_tag_stem'], relatedMeasurementIDs: [150, 151] },
            allErrors: [{ source: 'validation', code: '14', message: SHARED_MESSAGE, fields: [], comparison: null }],
            relatedRows: [outsideSet, insideSet]
          })
      })
    );
    await openDetailsFor(102);
    await screen.findByText(DETAILS_SHEET_TEXT.compareTitle);
    console.log('[view-errors outside error set]', sheetElement().textContent);
    expect(within(sheetElement()).getByText(DETAILS_SHEET_TEXT.noUnresolvedErrors)).toBeInTheDocument();
    expect(within(sheetElement()).queryByRole('button', { name: DETAILS_SHEET_TEXT.inspectRow })).toBeNull();
    expect(within(sheetElement()).queryByRole('button', { name: 'Open row 150' }), 'no way to open a row that has no unresolved error').toBeNull();
    expect(within(sheetElement()).getByRole('button', { name: 'Open row 151' }), 'the partner in the error set stays openable').toBeEnabled();
  });
});

describe('Clear validation errors while an edit is open', () => {
  it('stays disabled and sends no request when clicked', async () => {
    const { network } = await mountPage();
    await openDetailsFor(102);
    await screen.findByRole('button', { name: DETAILS_SHEET_TEXT.clearValidationErrors });
    enterEdit(GROUP_LABEL, 101);
    const clear = screen.getByRole('button', { name: DETAILS_SHEET_TEXT.clearValidationErrors });
    await waitFor(() => expect(clear).toBeDisabled());
    await userEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never }).click(clear);
    console.log('[view-errors clear during edit]', JSON.stringify(network.bodiesFor(ROUTES.clear)));
    expect(network.bodiesFor(ROUTES.clear)).toHaveLength(0);
  });
});

const INFO_PLAN = { ...WARN_PLAN, maxSeverity: 'info' };
const CANCELLED_ERROR_NAME = 'EditOperationCancelledError';
const REBUILD_FAILURE_MESSAGE = 'Lock wait timeout exceeded';
const OTHER_CENSUS_IDS = [9];

function isReadRequest(url: string): boolean {
  return ROUTES.facets.test(url) || ROUTES.query.test(url);
}

function groupGridTestID(facet: ErrorTypeFacet): string {
  return `errors-grid-group:${buildErrorTypeKey(facet)}`;
}

/** What MUI does when processRowUpdate rejects: report the error to onProcessRowUpdateError. */
async function saveAndReportFailure(label: string, rowID: number, changes: Record<string, unknown>): Promise<unknown> {
  const outcome = await saveRowThroughGrid(label, rowID, changes);
  if (outcome instanceof Error) {
    const reportError = (requireGrid(label) as unknown as { onProcessRowUpdateError?: (error: Error) => void }).onProcessRowUpdateError;
    act(() => reportError?.(outcome));
  }
  return outcome;
}

async function changeCensus(censusIDs: number[], rerender: (ui: React.ReactElement) => void) {
  page.censusIDs = censusIDs;
  const { default: ErrorsExplorer } = await import('./errorsexplorer');
  rerender(<ErrorsExplorer />);
}

describe('Scope cancellation after a census change, continued (P2-8)', () => {
  it('settles the interrupted save as cancelled and releases the lock, so the new census is editable', async () => {
    const { network, rerender } = await mountPage();
    const pendingSave = beginRowSaveAwaitingDialog(GROUP_LABEL, 102, { measuredDBH: 12 });
    await findPreviewApply(network, pendingSave);
    await changeCensus(OTHER_CENSUS_IDS, rerender);
    const settled = (await pendingSave) as Error;
    console.log('[view-errors cancelled save]', settled?.name, settled?.message);
    expect(settled).toBeInstanceOf(Error);
    expect(settled.name).toBe(CANCELLED_ERROR_NAME);
    await waitFor(() => expect(capturedGrids.get(GROUP_LABEL)?.rows.length).toBeGreaterThan(0));
    await waitFor(() => expect(requireGrid(GROUP_LABEL).disableColumnSorting, 'the grid is unlocked').toBe(false));
    expect(screen.getByRole('textbox', { name: VIEW_ERRORS_TEXT.searchLabel }), 'Search is unlocked').toBeEnabled();
  });

  it('reopens no dialog when a confirmed apply, outstanding across a census change, answers 409', async () => {
    const applyResponse = deferred<Response>();
    const { network, rerender } = await mountPage(defaultRoutes({ apply: () => applyResponse.promise }));
    const pendingSave = beginRowSaveAwaitingDialog(GROUP_LABEL, 102, { measuredDBH: 12 });
    await userEvent.click(await findPreviewApply(network, pendingSave));
    await waitFor(() => expect(network.bodiesFor(ROUTES.apply)).toHaveLength(1));
    await changeCensus(OTHER_CENSUS_IDS, rerender);
    await waitFor(() => expect(screen.queryByTestId('edit-preview-apply'), 'the dialog is detached from the old census').toBeNull());
    await act(async () => applyResponse.resolve(jsonResponse({ freshPlan: { ...WARN_PLAN, planHash: 'c'.repeat(64) } }, 409)));
    const settled = (await pendingSave) as Error;
    console.log('[view-errors 409 after census change]', settled?.name, JSON.stringify(network.bodiesFor(ROUTES.apply).length));
    expect(settled.name).toBe(CANCELLED_ERROR_NAME);
    expect(screen.queryByTestId('edit-preview-apply'), 'the fresh plan is not offered for a census the user left').toBeNull();
    expect(network.bodiesFor(ROUTES.apply), 'the apply is never re-sent').toHaveLength(1);
  });

  it('settles the pending save and sends no apply when the page unmounts with the dialog open', async () => {
    const { network, unmount } = await mountPage();
    const pendingSave = beginRowSaveAwaitingDialog(GROUP_LABEL, 102, { measuredDBH: 12 });
    await findPreviewApply(network, pendingSave);
    unmount();
    const settled = (await pendingSave) as Error;
    console.log('[view-errors unmounted save]', settled?.name);
    expect(settled.name).toBe(CANCELLED_ERROR_NAME);
    expect(network.bodiesFor(ROUTES.apply)).toHaveLength(0);
  });
});

describe('View rebuild recovery, continued (P3-2, P3-4)', () => {
  async function saveWithFailingRebuild(options: { afterRebuildFails?: () => void; routes?: Parameters<typeof defaultRoutes>[0] } = {}) {
    const state = { rebuildFails: true, queryFails: false };
    const mounted = await mountPage(
      defaultRoutes({
        preview: () => jsonResponse(INFO_PLAN),
        rebuildSummary: () => (state.rebuildFails ? jsonResponse({ error: REBUILD_FAILURE_MESSAGE }, 500) : jsonResponse({ success: true })),
        query: request => {
          if (state.queryFails) return jsonResponse({ error: 'Query exploded' }, 500);
          const rows = rowsFor((request.body?.errorType as { code?: string } | undefined)?.code);
          return jsonResponse({ rows, totalRows: rows.length });
        },
        ...options.routes
      })
    );
    await saveRowThroughGrid(GROUP_LABEL, 102, { measuredDBH: 12 });
    expect(await screen.findByText(VIEW_ERRORS_TEXT.totalsStale)).toBeInTheDocument();
    return { ...mounted, state };
  }

  it('runs no read when Retry refresh fails again, and keeps every unit stale', async () => {
    const { network } = await saveWithFailingRebuild();
    const start = network.requests.length;
    await userEvent.click(screen.getByRole('button', { name: VIEW_ERRORS_TEXT.retryRefresh }));
    await waitFor(() => expect(network.urlsSince(start).filter(url => ROUTES.rebuild.test(url))).toHaveLength(2));
    await act(async () => undefined);
    const urls = network.urlsSince(start);
    console.log('[view-errors second failure]', JSON.stringify(urls));
    expect(urls.filter(isReadRequest), 'no read while a rebuild is still pending').toHaveLength(0);
    expect(urls.some(url => ROUTES.apply.test(url))).toBe(false);
    expect(screen.getByText(VIEW_ERRORS_TEXT.totalsStale)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: VIEW_ERRORS_TEXT.retryRefresh })).toBeInTheDocument();
  });

  it('retries only the group query that failed after a good rebuild', async () => {
    const { network, state } = await saveWithFailingRebuild();
    state.rebuildFails = false;
    state.queryFails = true;
    await userEvent.click(screen.getByRole('button', { name: VIEW_ERRORS_TEXT.retryRefresh }));
    const groupGrid = () => screen.getByTestId(groupGridTestID(VALIDATION_FACET));
    expect(await within(groupGrid()).findByText(VIEW_ERRORS_TEXT.rowsStale)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(VIEW_ERRORS_TEXT.totalsStale), 'the rebuild is good, so the totals are not stale').toBeNull());
    state.queryFails = false;
    const start = network.requests.length;
    await userEvent.click(within(groupGrid()).getByRole('button', { name: VIEW_ERRORS_TEXT.retry }));
    await waitFor(() => expect(within(groupGrid()).queryByText(VIEW_ERRORS_TEXT.rowsStale)).toBeNull());
    const urls = network.urlsSince(start);
    console.log('[view-errors group-only retry]', JSON.stringify(urls));
    expect(urls.filter(url => ROUTES.query.test(url))).toHaveLength(1);
    expect(
      urls.filter(url => ROUTES.rebuild.test(url)),
      'no rebuild again'
    ).toHaveLength(0);
    expect(
      urls.filter(url => ROUTES.facets.test(url)),
      'no facets read again'
    ).toHaveLength(0);
  });

  it('gates the reads after an Undo whose rebuild fails, and recovers rebuilds-first without a second revert', async () => {
    const state = { rebuildFails: false };
    const { network } = await mountPage(
      defaultRoutes({
        preview: () => jsonResponse(INFO_PLAN),
        rebuildSummary: () => (state.rebuildFails ? jsonResponse({ error: REBUILD_FAILURE_MESSAGE }, 500) : jsonResponse({ success: true }))
      })
    );
    await saveRowThroughGrid(GROUP_LABEL, 102, { measuredDBH: 12 });
    const undoButton = await screen.findByTestId('undo-toast-undo');
    await waitFor(() => expect(undoButton).toBeEnabled());
    state.rebuildFails = true;
    await userEvent.click(undoButton);
    expect(await screen.findByText(VIEW_ERRORS_TEXT.totalsStale)).toBeInTheDocument();
    state.rebuildFails = false;
    const start = network.requests.length;
    await userEvent.click(screen.getByRole('button', { name: VIEW_ERRORS_TEXT.retryRefresh }));
    await waitFor(() => expect(screen.queryByText(VIEW_ERRORS_TEXT.totalsStale)).toBeNull());
    const urls = network.urlsSince(start);
    console.log('[view-errors undo recovery order]', JSON.stringify(urls));
    const firstRead = urls.findIndex(isReadRequest);
    expect(urls.filter(url => ROUTES.rebuild.test(url))).toHaveLength(2);
    expect(urls.findIndex(url => ROUTES.rebuild.test(url))).toBeLessThan(firstRead);
    expect(
      urls.some(url => ROUTES.revert.test(url)),
      'the revert is never re-sent'
    ).toBe(false);
  });

  it("does not let census A's pending rebuild gate census B, and gates A again when the user returns", async () => {
    const { network, rerender } = await saveWithFailingRebuild();
    const beforeB = network.bodiesFor(ROUTES.facets).length;
    await changeCensus(OTHER_CENSUS_IDS, rerender);
    await waitFor(() => expect(network.bodiesFor(ROUTES.facets).length, 'census B reads freely').toBeGreaterThan(beforeB));
    await waitFor(() => expect(screen.queryByText(VIEW_ERRORS_TEXT.totalsStale)).toBeNull());
    expect(screen.queryByRole('button', { name: VIEW_ERRORS_TEXT.retryRefresh }), 'no Retry refresh for a census with nothing pending').toBeNull();
    expect(network.bodiesFor(ROUTES.facets).at(-1)?.censusIDs).toEqual(OTHER_CENSUS_IDS);

    await changeCensus([FIRST_CENSUS_ID, SECOND_CENSUS_ID], rerender);
    const afterReturn = network.requests.length;
    expect(await screen.findByRole('button', { name: VIEW_ERRORS_TEXT.retryRefresh })).toBeInTheDocument();
    await act(async () => undefined);
    const urls = network.urlsSince(afterReturn);
    console.log('[view-errors return to gated census]', JSON.stringify(urls));
    expect(urls.filter(isReadRequest), 'the gate holds again for census A').toHaveLength(0);
  });
});

describe('Per-unit load state', () => {
  it("shows one group's failure only in that group and keeps it when another group later loads", async () => {
    const other = ownFacet('3', UNMAPPED_MESSAGE, ['measuredHOM']);
    const { network } = await mountPage(
      defaultRoutes({
        facets: () => jsonResponse(facetsResponse([VALIDATION_FACET, other], { errorTypeCount: 2 })),
        query: request => {
          const code = (request.body?.errorType as { code?: string } | undefined)?.code;
          if (code === VALIDATION_FACET.code) return jsonResponse({ error: 'Query exploded' }, 500);
          return jsonResponse({ rows: [explorerRow(301)], totalRows: 1 });
        }
      }),
      { awaitRows: false }
    );
    const failedGroup = await screen.findByTestId(groupGridTestID(VALIDATION_FACET));
    expect(await within(failedGroup).findByText(VIEW_ERRORS_TEXT.rowsLoadFailed)).toBeInTheDocument();
    expect(within(failedGroup).getByRole('button', { name: VIEW_ERRORS_TEXT.retry })).toBeInTheDocument();

    await expandGroup(UNMAPPED_MESSAGE, `${UNMAPPED_MESSAGE} rows`);
    await waitFor(() => expect(requireGrid(`${UNMAPPED_MESSAGE} rows`).rows).toHaveLength(1));
    const healthyGroup = screen.getByTestId(groupGridTestID(other));
    console.log(
      '[view-errors per-unit]',
      JSON.stringify({
        failed: failedGroup.textContent?.includes(VIEW_ERRORS_TEXT.rowsLoadFailed),
        healthy: healthyGroup.textContent?.includes(VIEW_ERRORS_TEXT.rowsLoadFailed),
        queries: network.bodiesFor(ROUTES.query).length
      })
    );
    expect(within(healthyGroup).queryByText(VIEW_ERRORS_TEXT.rowsLoadFailed)).toBeNull();
    expect(
      within(screen.getByTestId(groupGridTestID(VALIDATION_FACET))).getByText(VIEW_ERRORS_TEXT.rowsLoadFailed),
      "the other group's success does not clear it"
    ).toBeInTheDocument();
  });

  it('shows a dash in every tile, never a 0, when the facets request fails', async () => {
    await mountPage(defaultRoutes({ facets: () => jsonResponse({ error: 'Facets exploded' }, 500) }), { awaitGroupGrid: false });
    expect(await screen.findByText(VIEW_ERRORS_TEXT.totalsLoadFailed)).toBeInTheDocument();
    const tiles = ['affected', 'validation', 'failed', 'contradictions'].map(name => screen.getByTestId(`errors-tile-${name}`));
    console.log('[view-errors facets failed tiles]', JSON.stringify(tiles.map(tile => tile.textContent)));
    tiles.forEach(tile => {
      expect(within(tile).getByText(VIEW_ERRORS_TEXT.unavailable)).toBeInTheDocument();
      expect(tile.textContent).not.toMatch(/\b0\b/);
    });
  });

  it('shows spinners, never a 0, while the first facets request is outstanding', async () => {
    const firstFacets = deferred<Response>();
    await mountPage(defaultRoutes({ facets: () => firstFacets.promise }), { awaitGroupGrid: false });
    const tiles = ['affected', 'validation', 'failed', 'contradictions'].map(name => screen.getByTestId(`errors-tile-${name}`));
    console.log('[view-errors first load tiles]', JSON.stringify(tiles.map(tile => tile.textContent)), screen.getAllByRole('progressbar').length);
    tiles.forEach(tile => {
      expect(within(tile).getByRole('progressbar')).toBeInTheDocument();
      expect(tile.textContent).not.toMatch(/\d/);
    });
    expect(screen.getByTestId('errors-explorer-facts').textContent).not.toMatch(/\d/);
    await act(async () => firstFacets.resolve(jsonResponse(facetsResponse([VALIDATION_FACET]))));
    expect(await within(screen.getByTestId('errors-tile-affected')).findByText('1')).toBeInTheDocument();
  });
});

describe('Obsolete responses', () => {
  it('keeps the newer search facets when the older response arrives last', async () => {
    const olderFacets = deferred<Response>();
    const newerFacet = ownFacet('88', 'Only the newer search has this');
    const olderFacet = ownFacet('89', 'Only the older search has this');
    const { network } = await mountPage(
      defaultRoutes({
        facets: request => {
          const quickSearch = (request.body?.filters as { quickSearch?: string } | undefined)?.quickSearch ?? '';
          if (quickSearch === 'a') return olderFacets.promise;
          if (quickSearch === 'ab') return jsonResponse(facetsResponse([newerFacet]));
          return jsonResponse(facetsResponse([VALIDATION_FACET, FALLBACK_FACET]));
        }
      })
    );
    const search = screen.getByRole('textbox', { name: VIEW_ERRORS_TEXT.searchLabel });
    await userEvent.type(search, 'a');
    await waitFor(() => expect(network.bodiesFor(ROUTES.facets).some(body => (body?.filters as { quickSearch?: string }).quickSearch === 'a')).toBe(true));
    await userEvent.type(search, 'b');
    expect(await screen.findByText(/Only the newer search has this/)).toBeInTheDocument();
    const olderRequest = network.requests.find(
      request => ROUTES.facets.test(request.url) && (request.body?.filters as { quickSearch?: string }).quickSearch === 'a'
    );
    await act(async () => olderFacets.resolve(jsonResponse(facetsResponse([olderFacet]))));
    console.log('[view-errors obsolete facets]', JSON.stringify({ headings: groupHeadingTexts(), olderAborted: olderRequest?.signal?.aborted }));
    expect(screen.queryByText(/Only the older search has this/), 'the older response never replaces the newer facets').toBeNull();
    expect(screen.getByText(/Only the newer search has this/)).toBeInTheDocument();
    expect(olderRequest?.signal?.aborted, 'the older request was aborted').toBe(true);
  });

  it('aborts the request of a group that is collapsed while it loads', async () => {
    const { network } = await mountPage(defaultRoutes({ query: () => new Promise<Response>(() => undefined) }), { awaitRows: false });
    const groupQuery = network.requests.find(request => ROUTES.query.test(request.url));
    expect(groupQuery?.signal?.aborted, 'still loading, not aborted').toBe(false);
    await userEvent.click(within(groupHeading('Different species')).getByRole('button'));
    await waitFor(() => expect(groupQuery?.signal?.aborted).toBe(true));
    console.log('[view-errors collapse aborts]', groupQuery?.signal?.aborted, JSON.stringify([...capturedGrids.keys()]));
    expect(capturedGrids.has(GROUP_LABEL)).toBe(false);
  });
});

describe('Save outcomes', () => {
  it('reports a failed save with its own message and offers no Undo', async () => {
    const { network } = await mountPage(defaultRoutes({ preview: () => jsonResponse(INFO_PLAN), apply: () => jsonResponse({ error: 'Apply exploded' }, 500) }));
    const outcome = (await saveAndReportFailure(GROUP_LABEL, 102, { measuredDBH: 12 })) as Error;
    const alert = await screen.findByTestId('errors-explorer-page-alert');
    console.log('[view-errors save failed]', outcome?.message, alert.textContent);
    expect(outcome).toBeInstanceOf(Error);
    expect(alert.textContent).toContain(VIEW_ERRORS_ALERTS.saveFailed('').trim());
    expect(alert.textContent).not.toContain('Row saved');
    expect(screen.queryByTestId(/^undo-toast-\d+$/)).toBeNull();
    expect(network.bodiesFor(ROUTES.rebuild), 'nothing was saved, so nothing is rebuilt').toHaveLength(0);
  });

  it('reports a saved row whose rebuild failed with its own message, and keeps the Undo toast', async () => {
    await mountPage(defaultRoutes({ preview: () => jsonResponse(INFO_PLAN), rebuildSummary: () => jsonResponse({ error: REBUILD_FAILURE_MESSAGE }, 500) }));
    await saveRowThroughGrid(GROUP_LABEL, 102, { measuredDBH: 12 });
    const alert = await screen.findByTestId('errors-explorer-page-alert');
    console.log('[view-errors saved rebuild failed]', alert.textContent, screen.queryByTestId('undo-toast-900') !== null);
    expect(alert).toHaveTextContent(VIEW_ERRORS_ALERTS.savedButRefreshFailed(REBUILD_FAILURE_MESSAGE));
    expect(screen.getByTestId('undo-toast-900'), 'a committed save stays undoable').toBeInTheDocument();
  });

  it('marks only the group whose refresh failed after a saved row, with no page alert, and keeps the Undo toast', async () => {
    const state = { queryFails: false };
    await mountPage(
      defaultRoutes({
        preview: () => jsonResponse(INFO_PLAN),
        query: request => {
          if (state.queryFails) return jsonResponse({ error: 'Query exploded' }, 500);
          const rows = rowsFor((request.body?.errorType as { code?: string } | undefined)?.code);
          return jsonResponse({ rows, totalRows: rows.length });
        }
      })
    );
    state.queryFails = true;
    await saveRowThroughGrid(GROUP_LABEL, 102, { measuredDBH: 12 });
    const group = screen.getByTestId(groupGridTestID(VALIDATION_FACET));
    expect(await within(group).findByText(VIEW_ERRORS_TEXT.rowsStale)).toBeInTheDocument();
    console.log('[view-errors saved group refresh failed]', screen.queryByTestId('errors-explorer-page-alert')?.textContent ?? '(no page alert)');
    expect(screen.queryByTestId('errors-explorer-page-alert'), 'the save and its rebuilds succeeded').toBeNull();
    expect(screen.queryByText(VIEW_ERRORS_TEXT.totalsStale), 'the totals refreshed fine').toBeNull();
    expect(screen.getByTestId('undo-toast-900')).toBeInTheDocument();
  });
});

describe('Scopes of a second-census row', () => {
  it('carries the row census through preview, apply and revert, the row id through both rebuilds, and every census through the reads', async () => {
    const { network } = await mountPage(defaultRoutes({ preview: () => jsonResponse(INFO_PLAN) }));
    const beforeSave = network.requests.length;
    await saveRowThroughGrid(GROUP_LABEL, 102, { measuredDBH: 12 });
    const undoButton = await screen.findByTestId('undo-toast-undo');
    await waitFor(() => expect(undoButton).toBeEnabled());
    await waitFor(() => expect(network.urlsSince(beforeSave).filter(isReadRequest).length).toBeGreaterThanOrEqual(2));
    const afterSave = network.requests.slice(beforeSave);
    console.log(
      '[view-errors scopes save]',
      JSON.stringify(
        afterSave.map(request => ({
          url: request.url,
          censusID: request.body?.censusID,
          censusIDs: request.body?.censusIDs,
          coreMeasurementIDs: request.body?.coreMeasurementIDs
        }))
      )
    );
    expect(network.bodiesFor(ROUTES.preview)[0]).toMatchObject({ censusID: SECOND_CENSUS_ID, targetID: 102 });
    expect(network.bodiesFor(ROUTES.apply)[0]).toMatchObject({ censusID: SECOND_CENSUS_ID, targetID: 102 });
    expect(network.bodiesFor(ROUTES.rebuild)).toEqual([{ coreMeasurementIDs: [102] }, { coreMeasurementIDs: [102] }]);
    const reads = afterSave.filter(request => isReadRequest(request.url));
    expect(
      reads.every(request => JSON.stringify(request.body?.censusIDs) === JSON.stringify([FIRST_CENSUS_ID, SECOND_CENSUS_ID])),
      'every read after the save carries every census'
    ).toBe(true);

    const beforeUndo = network.requests.length;
    await userEvent.click(undoButton);
    await waitFor(() => expect(network.bodiesFor(ROUTES.revert)).toHaveLength(1));
    await waitFor(() => expect(network.urlsSince(beforeUndo).filter(isReadRequest).length).toBeGreaterThanOrEqual(2));
    const afterUndo = network.requests.slice(beforeUndo);
    console.log(
      '[view-errors scopes undo]',
      JSON.stringify(
        afterUndo.map(request => ({
          url: request.url,
          censusID: request.body?.censusID,
          censusIDs: request.body?.censusIDs,
          coreMeasurementIDs: request.body?.coreMeasurementIDs
        }))
      )
    );
    expect(network.bodiesFor(ROUTES.revert)[0]).toMatchObject({ censusID: SECOND_CENSUS_ID, editOperationID: 900 });
    expect(network.bodiesFor(ROUTES.rebuild).slice(2)).toEqual([{ coreMeasurementIDs: [102] }, { coreMeasurementIDs: [102] }]);
    expect(
      afterUndo
        .filter(request => isReadRequest(request.url))
        .every(request => JSON.stringify(request.body?.censusIDs) === JSON.stringify([FIRST_CENSUS_ID, SECOND_CENSUS_ID]))
    ).toBe(true);
  });
});

describe('Restored filters', () => {
  async function mountWithStored(stored: string) {
    storage.set(STORAGE_KEY, stored);
    const mounted = await mountPage(defaultRoutes(), { awaitGroupGrid: false });
    await waitFor(() => expect(mounted.network.bodiesFor(ROUTES.facets).length).toBeGreaterThan(0));
    await act(async () => undefined);
    return mounted;
  }

  it.each([
    ['a string page', JSON.stringify({ page: '2', source: 'validation', quickSearch: 123 })],
    ['a 500-item message array', JSON.stringify({ source: 'validation', exactMessages: Array.from({ length: 500 }, (_unused, index) => `message ${index}`) })],
    ['an unknown source', JSON.stringify({ source: 'bogus', quickSearch: 'kept?' })],
    ['text that is not JSON', 'not json at all']
  ])('restores the defaults for %s', async (_label, stored) => {
    const { network } = await mountWithStored(stored);
    const filters = network.bodiesFor(ROUTES.facets).at(-1)?.filters;
    console.log('[view-errors restore invalid]', stored.slice(0, 60), JSON.stringify(filters));
    expect(filters).toMatchObject({ source: 'all', contradictionOnly: false, quickSearch: '', exactMessages: [] });
  });

  it('restores the four valid keys and drops the others', async () => {
    const { network } = await mountWithStored(
      JSON.stringify({
        source: 'validation',
        quickSearch: 'oak',
        exactMessages: [SHARED_MESSAGE],
        contradictionOnly: false,
        page: 3,
        affectedFields: ['measuredDBH'],
        presetId: 'validation_only'
      })
    );
    const filters = network.bodiesFor(ROUTES.facets).at(-1)?.filters;
    console.log('[view-errors restore valid]', JSON.stringify(filters));
    expect(filters).toEqual({
      source: 'validation',
      exactMessages: [SHARED_MESSAGE],
      affectedFields: [],
      contradictionOnly: false,
      contradictionTypes: [],
      quickSearch: 'oak'
    });
    expect(screen.getByRole('textbox', { name: VIEW_ERRORS_TEXT.searchLabel })).toHaveValue('oak');
  });

  it('restores validation with contradictionOnly as Show, Contradictions', async () => {
    const { network } = await mountWithStored(JSON.stringify({ source: 'validation', contradictionOnly: true }));
    const filters = network.bodiesFor(ROUTES.facets).at(-1)?.filters;
    console.log('[view-errors restore contradictions]', JSON.stringify(filters));
    expect(filters).toMatchObject({ source: 'all', contradictionOnly: true });
    expect(within(screen.getByRole('group', { name: VIEW_ERRORS_TEXT.showLabel })).getByRole('button', { name: /^Contradictions/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });
});
