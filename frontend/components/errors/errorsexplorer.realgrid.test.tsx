import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { PointerEventsCheckLevel } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DETAILS_SHEET_TEXT,
  EDIT_LOCK_TOOLTIPS,
  ERRORS_FLAT_GRID_PAGE_SIZE,
  VIEW_ERRORS_ALERTS,
  VIEW_ERRORS_TEXT,
  type ErrorExplorerRow,
  type ErrorTypeFacet
} from '@/config/errorsexplorer';
import { INFINITE_DEFAULT_CHUNK } from '@/components/datagrids/hooks/useinfinitegridrows';
import {
  explorerRow,
  facetOf,
  facetsResponse,
  FIRST_CENSUS_ID,
  installMemoryStorage,
  installPageFetch,
  jsonResponse,
  ROUTES,
  SECOND_CENSUS_ID,
  type FetchRoute,
  type RecordedRequest
} from '@/tests/fixtures/errorsexplorer/explorer-page';

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
vi.mock('@/ailogger', () => ({ default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), event: vi.fn() } }));

import ErrorsExplorer from './errorsexplorer';

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
const GROUP_LABEL = 'Different species rows';
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

function rowsFor(): ErrorExplorerRow[] {
  return [VALIDATION_ROW, SECOND_CENSUS_ROW];
}

function rowsQuery() {
  const rows = rowsFor();
  return jsonResponse({ rows, totalRows: rows.length });
}

function defaultRoutes(overrides: Partial<Record<keyof typeof ROUTES, FetchRoute['respond']>> = {}): FetchRoute[] {
  const respond: Record<keyof typeof ROUTES, FetchRoute['respond']> = {
    facets: () => jsonResponse(facetsResponse([VALIDATION_FACET], { affectedMeasurements: 2, errorTypeCount: 1 })),
    query: rowsQuery,
    details: request => {
      const id = Number(/details\/(\d+)/.exec(request.url)?.[1]);
      const row = [VALIDATION_ROW, SECOND_CENSUS_ROW].find(candidate => candidate.coreMeasurementID === id) ?? null;
      const allErrors = [{ source: 'validation', code: '14', message: 'Flagged;Different species', fields: ['speciesCode'], comparison: null }];
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

beforeEach(() => {
  page.userStatus = 'global';
  page.censusIDs = [FIRST_CENSUS_ID, SECOND_CENSUS_ID];
  page.search = '';
  page.censusList = [];
  installMemoryStorage();
});

afterEach(() => vi.unstubAllGlobals());

function PageWithSidebarStandIn() {
  const [, force] = React.useReducer((count: number) => count + 1, 0);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          page.censusIDs = SWITCHED_CENSUS_IDS;
          force();
        }}
      >
        Switch census (sidebar stand-in)
      </button>
      <ErrorsExplorer />
    </>
  );
}

const EDITED_FIELD = 'treeTag';
const EDITED_TAG = 'T-101-NEW';
const SIDEBAR_STAND_IN = 'Switch census (sidebar stand-in)';
const SWITCHED_CENSUS_IDS = [9];
const DRIFT_FACET: ErrorTypeFacet = {
  source: 'ingestion',
  code: 'COORDINATE_DRIFT',
  message: 'Stem coordinates drifted',
  fields: ['stemLocalX'],
  count: 1,
  hasContradiction: false
};
const DRIFT_LABEL = 'Stem coordinates drifted rows';
const FLAT_LABEL = VIEW_ERRORS_TEXT.flatGridLabel;
const GROUP_PAGE_SIZE = 10;
const FIRST_DRIFT_ROW_ID = 301;
const DRIFT_ROW_COUNT = 11;
const STAND_IN_SETTLE_MS = 50;
const GATE_QUIET_MS = 300;
// 11 rows: the group's footer starts with "Go to next page" enabled, so a disabled button after locking proves the lock.
const ELEVEN_ROWS = [
  VALIDATION_ROW,
  SECOND_CENSUS_ROW,
  ...Array.from({ length: 9 }, (_, index) =>
    explorerRow(103 + index, {
      errorCodes: ['14'],
      primaryErrorMessage: 'Flagged;Different species',
      errorMessages: ['Flagged;Different species'],
      errorFields: ['speciesCode']
    })
  )
];
const DRIFT_ROWS = Array.from({ length: DRIFT_ROW_COUNT }, (_, index) =>
  explorerRow(FIRST_DRIFT_ROW_ID + index, {
    errorSources: ['ingestion'],
    errorCodes: [DRIFT_FACET.code],
    primaryErrorMessage: DRIFT_FACET.message,
    errorMessages: [DRIFT_FACET.message],
    errorFields: DRIFT_FACET.fields
  })
);
const INFO_PLAN = { ...WARN_PLAN, maxSeverity: 'info' };

interface Held {
  resolvers: Array<() => void>;
  release: () => void;
}

/** Holds every matching response until release(); `respond` builds the real response at release time. */
function holdResponses(respond: FetchRoute['respond']): { route: FetchRoute['respond']; held: Held } {
  const held: Held = {
    resolvers: [],
    release: () => held.resolvers.splice(0).forEach(resolve => resolve())
  };
  const route: FetchRoute['respond'] = request =>
    new Promise<Response>(resolve => {
      held.resolvers.push(() => resolve(respond(request)));
    });
  return { route, held };
}

function pagedQuery(rows: ErrorExplorerRow[]): FetchRoute['respond'] {
  return request => {
    const pageIndex = Number(request.body?.page ?? 0);
    const pageSize = Number(request.body?.pageSize ?? GROUP_PAGE_SIZE);
    return jsonResponse({ rows: rows.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize), totalRows: rows.length });
  };
}

function driftOr(groupRows: FetchRoute['respond']): FetchRoute['respond'] {
  return request =>
    (request.body?.errorType as { code?: string } | undefined)?.code === DRIFT_FACET.code ? pagedQuery(DRIFT_ROWS)(request) : groupRows(request);
}

function actionsCell(grid: HTMLElement, rowID: number): HTMLElement {
  const found = grid.querySelector(`[data-id="${rowID}"] [data-field="actions"]`);
  if (!found)
    throw new Error(`No actions cell for row ${rowID}. Rows: ${Array.from(grid.querySelectorAll('[data-id]'), row => row.getAttribute('data-id')).join(',')}`);
  return found as HTMLElement;
}

function editedInput(grid: HTMLElement, rowID: number): HTMLInputElement | null {
  return grid.querySelector(`[data-id="${rowID}"] [data-field="${EDITED_FIELD}"] input`);
}

function rowAction(grid: HTMLElement, rowID: number, name: 'Edit' | 'Save' | 'Cancel' | 'Details'): HTMLElement {
  return within(actionsCell(grid, rowID)).getByRole('menuitem', { name });
}

async function startEdit(user: ReturnType<typeof userEvent.setup>, grid: HTMLElement, rowID: number) {
  await user.click(rowAction(grid, rowID, 'Edit'));
  await waitFor(() => expect(editedInput(grid, rowID), `row ${rowID} opened for edit`).not.toBeNull());
}

async function changeTagAndSave(user: ReturnType<typeof userEvent.setup>, grid: HTMLElement, rowID: number) {
  const input = editedInput(grid, rowID) as HTMLInputElement;
  await user.clear(input);
  await user.type(input, EDITED_TAG);
  await user.click(rowAction(grid, rowID, 'Save'));
}

function showButtons(): HTMLElement[] {
  return within(screen.getByRole('group', { name: VIEW_ERRORS_TEXT.showLabel })).getAllByRole('button');
}

function logLockState(topic: string, grid: HTMLElement, otherRowID: number) {
  const otherEdit = rowAction(grid, otherRowID, 'Edit');
  console.log(
    `[view-errors ${topic}]`,
    JSON.stringify({
      otherEditDisabled: otherEdit.getAttribute('aria-disabled'),
      otherEditTitle: otherEdit.getAttribute('title'),
      showDisabled: showButtons().map(button => (button as HTMLButtonElement).disabled)
    })
  );
}

async function chooseNoGrouping(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('combobox', { name: VIEW_ERRORS_TEXT.groupRowsLabel }));
  await user.click(await screen.findByRole('option', { name: VIEW_ERRORS_TEXT.noGrouping }));
}

/** customgridpagination.test.tsx's way into the ∞ option of the rows-per-page select. */
async function switchFlatGridToInfinite() {
  const sizeButtons = screen.getAllByLabelText('Rows per page');
  const sizeButton = sizeButtons[sizeButtons.length - 1];
  fireEvent.mouseDown(sizeButton);
  fireEvent.click(sizeButton);
  const options = await screen.findAllByRole('option');
  const infinite = options.find(option => option.textContent?.includes('∞'));
  if (!infinite) throw new Error(`No ∞ option. Options: ${options.map(option => option.textContent).join(', ')}`);
  fireEvent.click(infinite);
}

function readCensusIDs(requests: RecordedRequest[], start: number): string[] {
  return requests
    .slice(start)
    .filter(request => ROUTES.facets.test(request.url) || ROUTES.query.test(request.url))
    .map(request => JSON.stringify(request.body?.censusIDs));
}

/** The grid element appears before its first read lands, so wait for a data row too. */
async function findLoadedGrid(name: string): Promise<HTMLElement> {
  const grid = await screen.findByRole('grid', { name });
  await waitFor(() => expect(grid.querySelector('[role="row"][data-id]'), `${name}: first rows rendered`).not.toBeNull());
  return grid;
}

const UNMOUNT_SETTLE_MS = 400;

/** A real fetch rejects with an AbortError when its signal aborts; a response that never settles hides every `.catch` downstream. */
const rejectOnAbort: FetchRoute['respond'] = request =>
  new Promise<Response>((_, reject) => {
    request.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
  });

/** After a census change the page the user lands on must accept an edit and its page controls must work. */
async function expectNewCensusUnlocked() {
  const newGrid = await findLoadedGrid(GROUP_LABEL);
  await act(async () => new Promise(resolve => setTimeout(resolve, UNMOUNT_SETTLE_MS)));
  const showDisabled = showButtons().map(button => (button as HTMLButtonElement).disabled);
  const editState = rowAction(newGrid, 101, 'Edit').getAttribute('aria-disabled');
  console.log('[view-errors new census controls]', JSON.stringify({ showDisabled, editState }));
  expect(showDisabled.some(Boolean), 'Show is enabled in the new census').toBe(false);
  expect(screen.getByRole('textbox', { name: VIEW_ERRORS_TEXT.searchLabel })).toBeEnabled();
  expect(editState, 'Edit is offered in the new census').not.toBe('true');
}

function groupFooter(grid: HTMLElement): HTMLElement {
  return grid.closest('[data-testid^="errors-grid-"]')?.querySelector('[data-testid="custom-grid-pagination"]') as HTMLElement;
}

function groupToggle(headingName: RegExp): HTMLElement {
  return within(screen.getByRole('heading', { level: 2, name: headingName })).getByRole('button');
}

describe('the page edit lock with the real grid (D-g, D-i, P2-4, P2-8, P2-13)', () => {
  it('disables every control that would remove the edited row, with its tooltip, and leaves the sidebar enabled (D-g, D-i)', async () => {
    const user = userEvent.setup();
    installPageFetch(defaultRoutes({ preview: () => new Promise(() => undefined), query: pagedQuery(ELEVEN_ROWS) }));
    render(<PageWithSidebarStandIn />);
    const grid = await findLoadedGrid(GROUP_LABEL);
    await waitFor(() => expect(within(groupFooter(grid)).getByRole('button', { name: 'Go to next page' }), '11 rows: two pages before the lock').toBeEnabled());
    await startEdit(user, grid, 101);
    const toggle = within(screen.getAllByRole('heading', { level: 2 })[0]).getByRole('button');
    const disabledControls = [
      toggle,
      showButtons()[1],
      screen.getByRole('textbox', { name: VIEW_ERRORS_TEXT.searchLabel }),
      within(groupFooter(grid)).getByRole('button', { name: 'Go to next page' })
    ];
    for (const control of disabledControls) expect(control, control.outerHTML.slice(0, 80)).toBeDisabled();
    expect(groupFooter(grid)).toHaveAttribute('title', EDIT_LOCK_TOOLTIPS.editing);
    await user.hover(toggle.parentElement as HTMLElement);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(EDIT_LOCK_TOOLTIPS.editing);
    await user.unhover(toggle.parentElement as HTMLElement);
    const otherDetails = rowAction(grid, 102, 'Details');
    expect(otherDetails).toHaveAttribute('aria-disabled', 'true');
    expect(otherDetails).toHaveAttribute('title', EDIT_LOCK_TOOLTIPS.editing);
    expect(screen.getByRole('button', { name: SIDEBAR_STAND_IN })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: SIDEBAR_STAND_IN }));
    expect(await screen.findByText(VIEW_ERRORS_ALERTS.editDiscardedByCensusChange('T-101', 'S-1'))).toBeInTheDocument();
  });

  it('holds the lock while the preview never answers: other rows, Show and Search stay disabled and nothing is applied', async () => {
    const user = userEvent.setup();
    const network = installPageFetch(defaultRoutes({ preview: () => new Promise(() => undefined) }));
    render(<PageWithSidebarStandIn />);
    const grid = await findLoadedGrid(GROUP_LABEL);
    await startEdit(user, grid, 101);
    await changeTagAndSave(user, grid, 101);
    await waitFor(() => expect(network.bodiesFor(ROUTES.preview)).toHaveLength(1));
    logLockState('preview pending', grid, 102);
    expect(rowAction(grid, 102, 'Edit')).toHaveAttribute('aria-disabled', 'true');
    expect(rowAction(grid, 102, 'Edit')).toHaveAttribute('title', EDIT_LOCK_TOOLTIPS.saving);
    for (const button of showButtons()) expect(button).toBeDisabled();
    expect(screen.getByRole('textbox', { name: VIEW_ERRORS_TEXT.searchLabel })).toBeDisabled();
    expect(network.bodiesFor(ROUTES.apply)).toHaveLength(0);
  });

  it('reopens the row and keeps the lock when the preview is rejected', async () => {
    const user = userEvent.setup();
    const network = installPageFetch(defaultRoutes({ preview: () => new Response('species not found', { status: 422 }) }));
    render(<PageWithSidebarStandIn />);
    const grid = await findLoadedGrid(GROUP_LABEL);
    await startEdit(user, grid, 101);
    await changeTagAndSave(user, grid, 101);
    expect(await screen.findByText(VIEW_ERRORS_ALERTS.saveFailed('species not found'))).toBeInTheDocument();
    logLockState('preview rejected', grid, 102);
    expect(editedInput(grid, 101), 'MUI reopened the row').not.toBeNull();
    expect(editedInput(grid, 101)?.value, 'the typed value is kept').toBe(EDITED_TAG);
    expect(rowAction(grid, 102, 'Edit')).toHaveAttribute('title', EDIT_LOCK_TOOLTIPS.editing);
    expect(network.bodiesFor(ROUTES.apply)).toHaveLength(0);
  });

  it("reopens the row and keeps the lock when the dialog's Cancel is pressed", async () => {
    const user = userEvent.setup();
    const network = installPageFetch(defaultRoutes());
    render(<PageWithSidebarStandIn />);
    const grid = await findLoadedGrid(GROUP_LABEL);
    await startEdit(user, grid, 101);
    await changeTagAndSave(user, grid, 101);
    await user.click(await screen.findByTestId('edit-preview-cancel'));
    await waitFor(() => expect(screen.queryByTestId('edit-preview-apply')).toBeNull());
    logLockState('dialog cancel', grid, 102);
    expect(editedInput(grid, 101), 'MUI reopened the row').not.toBeNull();
    expect(rowAction(grid, 102, 'Edit')).toHaveAttribute('title', EDIT_LOCK_TOOLTIPS.editing);
    expect(screen.queryByText(/Couldn't save the row/), 'a dialog cancel is not a failure').toBeNull();
    expect(network.bodiesFor(ROUTES.apply)).toHaveLength(0);
  });

  it("releases the lock when the row's Cancel is pressed", async () => {
    const user = userEvent.setup();
    const network = installPageFetch(defaultRoutes());
    render(<PageWithSidebarStandIn />);
    const grid = await findLoadedGrid(GROUP_LABEL);
    await startEdit(user, grid, 101);
    await user.click(rowAction(grid, 101, 'Cancel'));
    await waitFor(() => expect(editedInput(grid, 101)).toBeNull());
    logLockState('row cancel', grid, 102);
    expect(rowAction(grid, 102, 'Edit')).not.toHaveAttribute('aria-disabled', 'true');
    for (const button of showButtons()) expect(button).toBeEnabled();
    expect(network.bodiesFor(ROUTES.preview)).toHaveLength(0);
  });

  it('keeps the lock after a successful save until every read has settled', async () => {
    const user = userEvent.setup();
    const heldQuery = holdResponses(() => rowsQuery());
    let holdReads = false;
    const network = installPageFetch(
      defaultRoutes({ preview: () => jsonResponse(INFO_PLAN), query: request => (holdReads ? heldQuery.route(request) : rowsQuery()) })
    );
    render(<PageWithSidebarStandIn />);
    const grid = await findLoadedGrid(GROUP_LABEL);
    await startEdit(user, grid, 101);
    holdReads = true;
    await changeTagAndSave(user, grid, 101);
    await waitFor(() => expect(heldQuery.held.resolvers.length).toBeGreaterThan(0));
    expect(network.bodiesFor(ROUTES.apply)).toHaveLength(1);
    expect(network.bodiesFor(ROUTES.rebuild)).toHaveLength(2);
    logLockState('reads pending', grid, 102);
    expect(rowAction(grid, 102, 'Edit'), 'refreshing still blocks other edits').toHaveAttribute('title', EDIT_LOCK_TOOLTIPS.saving);
    for (const button of showButtons()) expect(button).toBeDisabled();
    expect(screen.getByTestId('undo-toast-undo'), 'Undo is free while refreshing (D-i)').toBeEnabled();
    holdReads = false;
    await act(async () => heldQuery.held.release());
    await waitFor(() => expect(showButtons()[0]).toBeEnabled());
    logLockState('reads settled', grid, 102);
    expect(rowAction(grid, 102, 'Edit')).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('holds the lock until both rebuilds settle when one fails at once (P3-2)', async () => {
    const user = userEvent.setup();
    const heldFullTable = holdResponses(() => jsonResponse({ success: true }));
    installPageFetch(
      defaultRoutes({
        preview: () => jsonResponse(INFO_PLAN),
        rebuildSummary: () => jsonResponse({ error: 'Lock wait timeout exceeded' }, 500),
        rebuildFullTable: heldFullTable.route
      })
    );
    render(<PageWithSidebarStandIn />);
    const grid = await findLoadedGrid(GROUP_LABEL);
    await startEdit(user, grid, 101);
    await changeTagAndSave(user, grid, 101);
    await waitFor(() => expect(heldFullTable.held.resolvers).toHaveLength(1));
    await act(async () => new Promise(resolve => setTimeout(resolve, STAND_IN_SETTLE_MS)));
    logLockState('one rebuild failed, one running', grid, 102);
    expect(rowAction(grid, 102, 'Edit'), 'no new edit while viewfulltable still rebuilds').toHaveAttribute('aria-disabled', 'true');
    expect(screen.queryByRole('button', { name: VIEW_ERRORS_TEXT.retryRefresh }), 'no Retry refresh before both settle').toBeNull();
    await act(async () => heldFullTable.held.release());
    expect(await screen.findByText(VIEW_ERRORS_ALERTS.savedButRefreshFailed('Lock wait timeout exceeded'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: VIEW_ERRORS_TEXT.retryRefresh })).toBeInTheDocument();
    expect(rowAction(grid, 102, 'Edit')).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('lets one measurement listed in two groups be edited from either group, one at a time', async () => {
    const user = userEvent.setup();
    installPageFetch(
      defaultRoutes({
        facets: () => jsonResponse(facetsResponse([VALIDATION_FACET, DRIFT_FACET], { affectedMeasurements: 2, errorTypeCount: 2, ingestion: 1 })),
        query: request =>
          (request.body?.errorType as { code?: string } | undefined)?.code === DRIFT_FACET.code
            ? jsonResponse({ rows: [VALIDATION_ROW], totalRows: 1 })
            : rowsQuery()
      })
    );
    render(<PageWithSidebarStandIn />);
    const groupA = await findLoadedGrid(GROUP_LABEL);
    await user.click(groupToggle(/Stem coordinates drifted/));
    const groupB = await screen.findByRole('grid', { name: DRIFT_LABEL });
    await startEdit(user, groupA, 101);
    console.log('[view-errors two groups]', JSON.stringify({ editInB: rowAction(groupB, 101, 'Edit').getAttribute('aria-disabled') }));
    expect(rowAction(groupB, 101, 'Edit'), 'the same measurement in the other group').toHaveAttribute('aria-disabled', 'true');
    fireEvent.doubleClick(groupB.querySelector(`[data-id="101"] [data-field="${EDITED_FIELD}"]`) as HTMLElement);
    expect(editedInput(groupB, 101), 'double-click in the other group opens nothing').toBeNull();
    await user.click(rowAction(groupA, 101, 'Cancel'));
    await waitFor(() => expect(editedInput(groupA, 101)).toBeNull());
    await startEdit(user, groupB, 101);
    expect(rowAction(groupA, 101, 'Edit'), 'and the other way round').toHaveAttribute('aria-disabled', 'true');
    expect(editedInput(groupA, 101)).toBeNull();
  });

  it("refuses edit entry while a Clear's read refresh is outstanding (P2-3)", async () => {
    const user = userEvent.setup();
    const heldQuery = holdResponses(() => rowsQuery());
    let holdReads = false;
    const network = installPageFetch(defaultRoutes({ query: request => (holdReads ? heldQuery.route(request) : rowsQuery()) }));
    render(<PageWithSidebarStandIn />);
    const grid = await findLoadedGrid(GROUP_LABEL);
    await user.click(rowAction(grid, 102, 'Details'));
    const clear = await screen.findByRole('button', { name: DETAILS_SHEET_TEXT.clearValidationErrors });
    holdReads = true;
    await user.click(clear);
    await waitFor(() => expect(heldQuery.held.resolvers.length).toBeGreaterThan(0));
    await user.click(screen.getByRole('button', { name: DETAILS_SHEET_TEXT.closeDetails }));
    logLockState('clear refresh pending', grid, 101);
    expect(network.bodiesFor(ROUTES.clear)).toHaveLength(1);
    expect(rowAction(grid, 101, 'Edit')).toHaveAttribute('aria-disabled', 'true');
    expect(rowAction(grid, 101, 'Edit')).toHaveAttribute('title', EDIT_LOCK_TOOLTIPS.saving);
    fireEvent.doubleClick(grid.querySelector(`[data-id="101"] [data-field="${EDITED_FIELD}"]`) as HTMLElement);
    expect(editedInput(grid, 101), 'no edit starts that the refresh would remove').toBeNull();
    holdReads = false;
    await act(async () => heldQuery.held.release());
    await waitFor(() => expect(rowAction(grid, 101, 'Edit')).not.toHaveAttribute('aria-disabled', 'true'));
    await startEdit(user, grid, 101);
  });

  it('removes a saved row from its group once the refresh no longer lists it', async () => {
    const user = userEvent.setup();
    let applied = false;
    const network = installPageFetch(
      defaultRoutes({
        preview: () => jsonResponse(INFO_PLAN),
        apply: () => {
          applied = true;
          return jsonResponse(APPLY_RESULT);
        },
        query: () => {
          const rows = applied ? [SECOND_CENSUS_ROW] : rowsFor();
          return jsonResponse({ rows, totalRows: rows.length });
        }
      })
    );
    render(<PageWithSidebarStandIn />);
    const grid = await findLoadedGrid(GROUP_LABEL);
    await startEdit(user, grid, 101);
    await changeTagAndSave(user, grid, 101);
    await waitFor(() => expect(network.bodiesFor(ROUTES.apply)).toHaveLength(1));
    await waitFor(() => expect(grid.querySelector('[data-id="101"]'), 'row 101 left the group after the refresh').toBeNull());
    console.log('[view-errors removal]', JSON.stringify(Array.from(grid.querySelectorAll('[data-id]'), row => row.getAttribute('data-id'))));
    expect(grid.querySelector('[data-id="102"]'), 'the other row stays').not.toBeNull();
  });

  it("disables the Filtered-to chip's remove icon with the tooltip while a row is open", async () => {
    // Joy's Chip end decorator sets pointer-events: none, which the tooltip's wrapper span inherits.
    const user = userEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never });
    page.search = 'message=Flagged%3BDifferent%20species';
    installPageFetch(defaultRoutes());
    render(<PageWithSidebarStandIn />);
    const grid = await findLoadedGrid(GROUP_LABEL);
    expect(screen.getByRole('button', { name: VIEW_ERRORS_TEXT.removeFilter }), 'the chip is removable before the lock').toBeEnabled();
    await startEdit(user, grid, 101);
    const removeFilter = screen.getByRole('button', { name: VIEW_ERRORS_TEXT.removeFilter });
    expect(removeFilter).toBeDisabled();
    await user.hover(removeFilter.parentElement as HTMLElement);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(EDIT_LOCK_TOOLTIPS.editing);
  });

  it("disables an earlier save's Undo with the tooltip while another row is open", async () => {
    const user = userEvent.setup();
    const network = installPageFetch(defaultRoutes({ preview: () => jsonResponse(INFO_PLAN) }));
    render(<PageWithSidebarStandIn />);
    const grid = await findLoadedGrid(GROUP_LABEL);
    await startEdit(user, grid, 102);
    await changeTagAndSave(user, grid, 102);
    await waitFor(() => expect(network.bodiesFor(ROUTES.rebuild)).toHaveLength(2));
    await waitFor(() => expect(rowAction(grid, 101, 'Edit')).not.toHaveAttribute('aria-disabled', 'true'));
    expect(screen.getByTestId('undo-toast-undo'), 'Undo is free before another row opens').toBeEnabled();
    await startEdit(user, grid, 101);
    const undo = screen.getByTestId('undo-toast-undo');
    console.log('[view-errors undo lock]', JSON.stringify({ undoDisabled: (undo as HTMLButtonElement).disabled }));
    expect(undo).toBeDisabled();
    await user.hover(undo.parentElement as HTMLElement);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(EDIT_LOCK_TOOLTIPS.editing);
  });

  it("lets another group expand, page and sort, and the edited row's own Details open, while a row is locked", async () => {
    const user = userEvent.setup();
    const network = installPageFetch(
      defaultRoutes({
        facets: () => jsonResponse(facetsResponse([VALIDATION_FACET, DRIFT_FACET], { affectedMeasurements: 13, errorTypeCount: 2, ingestion: 11 })),
        query: driftOr(rowsQuery)
      })
    );
    render(<PageWithSidebarStandIn />);
    const grid = await findLoadedGrid(GROUP_LABEL);
    await startEdit(user, grid, 101);
    expect(groupToggle(/Stem coordinates drifted/), 'another group still expands').toBeEnabled();
    await user.click(groupToggle(/Stem coordinates drifted/));
    const driftGrid = await screen.findByRole('grid', { name: DRIFT_LABEL });
    await waitFor(() => expect(driftGrid.querySelector(`[data-id="${FIRST_DRIFT_ROW_ID}"]`)).not.toBeNull());
    const next = within(groupFooter(driftGrid)).getByRole('button', { name: 'Go to next page' });
    expect(next, 'another group still pages').toBeEnabled();
    await user.click(next);
    await waitFor(() =>
      expect(driftGrid.querySelector(`[data-id="${FIRST_DRIFT_ROW_ID + GROUP_PAGE_SIZE}"]`), 'the second page of the other group').not.toBeNull()
    );
    const queriesBeforeSort = network.bodiesFor(ROUTES.query).length;
    await user.click(within(driftGrid).getByRole('columnheader', { name: /Tree Tag/ }));
    await waitFor(() => expect(network.bodiesFor(ROUTES.query).length).toBeGreaterThan(queriesBeforeSort));
    const sortedQuery = network.bodiesFor(ROUTES.query).at(-1);
    console.log('[view-errors other group sort]', JSON.stringify(sortedQuery));
    expect(sortedQuery?.sortModel, "the other group's sort goes out").toEqual([{ field: 'treeTag', sort: 'asc' }]);
    expect(editedInput(grid, 101), 'the edit stays open').not.toBeNull();
    await user.click(rowAction(grid, 101, 'Details'));
    expect(await screen.findByTestId('error-row-details-sheet'), "the edited row's own Details opens").toBeInTheDocument();
  });
});

describe('a census change during an edit (P2-4, P2-8, A4)', () => {
  it('discards an open row with the page notice', async () => {
    const user = userEvent.setup();
    const network = installPageFetch(defaultRoutes());
    render(<PageWithSidebarStandIn />);
    const grid = await findLoadedGrid(GROUP_LABEL);
    await startEdit(user, grid, 101);
    await user.click(screen.getByRole('button', { name: SIDEBAR_STAND_IN }));
    expect(await screen.findByText(VIEW_ERRORS_ALERTS.editDiscardedByCensusChange('T-101', 'S-1'))).toBeInTheDocument();
    expect(network.bodiesFor(ROUTES.preview)).toHaveLength(0);
  });

  it('aborts a preview in flight: no dialog, no apply, the not-saved notice, and the new census is not left locked', async () => {
    const user = userEvent.setup();
    const network = installPageFetch(defaultRoutes({ preview: rejectOnAbort }));
    render(<PageWithSidebarStandIn />);
    const grid = await findLoadedGrid(GROUP_LABEL);
    await startEdit(user, grid, 101);
    await changeTagAndSave(user, grid, 101);
    await waitFor(() => expect(network.bodiesFor(ROUTES.preview)).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: SIDEBAR_STAND_IN }));
    expect(await screen.findByText(VIEW_ERRORS_ALERTS.editCancelledByCensusChange('T-101', 'S-1'))).toBeInTheDocument();
    const preview = network.requests.find(request => ROUTES.preview.test(request.url));
    console.log('[view-errors census change preview]', JSON.stringify({ aborted: preview?.signal?.aborted }));
    expect(preview?.signal?.aborted, 'the preview request is aborted').toBe(true);
    expect(screen.queryByTestId('edit-preview-apply')).toBeNull();
    expect(network.bodiesFor(ROUTES.apply)).toHaveLength(0);
    await expectNewCensusUnlocked();
  });

  it('does not lock the new census when a detached apply fails after the census change, and keeps the not-saved notice', async () => {
    const user = userEvent.setup();
    const failingApply = holdResponses(() => jsonResponse({ error: 'apply exploded' }, 500));
    installPageFetch(defaultRoutes({ preview: () => jsonResponse(INFO_PLAN), apply: failingApply.route }));
    render(<PageWithSidebarStandIn />);
    const grid = await findLoadedGrid(GROUP_LABEL);
    await startEdit(user, grid, 101);
    await changeTagAndSave(user, grid, 101);
    await waitFor(() => expect(failingApply.held.resolvers).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: SIDEBAR_STAND_IN }));
    await act(async () => failingApply.held.release());
    await waitFor(() => expect(screen.queryByTestId('errors-explorer-page-alert')).not.toBeNull());
    await act(async () => new Promise(resolve => setTimeout(resolve, UNMOUNT_SETTLE_MS)));
    const alertText = screen.getByTestId('errors-explorer-page-alert').textContent;
    console.log('[view-errors detached apply failure]', alertText);
    expect(alertText, 'the not-saved notice is not overwritten by the generic save failure').toContain(
      VIEW_ERRORS_ALERTS.editCancelledByCensusChange('T-101', 'S-1')
    );
    await expectNewCensusUnlocked();
  });

  it('does not lock the page when the group of an open dialog leaves the facets, then the dialog is cancelled', async () => {
    const user = userEvent.setup();
    let dropGroup = false;
    let holdFacets = false;
    const heldFacets = holdResponses(() =>
      jsonResponse(facetsResponse(dropGroup ? [DRIFT_FACET] : [VALIDATION_FACET], { affectedMeasurements: 2, errorTypeCount: 1 }))
    );
    installPageFetch(
      defaultRoutes({
        facets: request =>
          holdFacets ? heldFacets.route(request) : jsonResponse(facetsResponse([VALIDATION_FACET], { affectedMeasurements: 2, errorTypeCount: 1 })),
        query: driftOr(rowsQuery)
      })
    );
    render(<PageWithSidebarStandIn />);
    const grid = await findLoadedGrid(GROUP_LABEL);
    holdFacets = true;
    fireEvent.change(screen.getByLabelText(VIEW_ERRORS_TEXT.searchLabel), { target: { value: 'T' } });
    await waitFor(() => expect(heldFacets.held.resolvers.length).toBeGreaterThan(0));
    await startEdit(user, grid, 101);
    await changeTagAndSave(user, grid, 101);
    await screen.findByTestId('edit-preview-cancel');
    dropGroup = true;
    holdFacets = false;
    await act(async () => heldFacets.held.release());
    await waitFor(() => expect(screen.queryByRole('grid', { name: GROUP_LABEL }), 'the edited group left the facets').toBeNull());
    await user.click(screen.getByTestId('edit-preview-cancel'));
    await act(async () => new Promise(resolve => setTimeout(resolve, UNMOUNT_SETTLE_MS)));
    const showDisabled = showButtons().map(button => (button as HTMLButtonElement).disabled);
    console.log('[view-errors group left during dialog]', JSON.stringify({ showDisabled }));
    expect(showDisabled.some(Boolean), 'Show is enabled: no lock is held for a row that is gone').toBe(false);
    expect(screen.getByRole('textbox', { name: VIEW_ERRORS_TEXT.searchLabel })).toBeEnabled();
  });

  it("completes an apply in flight: the undo toast carries the operation's census and no read goes to the old scope", async () => {
    const user = userEvent.setup();
    const heldApply = holdResponses(() => jsonResponse(APPLY_RESULT));
    const network = installPageFetch(defaultRoutes({ preview: () => jsonResponse(INFO_PLAN), apply: heldApply.route }));
    render(<PageWithSidebarStandIn />);
    const grid = await findLoadedGrid(GROUP_LABEL);
    await startEdit(user, grid, 102);
    await changeTagAndSave(user, grid, 102);
    await waitFor(() => expect(heldApply.held.resolvers).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: SIDEBAR_STAND_IN }));
    const start = network.requests.length;
    await act(async () => heldApply.held.release());
    await waitFor(() => expect(network.bodiesFor(ROUTES.rebuild)).toHaveLength(2));
    const rebuildBodies = network.bodiesFor(ROUTES.rebuild);
    await user.click(await screen.findByTestId('undo-toast-undo'));
    await waitFor(() => expect(network.bodiesFor(ROUTES.revert)).toHaveLength(1));
    const readScopes = readCensusIDs(network.requests, start);
    console.log('[view-errors census change apply]', JSON.stringify({ rebuildBodies, revert: network.bodiesFor(ROUTES.revert), readScopes }));
    const editedRebuildBody = { coreMeasurementIDs: [SECOND_CENSUS_ROW.coreMeasurementID] };
    expect(rebuildBodies, 'the committed apply rebuilds its own measurement (r3.1, R4)').toEqual([editedRebuildBody, editedRebuildBody]);
    expect(network.bodiesFor(ROUTES.revert)[0], "the undo toast carries the operation's census").toMatchObject({ censusID: SECOND_CENSUS_ID });
    expect(
      readScopes.every(censusIDs => censusIDs === JSON.stringify(SWITCHED_CENSUS_IDS)),
      'no query or facets request for the old scope'
    ).toBe(true);
  });

  it('disables Clear with the saving tooltip in the new census while a detached apply is outstanding, and enables it once the apply settles (r3, P2-8)', async () => {
    const user = userEvent.setup();
    const heldApply = holdResponses(() => jsonResponse(APPLY_RESULT));
    const network = installPageFetch(defaultRoutes({ preview: () => jsonResponse(INFO_PLAN), apply: heldApply.route }));
    render(<PageWithSidebarStandIn />);
    const grid = await findLoadedGrid(GROUP_LABEL);
    await startEdit(user, grid, 102);
    await changeTagAndSave(user, grid, 102);
    await waitFor(() => expect(heldApply.held.resolvers).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: SIDEBAR_STAND_IN }));
    const switchedGrid = await findLoadedGrid(GROUP_LABEL);
    await waitFor(() => expect(switchedGrid.querySelector('[data-id="101"]'), 'the new census lists row 101').not.toBeNull());
    await user.click(rowAction(switchedGrid, 101, 'Details'));
    const clear = await screen.findByRole('button', { name: DETAILS_SHEET_TEXT.clearValidationErrors });
    console.log(
      '[view-errors detached apply clear]',
      JSON.stringify({ clearDisabled: (clear as HTMLButtonElement).disabled, applyHeld: heldApply.held.resolvers.length })
    );
    expect(clear, 'Clear is not offered while the old census still saves').toBeDisabled();
    await user.hover(clear.parentElement as HTMLElement);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(EDIT_LOCK_TOOLTIPS.saving);
    await user.unhover(clear.parentElement as HTMLElement);
    await act(async () => heldApply.held.release());
    await waitFor(() => expect(network.bodiesFor(ROUTES.rebuild)).toHaveLength(2));
    await waitFor(() => expect(screen.getByRole('button', { name: DETAILS_SHEET_TEXT.clearValidationErrors }), 'enabled once the apply settled').toBeEnabled());
    expect(network.bodiesFor(ROUTES.clear), 'no click was swallowed: nothing was sent').toHaveLength(0);
  });

  it('keeps a committed save committed when the census changes during its rebuilds (P2-4)', async () => {
    const user = userEvent.setup();
    const heldSummary = holdResponses(() => jsonResponse({ success: true }));
    const network = installPageFetch(defaultRoutes({ preview: () => jsonResponse(INFO_PLAN), rebuildSummary: heldSummary.route }));
    render(<PageWithSidebarStandIn />);
    const grid = await findLoadedGrid(GROUP_LABEL);
    await startEdit(user, grid, 102);
    await changeTagAndSave(user, grid, 102);
    await waitFor(() => expect(heldSummary.held.resolvers).toHaveLength(1));
    expect(network.bodiesFor(ROUTES.apply)).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: SIDEBAR_STAND_IN }));
    await act(async () => heldSummary.held.release());
    console.log(
      '[view-errors committed census change page]',
      document.querySelector('[data-testid="errors-explorer-page-alert"]')?.textContent ?? 'no page alert'
    );
    expect(screen.queryByText(VIEW_ERRORS_ALERTS.editCancelledByCensusChange('T-102', 'S-1')), 'a committed save is never reported as not saved').toBeNull();
    expect(await screen.findByTestId('undo-toast-undo')).toBeInTheDocument();
  });
});

describe('read gates by scope with the real grid (P2-2)', () => {
  it('sends no flat infinite read while gated, a sort included, and re-reads once after Retry refresh', async () => {
    const user = userEvent.setup();
    let rebuildFails = true;
    const network = installPageFetch(
      defaultRoutes({
        preview: () => jsonResponse(INFO_PLAN),
        rebuildSummary: () => (rebuildFails ? jsonResponse({ error: 'Lock wait timeout exceeded' }, 500) : jsonResponse({ success: true }))
      })
    );
    render(<PageWithSidebarStandIn />);
    await findLoadedGrid(GROUP_LABEL);
    await chooseNoGrouping(user);
    const flat = await screen.findByRole('grid', { name: FLAT_LABEL });
    await switchFlatGridToInfinite();
    const infiniteReads = () => network.bodiesFor(ROUTES.query).filter(body => body?.pageSize === INFINITE_DEFAULT_CHUNK);
    await waitFor(() => expect(infiniteReads()).toHaveLength(1));
    await waitFor(() => expect(flat.querySelector('[data-id="101"]')).not.toBeNull());
    await startEdit(user, flat, 101);
    await changeTagAndSave(user, flat, 101);
    expect(await screen.findByText(VIEW_ERRORS_ALERTS.savedButRefreshFailed('Lock wait timeout exceeded'))).toBeInTheDocument();
    const gatedStart = network.requests.length;
    await user.click(within(flat).getByRole('columnheader', { name: /Tree Tag/ }));
    await act(async () => new Promise(resolve => setTimeout(resolve, GATE_QUIET_MS)));
    console.log('[view-errors flat gate page]', JSON.stringify(network.urlsSince(gatedStart)));
    expect(
      network.urlsSince(gatedStart).filter(url => ROUTES.query.test(url) || ROUTES.facets.test(url)),
      'nothing is read while gated'
    ).toEqual([]);
    rebuildFails = false;
    await user.click(screen.getByRole('button', { name: VIEW_ERRORS_TEXT.retryRefresh }));
    await waitFor(() => expect(infiniteReads()).toHaveLength(2));
    expect(infiniteReads()[1]?.sortModel, 'the lifted read carries the sort chosen while gated').toEqual([{ field: 'treeTag', sort: 'asc' }]);
  });

  it("doesn't gate the details of a census-B row while census A has a pending rebuild", async () => {
    const user = userEvent.setup();
    const network = installPageFetch(
      defaultRoutes({ preview: () => jsonResponse(INFO_PLAN), rebuildSummary: () => jsonResponse({ error: 'Lock wait timeout exceeded' }, 500) })
    );
    render(<PageWithSidebarStandIn />);
    const grid = await findLoadedGrid(GROUP_LABEL);
    await startEdit(user, grid, 101);
    await changeTagAndSave(user, grid, 101);
    expect(await screen.findByText(VIEW_ERRORS_ALERTS.savedButRefreshFailed('Lock wait timeout exceeded'))).toBeInTheDocument();
    const detailsBefore = network.requests.filter(request => ROUTES.details.test(request.url)).length;
    await user.click(rowAction(grid, 102, 'Details'));
    await waitFor(() => expect(network.requests.filter(request => ROUTES.details.test(request.url))).toHaveLength(detailsBefore + 1));
    const sheet = await screen.findByTestId('error-row-details-sheet');
    console.log('[view-errors details gate B]', sheet.textContent);
    expect(within(sheet).queryByText(DETAILS_SHEET_TEXT.rowsStale), "census B's details are current").toBeNull();
    await user.click(screen.getByRole('button', { name: DETAILS_SHEET_TEXT.closeDetails }));
    await user.click(rowAction(grid, 101, 'Details'));
    const gatedSheet = await screen.findByTestId('error-row-details-sheet');
    await waitFor(() => expect(within(gatedSheet).getByText(DETAILS_SHEET_TEXT.rowsStale)).toBeInTheDocument());
    expect(
      network.requests.filter(request => ROUTES.details.test(request.url)),
      "census A's details wait for the rebuild"
    ).toHaveLength(detailsBefore + 1);
  });
});

const PAGING_SETTLE_MS = 400;
const SECOND_PAGE_ROW_ID = 111;
const SECOND_PAGE_INDEX = 1;
const FLAT_PAGING_ROW_COUNT = 30;
const FIRST_FLAT_PAGING_ROW_ID = 701;

function queryPagesSince(network: ReturnType<typeof installPageFetch>, start: number): unknown[] {
  return network.requests
    .slice(start)
    .filter(request => ROUTES.query.test(request.url))
    .map(request => request.body?.page);
}

describe('paging a grid keeps the page it navigated to', () => {
  it('shows the second page of a group after Next, with no snap back to page 1', async () => {
    const user = userEvent.setup();
    const network = installPageFetch(defaultRoutes({ query: pagedQuery(ELEVEN_ROWS) }));
    render(<PageWithSidebarStandIn />);
    const grid = await findLoadedGrid(GROUP_LABEL);
    const next = within(groupFooter(grid)).getByRole('button', { name: 'Go to next page' });
    await waitFor(() => expect(next, '11 rows: Next is enabled on page 1').toBeEnabled());
    const requestsBefore = network.requests.length;

    await user.click(next);
    await waitFor(() => expect(grid.querySelector(`[data-id="${SECOND_PAGE_ROW_ID}"]`), 'the second-page row appears').not.toBeNull());
    await act(async () => new Promise(resolve => setTimeout(resolve, PAGING_SETTLE_MS)));

    const visibleRowIDs = Array.from(grid.querySelectorAll('[role="row"][data-id]'), row => row.getAttribute('data-id'));
    const pagesRequested = queryPagesSince(network, requestsBefore);
    console.log('[view-errors group paging]', JSON.stringify({ pagesRequested, visibleRowIDs }));
    expect(visibleRowIDs, 'the second-page row is still shown after the grid settled').toContain(String(SECOND_PAGE_ROW_ID));
    expect(pagesRequested.at(-1), 'the last page requested is the second page').toBe(SECOND_PAGE_INDEX);
  });

  it('shows the second page of the flat grid after Next, with no snap back to page 1', async () => {
    const user = userEvent.setup();
    const rows = Array.from({ length: FLAT_PAGING_ROW_COUNT }, (_, index) =>
      explorerRow(FIRST_FLAT_PAGING_ROW_ID + index, {
        errorCodes: ['14'],
        primaryErrorMessage: 'Flagged;Different species',
        errorMessages: ['Flagged;Different species']
      })
    );
    const network = installPageFetch(defaultRoutes({ query: pagedQuery(rows) }));
    render(<PageWithSidebarStandIn />);
    await findLoadedGrid(GROUP_LABEL);
    await chooseNoGrouping(user);
    const flat = await findLoadedGrid(FLAT_LABEL);
    const next = within(groupFooter(flat)).getByRole('button', { name: 'Go to next page' });
    await waitFor(() => expect(next, 'more rows than one flat page: Next is enabled').toBeEnabled());
    const requestsBefore = network.requests.length;

    await user.click(next);
    const secondPageRowID = FIRST_FLAT_PAGING_ROW_ID + ERRORS_FLAT_GRID_PAGE_SIZE;
    await waitFor(() => expect(flat.querySelector(`[data-id="${secondPageRowID}"]`), 'the second-page row appears').not.toBeNull());
    await act(async () => new Promise(resolve => setTimeout(resolve, PAGING_SETTLE_MS)));

    const visibleRowIDs = Array.from(flat.querySelectorAll('[role="row"][data-id]'), row => row.getAttribute('data-id'));
    const pagesRequested = queryPagesSince(network, requestsBefore);
    console.log('[view-errors flat paging]', JSON.stringify({ pagesRequested, visibleRowIDs }));
    expect(visibleRowIDs, 'the second-page row is still shown after the grid settled').toContain(String(secondPageRowID));
    expect(pagesRequested.at(-1), 'the last page requested is the second page').toBe(SECOND_PAGE_INDEX);
  });

  it('moves a group back to its last remaining page when a save empties the page it was on', async () => {
    const user = userEvent.setup();
    let rows = [...ELEVEN_ROWS];
    let holdFacets = false;
    const slowFacets = holdResponses(() => jsonResponse(facetsResponse([VALIDATION_FACET], { affectedMeasurements: rows.length, errorTypeCount: 1 })));
    const network = installPageFetch(
      defaultRoutes({
        facets: request =>
          holdFacets ? slowFacets.route(request) : jsonResponse(facetsResponse([VALIDATION_FACET], { affectedMeasurements: rows.length, errorTypeCount: 1 })),
        preview: () => jsonResponse(INFO_PLAN),
        query: request => pagedQuery(rows)(request),
        apply: () => {
          holdFacets = true;
          rows = rows.slice(0, GROUP_PAGE_SIZE);
          return jsonResponse(APPLY_RESULT);
        }
      })
    );
    render(<PageWithSidebarStandIn />);
    const grid = await findLoadedGrid(GROUP_LABEL);
    const next = within(groupFooter(grid)).getByRole('button', { name: 'Go to next page' });
    await waitFor(() => expect(next).toBeEnabled());
    await user.click(next);
    await waitFor(() => expect(grid.querySelector(`[data-id="${SECOND_PAGE_ROW_ID}"]`)).not.toBeNull());
    await startEdit(user, grid, SECOND_PAGE_ROW_ID);
    await changeTagAndSave(user, grid, SECOND_PAGE_ROW_ID);
    await waitFor(() => expect(network.bodiesFor(ROUTES.apply)).toHaveLength(1));
    await waitFor(() => expect(slowFacets.held.resolvers.length, 'the facets read is still outstanding').toBeGreaterThan(0));
    await waitFor(() => expect(queryPagesSince(network, 0).length, 'the group re-read its emptied page while the lock holds').toBeGreaterThan(2));
    await act(async () => new Promise(resolve => setTimeout(resolve, PAGING_SETTLE_MS)));
    expect(showButtons()[0], 'the page is still locked by the slow facets read').toBeDisabled();
    holdFacets = false;
    await act(async () => slowFacets.held.release());
    await waitFor(() => expect(showButtons()[0], 'the refresh finished and released the lock').toBeEnabled());
    await act(async () => new Promise(resolve => setTimeout(resolve, PAGING_SETTLE_MS)));

    const visibleRowIDs = Array.from(grid.querySelectorAll('[role="row"][data-id]'), row => row.getAttribute('data-id'));
    console.log('[view-errors last page emptied]', JSON.stringify({ visibleRowIDs, pagesRequested: queryPagesSince(network, 0) }));
    expect(visibleRowIDs, 'the group shows its remaining first page instead of an empty grid').toHaveLength(GROUP_PAGE_SIZE);
    expect(grid.querySelector(`[data-id="${SECOND_PAGE_ROW_ID}"]`), 'the saved row left the group').toBeNull();
  });
});

describe('the page alert has an end', () => {
  const PREVIEW_REJECTION = 'species not found';
  const SAVE_FAILED_ALERT = VIEW_ERRORS_ALERTS.saveFailed(PREVIEW_REJECTION);

  async function failASaveOn(user: ReturnType<typeof userEvent.setup>, grid: HTMLElement, rowID: number) {
    await startEdit(user, grid, rowID);
    await changeTagAndSave(user, grid, rowID);
    expect(await screen.findByText(SAVE_FAILED_ALERT)).toBeInTheDocument();
    await user.click(rowAction(grid, rowID, 'Cancel'));
    await waitFor(() => expect(editedInput(grid, rowID)).toBeNull());
  }

  it("closes with the alert's dismiss control", async () => {
    const user = userEvent.setup();
    installPageFetch(defaultRoutes({ preview: () => new Response(PREVIEW_REJECTION, { status: 422 }) }));
    render(<PageWithSidebarStandIn />);
    const grid = await findLoadedGrid(GROUP_LABEL);
    await failASaveOn(user, grid, 101);

    await user.click(within(screen.getByTestId('errors-explorer-page-alert')).getByRole('button', { name: VIEW_ERRORS_TEXT.dismissAlert }));

    expect(screen.queryByTestId('errors-explorer-page-alert'), 'the dismissed alert is gone').toBeNull();
  });

  it('clears when the user starts the next edit', async () => {
    const user = userEvent.setup();
    installPageFetch(defaultRoutes({ preview: () => new Response(PREVIEW_REJECTION, { status: 422 }) }));
    render(<PageWithSidebarStandIn />);
    const grid = await findLoadedGrid(GROUP_LABEL);
    await failASaveOn(user, grid, 101);

    await startEdit(user, grid, 102);

    expect(screen.queryByText(SAVE_FAILED_ALERT), 'the earlier failure is not shown over a new edit').toBeNull();
  });

  it('clears when a Clear starts', async () => {
    const user = userEvent.setup();
    installPageFetch(defaultRoutes({ preview: () => new Response(PREVIEW_REJECTION, { status: 422 }) }));
    render(<PageWithSidebarStandIn />);
    const grid = await findLoadedGrid(GROUP_LABEL);
    await failASaveOn(user, grid, 101);
    await user.click(rowAction(grid, 102, 'Details'));

    await user.click(await screen.findByRole('button', { name: DETAILS_SHEET_TEXT.clearValidationErrors }));

    await waitFor(() => expect(screen.queryByText(SAVE_FAILED_ALERT), 'the earlier failure is not shown over a new Clear').toBeNull());
  });

  it('clears once Retry refresh succeeds', async () => {
    const user = userEvent.setup();
    let rebuildFails = true;
    installPageFetch(
      defaultRoutes({
        preview: () => jsonResponse(INFO_PLAN),
        rebuildSummary: () => (rebuildFails ? jsonResponse({ error: 'Lock wait timeout exceeded' }, 500) : jsonResponse({ success: true }))
      })
    );
    render(<PageWithSidebarStandIn />);
    const grid = await findLoadedGrid(GROUP_LABEL);
    await startEdit(user, grid, 101);
    await changeTagAndSave(user, grid, 101);
    expect(await screen.findByText(VIEW_ERRORS_ALERTS.savedButRefreshFailed('Lock wait timeout exceeded'))).toBeInTheDocument();

    rebuildFails = false;
    await user.click(screen.getByRole('button', { name: VIEW_ERRORS_TEXT.retryRefresh }));

    await waitFor(() => expect(screen.queryByTestId('errors-explorer-page-alert'), 'the refresh worked: no alert remains').toBeNull());
  });
});
