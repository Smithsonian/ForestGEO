import React from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GridColDef } from '@mui/x-data-grid';
import { MeasurementsGridHarness } from './measurementscommons.harness';
import type { ViewDataAboveGridControls } from '@/components/viewdata/viewdatacontrols';
import ViewDataGridToolbar from '@/components/viewdata/viewdatagridtoolbar';
import { VIEW_DATA_TEXT } from '@/config/viewdata';
import { CLEAR_VALIDATION_ERRORS_SUCCESS } from '@/config/errorsexplorer';
import { ROW_UPDATED_MESSAGE, UNRESOLVED_ERRORS_SNACKBAR_MESSAGE } from './measurementscommonsutils';
import { HTTPResponses } from '@/config/macros';

const ctx = vi.hoisted(() => {
  const noop = () => undefined;
  return {
    plot: { plotID: 1, plotName: 'Test Plot' },
    census: { plotCensusNumber: 1, dateRanges: [{ censusID: 1 }] },
    site: { schemaName: 'testschema', siteName: 'Test Site' },
    loading: { setLoading: noop },
    session: { data: { user: { userStatus: 'field crew' } }, status: 'authenticated' },
    router: { push: noop, replace: noop },
    editPreviewFlow: {
      beginEdit: (async () => undefined) as (...args: unknown[]) => Promise<unknown>,
      confirmDialog: async () => undefined,
      cancelDialog: noop as () => void,
      cancelPendingOperation: (() => 'none') as () => 'none' | 'cancelled-before-apply' | 'detached-apply',
      dialogState: { open: false, plan: null, busy: false, wasRefreshed: false } as { open: boolean; plan: unknown; busy: boolean; wasRefreshed: boolean }
    },
    censusList: [{ plotCensusNumber: 1, censusIDs: [1] }] as Array<{ plotCensusNumber: number; censusIDs: number[] } | undefined>,
    useRealEditPreviewFlow: false,
    grid: null as null | Record<string, unknown>
  };
});

vi.mock('@/app/contexts/compat-hooks', () => ({
  usePlotContext: () => ctx.plot,
  useOrgCensusContext: () => ctx.census,
  useSiteContext: () => ctx.site,
  useOrgCensusListContext: () => ctx.censusList
}));
vi.mock('@/app/contexts/loadingprovider', () => ({ useLoading: () => ctx.loading }));
vi.mock('next-auth/react', () => ({ useSession: () => ctx.session }));
vi.mock('next/navigation', () => ({ useRouter: () => ctx.router }));
vi.mock('@/lib/db/definitions/core', async importOriginal => importOriginal());
vi.mock('@/lib/db/definitions/views', async importOriginal => importOriginal());
vi.mock('@/lib/db/definitions/zones', async importOriginal => importOriginal());
vi.mock('@/lib/db/definitions/personnel', async importOriginal => importOriginal());
vi.mock('@/lib/db/definitions/taxonomies', async importOriginal => importOriginal());
vi.mock('@/lib/db/definitions/timekeeping', async importOriginal => importOriginal());
vi.mock('@/lib/db/definitions/validations', async importOriginal => importOriginal());
vi.mock('@/lib/db/definitions/admin', async importOriginal => importOriginal());
vi.mock('@/components/client/clientmacros', async importOriginal => ({
  ...(await importOriginal<typeof import('@/components/client/clientmacros')>()),
  loadSelectableOptions: async () => undefined,
  getSelectableOptionsForField: () => []
}));
vi.mock('@/app/hooks/useEditPreviewFlow', async importOriginal => {
  const actual = await importOriginal<typeof import('@/app/hooks/useEditPreviewFlow')>();
  return {
    ...actual,
    // ctx.useRealEditPreviewFlow is set in beforeEach, before render, and never changes while a component is mounted,
    // so the hook call order is stable within a test.
    useEditPreviewFlow: (args: Parameters<typeof actual.useEditPreviewFlow>[0]) =>
      ctx.useRealEditPreviewFlow ? actual.useEditPreviewFlow(args) : ctx.editPreviewFlow
  };
});
vi.mock('@/components/datagrids/skipreentrydatamodal', () => ({
  default: ({ handleSave, handleClose }: { handleSave: () => void; handleClose: () => void }) => (
    <div role="dialog" aria-label="Save confirmation">
      <button type="button" onClick={handleSave}>
        Confirm save
      </button>
      <button type="button" onClick={handleClose}>
        Cancel save
      </button>
    </div>
  )
}));
vi.mock('@mui/x-data-grid', async importOriginal => {
  const actual = await importOriginal<typeof import('@mui/x-data-grid')>();
  return {
    ...actual,
    GridActionsCellItem: ({
      label,
      onClick,
      disabled,
      'aria-label': ariaLabel
    }: {
      label: string;
      onClick: () => void;
      disabled?: boolean;
      'aria-label'?: string;
    }) => (
      <button type="button" aria-label={ariaLabel ?? label} data-disabled={String(Boolean(disabled))} onClick={onClick}>
        {label}
      </button>
    )
  };
});
vi.mock('@/components/client/validationcore', () => ({ default: () => <div data-testid="validation-core" /> }));
vi.mock('@/components/client/modals/validationoverridemodal', () => ({ default: () => <div data-testid="validation-override-modal" /> }));
vi.mock('@/config/styleddatagrid', async importOriginal => ({
  ...(await importOriginal<typeof import('@/config/styleddatagrid')>()),
  StyledDataGrid: (props: Record<string, unknown>) => {
    ctx.grid = props;
    return <div data-testid="grid" />;
  }
}));

const ROW = {
  id: 1,
  coreMeasurementID: 501,
  censusID: 1,
  treeTag: '010203',
  stemTag: '1',
  measuredDBH: 12.5,
  measurementDate: '2024-06-15',
  measurementStatus: 'passed'
};
const GRID_COLUMNS: GridColDef[] = [{ field: 'treeTag', headerName: 'Tree', editable: true }];
const GRID_URL_PREFIX = '/api/fixeddatafilter/measurementssummary/testschema/';
const QUERY_URL = '/api/query';
const UNDO_EDIT_OPERATION_ID = 900;
const EDITED_DBH = 13.5;
const NEW_CENSUS_ID = 2;
const CENSUS_B_ROW = { ...ROW, coreMeasurementID: 601, censusID: NEW_CENSUS_ID, treeTag: '020304' };
const COUNTS_MARKER = 'CountUnresolvedLogged';
const COUNTS_ROW = {
  CountUnresolvedLogged: 3,
  CountFailedNoLog: 1,
  CountPending: 2,
  CountValid: 4,
  CountOverridable: 2,
  CountRevalidatable: 1,
  FirstMeasurementDate: '2024-06-03',
  LastMeasurementDate: '2024-06-09'
};

const NO_SNACKBAR_COUNTS_ROW = { CountUnresolvedLogged: 0, CountFailedNoLog: 0, CountPending: 0, CountValid: 0 };
const fetchMock = vi.fn();
let countsRow: Record<string, unknown> = COUNTS_ROW;
const controlsLog: ViewDataAboveGridControls[] = [];
const latestControls = () => controlsLog[controlsLog.length - 1];
const renderAboveGrid = (controls: ViewDataAboveGridControls) => {
  controlsLog.push(controls);
  return <div data-testid="above-grid" />;
};

function respond(body: unknown): Response {
  return { ok: true, status: HTTPResponses.OK, json: async () => body } as Response;
}

function route(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  if (url.startsWith(GRID_URL_PREFIX)) return Promise.resolve(respond({ output: [ROW], totalCount: 1 }));
  if (url === QUERY_URL) return Promise.resolve(respond(String(init?.body ?? '').includes(COUNTS_MARKER) ? [countsRow] : []));
  if (url.startsWith('/api/validations/validationerrordisplay')) return Promise.resolve(respond({ failed: [] }));
  return Promise.resolve(respond({}));
}

const gridRequests = () =>
  fetchMock.mock.calls
    .filter(([url]) => String(url).startsWith(GRID_URL_PREFIX))
    .map(([url, init]) => ({ url: String(url), body: JSON.parse(String((init as RequestInit).body)) }));
const countRequests = () =>
  fetchMock.mock.calls.filter(([url, init]) => String(url) === QUERY_URL && String((init as RequestInit | undefined)?.body ?? '').includes(COUNTS_MARKER));

describe('MeasurementsCommons View Data page controls', () => {
  beforeEach(() => {
    controlsLog.length = 0;
    countsRow = COUNTS_ROW;
    ctx.grid = null;
    fetchMock.mockImplementation(route);
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('hands the header the counts from one counts query that also selects the date range', async () => {
    render(<MeasurementsGridHarness initialRows={[ROW]} gridColumns={GRID_COLUMNS} renderAboveGrid={renderAboveGrid} />);
    await waitFor(() => expect(latestControls()?.stateCounts).not.toBeNull());
    const sql = JSON.parse(String((countRequests()[0][1] as RequestInit).body)) as string;
    console.log('[page controls] counts', JSON.stringify(latestControls().stateCounts), 'sql', sql);
    expect(latestControls().stateCounts).toEqual({
      unresolvedLogged: 3,
      failedNoLog: 1,
      pending: 2,
      valid: 4,
      overridable: 2,
      revalidatable: 1,
      firstMeasurementDate: '2024-06-03',
      lastMeasurementDate: '2024-06-09'
    });
    expect(sql).toContain('MIN(vft.MeasurementDate) AS FirstMeasurementDate');
    expect(sql).toContain('MAX(vft.MeasurementDate) AS LastMeasurementDate');
    expect(sql).not.toContain('CountOldTrees');
  });

  it('sends the With errors bucket and returns to page 0 when Show changes', async () => {
    render(<MeasurementsGridHarness initialRows={[ROW]} gridColumns={GRID_COLUMNS} renderAboveGrid={renderAboveGrid} initialPage={2} />);
    await waitFor(() => expect(latestControls()).toBeDefined());
    act(() => latestControls().onShowOptionChange('withErrors'));
    await waitFor(() => expect(gridRequests().some(request => JSON.stringify(request.body.filterModel.visible) === JSON.stringify(['errors']))).toBe(true));
    const request = gridRequests().find(r => JSON.stringify(r.body.filterModel.visible) === JSON.stringify(['errors']));
    console.log('[page controls] show request', JSON.stringify(request));
    expect(request?.url).toContain(`${GRID_URL_PREFIX}0/`);
    expect(latestControls().showOption).toBe('withErrors');
  });

  it('applies Search only on demand and never re-runs the counts query for it', async () => {
    render(<MeasurementsGridHarness initialRows={[ROW]} gridColumns={GRID_COLUMNS} renderAboveGrid={renderAboveGrid} />);
    await waitFor(() => expect(latestControls()?.stateCounts).not.toBeNull());
    const countRequestsBefore = countRequests().length;
    act(() => latestControls().onSearchTextChange('010203'));
    expect(gridRequests().some(request => request.body.filterModel.quickFilterValues.includes('010203'))).toBe(false);
    act(() => latestControls().onSearchApply());
    await waitFor(() => expect(gridRequests().some(request => request.body.filterModel.quickFilterValues.includes('010203'))).toBe(true));
    console.log('[page controls] counts requests', countRequestsBefore, countRequests().length);
    expect(countRequests().length).toBe(countRequestsBefore);
    expect(latestControls().appliedSearchText).toBe('010203');
  });

  it('opens the export modal and the three validation dialogs from the controls', async () => {
    render(<MeasurementsGridHarness initialRows={[ROW]} gridColumns={GRID_COLUMNS} renderAboveGrid={renderAboveGrid} />);
    await waitFor(() => expect(latestControls()).toBeDefined());
    act(() => latestControls().onOpenExport());
    expect(await screen.findByText('Exporting Data')).toBeInTheDocument();
    act(() => latestControls().onRunValidations());
    expect(await screen.findByTestId('validation-core')).toBeInTheDocument();
    act(() => latestControls().onOverrideValidations());
    expect(await screen.findByTestId('validation-override-modal')).toBeInTheDocument();
    act(() => latestControls().onResetValidations());
    expect(await screen.findByText('Reset Validation States?')).toBeInTheDocument();
  });

  it('uses the View Data grid toolbar slot and cycles density into the grid', async () => {
    render(<MeasurementsGridHarness initialRows={[ROW]} gridColumns={GRID_COLUMNS} renderAboveGrid={renderAboveGrid} />);
    await waitFor(() => expect(ctx.grid).not.toBeNull());
    const slots = ctx.grid?.slots as Record<string, unknown>;
    const toolbarSettings = (ctx.grid?.slotProps as { toolbar: { viewDataToolbar: { onCycleDensity: () => void; caption: string | null } } }).toolbar
      .viewDataToolbar;
    expect(slots.toolbar).toBe(ViewDataGridToolbar);
    expect(ctx.grid?.density).toBe('standard');
    expect(toolbarSettings.caption).toBe(VIEW_DATA_TEXT.captionEditor);
    act(() => toolbarSettings.onCycleDensity());
    await waitFor(() => expect(ctx.grid?.density).toBe('compact'));
  });

  it('shows the empty-census overlay with the Add measurements action, and the filtered overlay whose Clear filters resets everything', async () => {
    const user = userEvent.setup();
    countsRow = { CountUnresolvedLogged: 0, CountFailedNoLog: 0, CountPending: 0, CountValid: 0 };
    const first = render(
      <MeasurementsGridHarness
        initialRows={[]}
        gridColumns={GRID_COLUMNS}
        renderAboveGrid={renderAboveGrid}
        emptyCensusAction={<button type="button">Add measurements</button>}
      />
    );
    await waitFor(() => expect(latestControls()?.stateCounts).not.toBeNull());
    const EmptyOverlay = (ctx.grid?.slots as { noRowsOverlay: React.ComponentType }).noRowsOverlay;
    const overlay = render(<EmptyOverlay />);
    expect(screen.getByText(VIEW_DATA_TEXT.emptyCensus)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add measurements' })).toBeInTheDocument();
    overlay.unmount();
    first.unmount();

    countsRow = COUNTS_ROW;
    controlsLog.length = 0;
    render(<MeasurementsGridHarness initialRows={[]} gridColumns={GRID_COLUMNS} renderAboveGrid={renderAboveGrid} />);
    await waitFor(() => expect(latestControls()?.stateCounts).not.toBeNull());
    act(() => {
      latestControls().onShowOptionChange('pending');
      latestControls().onSearchTextChange('010203');
    });
    act(() => latestControls().onSearchApply());
    await waitFor(() => expect(latestControls().appliedSearchText).toBe('010203'));
    const FilteredOverlay = (ctx.grid?.slots as { noRowsOverlay: React.ComponentType }).noRowsOverlay;
    render(<FilteredOverlay />);
    expect(screen.getByText(VIEW_DATA_TEXT.emptyFiltered)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: VIEW_DATA_TEXT.clearFilters }));
    await waitFor(() => expect(latestControls().showOption).toBe('all'));
    console.log(
      '[page controls] after clear',
      JSON.stringify({ show: latestControls().showOption, search: latestControls().searchText, items: (ctx.grid?.filterModel as { items: unknown[] }).items })
    );
    expect(latestControls().searchText).toBe('');
    expect(latestControls().appliedSearchText).toBe('');
    expect((ctx.grid?.filterModel as { items: unknown[] }).items).toEqual([]);
  });
});

describe('MeasurementsCommons View Data details sheet', () => {
  beforeEach(() => {
    controlsLog.length = 0;
    countsRow = COUNTS_ROW;
    ctx.grid = null;
    // Until Task 20 the Actions column still renders only for global / db admin sessions.
    ctx.session.data.user.userStatus = 'global';
    ctx.census = { plotCensusNumber: 1, dateRanges: [{ censusID: 1 }] };
    fetchMock.mockImplementation(route);
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    ctx.census = { plotCensusNumber: 1, dateRanges: [{ censusID: 1 }] };
    ctx.editPreviewFlow = {
      ...ctx.editPreviewFlow,
      beginEdit: async () => undefined,
      cancelDialog: () => undefined,
      dialogState: { open: false, plan: null, busy: false, wasRefreshed: false }
    };
  });

  function renderRowActions(row: Record<string, unknown>) {
    const actionsColumn = (ctx.grid?.columns as GridColDef[]).find(column => column.field === 'actions') as GridColDef & {
      getActions: (params: { id: number; row: unknown }) => React.ReactNode[];
    };
    return render(<div data-testid={`row-actions-${row.id}`}>{actionsColumn.getActions({ id: Number(row.id), row })}</div>);
  }

  it('opens the sheet from Details for the row, using its own census, and closes it', async () => {
    const user = userEvent.setup();
    render(<MeasurementsGridHarness initialRows={[{ ...ROW, censusID: 72 }]} gridColumns={GRID_COLUMNS} renderAboveGrid={renderAboveGrid} />);
    await waitFor(() => expect(ctx.grid).not.toBeNull());
    renderRowActions({ ...ROW, censusID: 72 });
    await user.click(screen.getByRole('button', { name: new RegExp(VIEW_DATA_TEXT.detailsFor('010203', '1')) }));
    expect(await screen.findByRole('heading', { name: 'Measurement 501' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close details' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Measurement 501' })).not.toBeInTheDocument());
  });

  it('re-reads rows and counts in strict mode after a clear and sends no client view rebuild', async () => {
    const user = userEvent.setup();
    const invalidRow = { ...ROW, measurementStatus: 'invalidNoLog' };
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/validations/clearmeasurementerrors') return Promise.resolve(respond({ clearedErrorCount: 0 }));
      if (String(input).startsWith(GRID_URL_PREFIX)) return Promise.resolve(respond({ output: [invalidRow], totalCount: 1 }));
      return route(input, init);
    });
    render(<MeasurementsGridHarness initialRows={[invalidRow]} gridColumns={GRID_COLUMNS} renderAboveGrid={renderAboveGrid} />);
    await waitFor(() => expect(ctx.grid).not.toBeNull());
    renderRowActions(invalidRow);
    await user.click(screen.getByRole('button', { name: new RegExp(VIEW_DATA_TEXT.detailsFor('010203', '1')) }));
    const gridBefore = gridRequests().length;
    const countsBefore = countRequests().length;
    await user.click(await screen.findByRole('button', { name: 'Clear validation errors' }));
    await waitFor(() => expect(countRequests().length).toBeGreaterThan(countsBefore));
    // COUNTS_ROW has unresolved errors, so refreshCounts posts its own state snackbar during the re-read;
    // the clear's outcome must still be the message left on screen (R2-P3-4).
    expect(await screen.findByText(CLEAR_VALIDATION_ERRORS_SUCCESS)).toBeInTheDocument();
    console.log(
      '[sheet] after clear',
      JSON.stringify({
        grid: [gridBefore, gridRequests().length],
        counts: [countsBefore, countRequests().length],
        snackbar: screen.queryByText(UNRESOLVED_ERRORS_SNACKBAR_MESSAGE(COUNTS_ROW.CountUnresolvedLogged))?.textContent ?? null
      })
    );
    expect(gridRequests().length).toBeGreaterThan(gridBefore);
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith('/api/refreshviews'))).toBe(false);
    expect(screen.queryByText(VIEW_DATA_TEXT.clearRefreshFailed)).not.toBeInTheDocument();
    expect(screen.queryByText(UNRESOLVED_ERRORS_SNACKBAR_MESSAGE(COUNTS_ROW.CountUnresolvedLogged))).not.toBeInTheDocument();
  });

  it('reports a failed counts re-read after a clear instead of swallowing it', async () => {
    const user = userEvent.setup();
    const invalidRow = { ...ROW, measurementStatus: 'invalidNoLog' };
    let cleared = false;
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/validations/clearmeasurementerrors') {
        cleared = true;
        return Promise.resolve(respond({ clearedErrorCount: 0 }));
      }
      if (cleared && String(input) === '/api/query') return Promise.reject(new TypeError('Failed to fetch'));
      if (String(input).startsWith(GRID_URL_PREFIX)) return Promise.resolve(respond({ output: [invalidRow], totalCount: 1 }));
      return route(input, init);
    });
    render(<MeasurementsGridHarness initialRows={[invalidRow]} gridColumns={GRID_COLUMNS} renderAboveGrid={renderAboveGrid} />);
    await waitFor(() => expect(ctx.grid).not.toBeNull());
    renderRowActions(invalidRow);
    await user.click(screen.getByRole('button', { name: new RegExp(VIEW_DATA_TEXT.detailsFor('010203', '1')) }));
    await user.click(await screen.findByRole('button', { name: 'Clear validation errors' }));
    expect(await screen.findByText(VIEW_DATA_TEXT.clearRefreshFailed)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: VIEW_DATA_TEXT.retryRefresh })).toBeInTheDocument();
  });

  it('passes a prior-census resolver built from the census list to the sheet', async () => {
    ctx.censusList = [{ plotCensusNumber: 4, censusIDs: [70] }];
    const user = userEvent.setup();
    const dbhRow = {
      ...ROW,
      measurementStatus: 'unresolvedErrors',
      unresolvedErrorCount: 1,
      primaryErrorMessage: 'DBH growth exceeds the maximum annual rate',
      primaryErrorSource: 'validation'
    };
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).startsWith('/api/errors/explorer/details/')) {
        return Promise.resolve(
          respond({
            row: {
              ...dbhRow,
              id: 501,
              measuredDBH: 12.34,
              errorMessages: [dbhRow.primaryErrorMessage],
              errorSources: ['validation'],
              errorFields: ['measuredDBH'],
              errorCodes: ['1'],
              errorCount: 1,
              hasContradiction: false,
              contradictionTypes: [],
              contradictionType: null,
              contradictionGroupKey: null,
              relatedMeasurementIDs: [],
              isFailedRow: false
            },
            allErrors: [
              {
                source: 'validation',
                code: '1',
                message: dbhRow.primaryErrorMessage,
                fields: ['measuredDBH'],
                comparison: { priorCensusID: 70, priorDBH: 10, priorHOM: 1.3, homChanged: false }
              }
            ],
            relatedRows: []
          })
        );
      }
      return route(input, init);
    });
    render(<MeasurementsGridHarness initialRows={[dbhRow]} gridColumns={GRID_COLUMNS} renderAboveGrid={renderAboveGrid} />);
    await waitFor(() => expect(ctx.grid).not.toBeNull());
    renderRowActions(dbhRow);
    await user.click(screen.getByRole('button', { name: new RegExp(VIEW_DATA_TEXT.detailsFor('010203', '1')) }));
    // View Errors' formatDbhChangeFact prints both DBH values with two decimals.
    expect(await screen.findByText('DBH went from 10.00 in Census 4 to 12.34, a change of +23.4%')).toBeInTheDocument();
    ctx.censusList = [{ plotCensusNumber: 1, censusIDs: [1] }];
  });

  function switchCensus(rerender: (ui: React.ReactElement) => void, rows: Array<Record<string, unknown>> = [ROW]) {
    ctx.census = { plotCensusNumber: NEW_CENSUS_ID, dateRanges: [{ censusID: NEW_CENSUS_ID }] };
    rerender(<MeasurementsGridHarness initialRows={rows} gridColumns={GRID_COLUMNS} renderAboveGrid={renderAboveGrid} />);
  }

  /** Returns the pending save in an object, so awaiting this helper never waits for the save itself (R2-P4-6). */
  async function startEditAndOpenSaveConfirmation(user: ReturnType<typeof userEvent.setup>, row: typeof ROW = ROW): Promise<{ pendingSave: Promise<unknown> }> {
    act(() => (ctx.grid?.onRowModesModelChange as (model: unknown) => void)({ [row.id]: { mode: 'edit' } }));
    await waitFor(() => expect((ctx.grid?.rowModesModel as Record<string, { mode: string }>)[row.id]?.mode).toBe('edit'));
    const editingActions = renderRowActions(row);
    await user.click(within(editingActions.container).getByRole('button', { name: VIEW_DATA_TEXT.saveRow }));
    let pendingSave: Promise<unknown> = Promise.resolve();
    act(() => {
      pendingSave = (ctx.grid?.processRowUpdate as (newRow: unknown, oldRow: unknown) => Promise<unknown>)({ ...row, measuredDBH: EDITED_DBH }, row);
    });
    expect(await screen.findByRole('dialog', { name: 'Save confirmation' })).toBeInTheDocument();
    return { pendingSave };
  }

  it('cancels an open row edit with ignoreModifications, closes the sheet and drops the column filter when the census changes', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<MeasurementsGridHarness initialRows={[ROW]} gridColumns={GRID_COLUMNS} renderAboveGrid={renderAboveGrid} />);
    await waitFor(() => expect(ctx.grid).not.toBeNull());
    act(() => (ctx.grid?.onFilterModelChange as (model: unknown) => void)({ items: [{ id: 1, field: 'treeTag', operator: 'contains', value: '01' }] }));
    renderRowActions(ROW);
    await user.click(screen.getByRole('button', { name: new RegExp(VIEW_DATA_TEXT.detailsFor('010203', '1')) }));
    expect(await screen.findByRole('heading', { name: 'Measurement 501' })).toBeInTheDocument();
    act(() => (ctx.grid?.onRowModesModelChange as (model: unknown) => void)({ 1: { mode: 'edit' } }));
    switchCensus(rerender);
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Measurement 501' })).not.toBeInTheDocument());
    await waitFor(() => expect((ctx.grid?.filterModel as { items: unknown[] }).items).toEqual([]));
    console.log('[census switch] row modes', JSON.stringify(ctx.grid?.rowModesModel));
    expect((ctx.grid?.rowModesModel as Record<string, unknown>)[1]).toEqual({ mode: 'view', ignoreModifications: true });
  });

  describe('with the real edit flow (A25; View Errors Task 16)', () => {
    const PREVIEW_URL = '/api/edits/preview';
    const APPLY_URL = '/api/edits/apply';
    const REVERT_URL = '/api/edits/revert';
    const HASH_DRIFT_STATUS = 409;
    const OLD_CENSUS_ID = 1;
    const WARNING_PLAN = {
      dataType: 'measurementssummary',
      targetID: ROW.coreMeasurementID,
      fieldChanges: [{ field: 'MeasuredDBH', from: ROW.measuredDBH, to: EDITED_DBH }],
      effects: [
        {
          id: 'linked-stem',
          severity: 'warn',
          category: 'cross-row',
          title: 'Changed linked stem',
          detail: 'A linked stem would also change.',
          affectedTable: 'stems',
          affectedRowCount: 1
        }
      ],
      maxSeverity: 'warn',
      planHash: 'b'.repeat(64),
      generatedAt: '2026-11-04T00:00:00.000Z'
    };
    const APPLY_RESULT = {
      updatedIDs: { coremeasurements: ROW.coreMeasurementID },
      applyErrors: [],
      editOperationID: UNDO_EDIT_OPERATION_ID,
      validationPending: false
    };
    const NOT_SAVED = VIEW_DATA_TEXT.editNotSavedCensusChanged(ROW.treeTag, ROW.stemTag);

    interface PendingResponse {
      settle: (response: Response) => void;
      signal: AbortSignal | null | undefined;
    }
    let previewAnswer: (init?: RequestInit) => Promise<Response>;
    let applyAnswer: (init?: RequestInit) => Promise<Response>;
    let pendingPreview: PendingResponse | null;
    let pendingApply: PendingResponse | null;

    const editJson = (body: unknown, status: number = HTTPResponses.OK) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    function holdResponse(init: RequestInit | undefined, keep: (pending: PendingResponse) => void): Promise<Response> {
      return new Promise<Response>((resolve, reject) => {
        keep({ settle: resolve, signal: init?.signal });
        init?.signal?.addEventListener('abort', () => reject(new DOMException('The preview was aborted', 'AbortError')));
      });
    }
    const requestsTo = (url: string) => fetchMock.mock.calls.filter(([requestUrl]) => String(requestUrl) === url);
    const rowsInEditMode = () =>
      Object.entries((ctx.grid?.rowModesModel ?? {}) as Record<string, { mode: string }>)
        .filter(([, model]) => model.mode === 'edit')
        .map(([id]) => id);
    const openDialogNames = () => screen.queryAllByRole('dialog').map(dialog => dialog.getAttribute('aria-label') ?? dialog.getAttribute('aria-labelledby'));
    const confirmSave = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: 'Confirm save' }));

    async function renderWithRealHook() {
      const view = render(<MeasurementsGridHarness initialRows={[ROW]} gridColumns={GRID_COLUMNS} renderAboveGrid={renderAboveGrid} />);
      await waitFor(() => expect(ctx.grid).not.toBeNull());
      return view;
    }

    /** The common end state after a census switch: nothing in edit mode, no dialog, the save settled with the unchanged row. */
    async function expectSwitchSettled(label: string, saveSettled: Promise<void>) {
      await saveSettled;
      await waitFor(() => expect(openDialogNames()).toEqual([]));
      const observed = {
        rowsInEditMode: rowsInEditMode(),
        dialogs: openDialogNames(),
        previews: requestsTo(PREVIEW_URL).length,
        applies: requestsTo(APPLY_URL).length
      };
      console.log(`[census switch, real hook] ${label}`, JSON.stringify(observed));
      expect(observed.rowsInEditMode).toEqual([]);
      return observed;
    }

    beforeEach(() => {
      // COUNTS_ROW makes refreshCounts post its own snackbar on a census change, which would replace the not-saved message.
      countsRow = NO_SNACKBAR_COUNTS_ROW;
      ctx.useRealEditPreviewFlow = true;
      ctx.session.data.user.userStatus = 'global';
      pendingPreview = null;
      pendingApply = null;
      previewAnswer = async () => editJson(WARNING_PLAN);
      applyAnswer = async () => editJson(APPLY_RESULT);
      fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === PREVIEW_URL) return previewAnswer(init);
        if (url === APPLY_URL) return applyAnswer(init);
        return route(input, init);
      });
    });

    afterEach(() => {
      ctx.useRealEditPreviewFlow = false;
    });

    it('Save Changes confirmation open (nothing sent, result none): closes it, sends no preview and says the edit was not saved', async () => {
      const user = userEvent.setup();
      const { rerender } = await renderWithRealHook();
      const { pendingSave } = await startEditAndOpenSaveConfirmation(user);
      const saveSettled = expect(pendingSave).resolves.toEqual(ROW);
      switchCensus(rerender);
      const observed = await expectSwitchSettled('save confirmation open', saveSettled);
      expect(await screen.findByText(NOT_SAVED)).toBeInTheDocument();
      console.log('[census switch, real hook] final check: save confirmation open', JSON.stringify(observed));
      expect(observed).toMatchObject({ previews: 0, applies: 0 });
    });

    it('preview in flight (cancelled-before-apply): aborts the preview request, sends no apply and says the edit was not saved', async () => {
      const user = userEvent.setup();
      previewAnswer = init => holdResponse(init, pending => (pendingPreview = pending));
      const { rerender } = await renderWithRealHook();
      const { pendingSave } = await startEditAndOpenSaveConfirmation(user);
      const saveSettled = expect(pendingSave).resolves.toEqual(ROW);
      await confirmSave(user);
      await waitFor(() => expect(pendingPreview).not.toBeNull());
      switchCensus(rerender);
      const observed = await expectSwitchSettled('preview in flight', saveSettled);
      expect(await screen.findByText(NOT_SAVED)).toBeInTheDocument();
      expect(pendingPreview?.signal?.aborted).toBe(true);
      console.log('[census switch, real hook] final check: preview in flight', JSON.stringify(observed));
      expect(observed).toMatchObject({ previews: 1, applies: 0 });
    });

    it('preview dialog open (cancelled-before-apply): closes the dialog, sends no apply and says the edit was not saved', async () => {
      const user = userEvent.setup();
      const { rerender } = await renderWithRealHook();
      const { pendingSave } = await startEditAndOpenSaveConfirmation(user);
      const saveSettled = expect(pendingSave).resolves.toEqual(ROW);
      await confirmSave(user);
      expect(await screen.findByTestId('edit-preview-apply')).toBeInTheDocument();
      switchCensus(rerender);
      const observed = await expectSwitchSettled('preview dialog open', saveSettled);
      expect(await screen.findByText(NOT_SAVED)).toBeInTheDocument();
      expect(screen.queryByTestId('edit-preview-apply')).not.toBeInTheDocument();
      console.log('[census switch, real hook] final check: preview dialog open', JSON.stringify(observed));
      expect(observed).toMatchObject({ previews: 1, applies: 0 });
    });

    it('confirmed apply in flight, then 409 (detached-apply): the dialog closes and does not reopen, one apply only, not saved', async () => {
      const user = userEvent.setup();
      applyAnswer = init => holdResponse(init, pending => (pendingApply = pending));
      const { rerender } = await renderWithRealHook();
      const { pendingSave } = await startEditAndOpenSaveConfirmation(user);
      const saveSettled = expect(pendingSave).resolves.toEqual(ROW);
      await confirmSave(user);
      await user.click(await screen.findByTestId('edit-preview-apply'));
      await waitFor(() => expect(pendingApply).not.toBeNull());
      switchCensus(rerender);
      await waitFor(() => expect(screen.queryByTestId('edit-preview-apply')).not.toBeInTheDocument());
      await act(async () => pendingApply?.settle(editJson({ freshPlan: WARNING_PLAN }, HASH_DRIFT_STATUS)));
      expect(await screen.findByText(NOT_SAVED)).toBeInTheDocument();
      const observed = await expectSwitchSettled('apply in flight, then 409', saveSettled);
      expect(screen.queryByTestId('edit-preview-apply')).not.toBeInTheDocument();
      console.log('[census switch, real hook] final check: apply in flight, then 409', JSON.stringify(observed));
      expect(observed).toMatchObject({ previews: 1, applies: 1 });
    });

    it('confirmed apply in flight, then success (detached-apply): no local patch, "Row updated", and Undo reverts in the census the edit was made in', async () => {
      const user = userEvent.setup();
      applyAnswer = init => holdResponse(init, pending => (pendingApply = pending));
      const { rerender } = await renderWithRealHook();
      const { pendingSave } = await startEditAndOpenSaveConfirmation(user);
      const saveSettled = expect(pendingSave).resolves.toEqual(ROW);
      await confirmSave(user);
      await user.click(await screen.findByTestId('edit-preview-apply'));
      await waitFor(() => expect(pendingApply).not.toBeNull());
      switchCensus(rerender);
      await act(async () => pendingApply?.settle(editJson(APPLY_RESULT)));
      expect(await screen.findByText(ROW_UPDATED_MESSAGE)).toBeInTheDocument();
      const observed = await expectSwitchSettled('apply in flight, then success', saveSettled);
      expect(observed).toMatchObject({ previews: 1, applies: 1 });
      await user.click(await screen.findByRole('button', { name: 'Undo' }));
      const revertCall = await waitFor(() => {
        const call = requestsTo(REVERT_URL)[0];
        expect(call).toBeDefined();
        return call as [string, RequestInit];
      });
      console.log('[census switch, real hook] undo body', String(revertCall[1].body));
      expect(JSON.parse(String(revertCall[1].body))).toMatchObject({ censusID: OLD_CENSUS_ID, editOperationID: UNDO_EDIT_OPERATION_ID });
    });

    it("a late census-A apply response leaves census B's open Save Changes confirmation alone, and B then saves (R3-P2-2)", async () => {
      const user = userEvent.setup();
      let applyCalls = 0;
      applyAnswer = init => {
        applyCalls += 1;
        return applyCalls === 1 ? holdResponse(init, pending => (pendingApply = pending)) : Promise.resolve(editJson(APPLY_RESULT));
      };
      const { rerender } = await renderWithRealHook();
      const { pendingSave: censusASave } = await startEditAndOpenSaveConfirmation(user);
      const censusASettled = expect(censusASave).resolves.toEqual(ROW);
      await confirmSave(user);
      await user.click(await screen.findByTestId('edit-preview-apply'));
      await waitFor(() => expect(pendingApply).not.toBeNull());
      switchCensus(rerender, [CENSUS_B_ROW]);
      await waitFor(() => expect(screen.queryByTestId('edit-preview-apply')).not.toBeInTheDocument());
      await censusASettled;
      const { pendingSave: censusBSave } = await startEditAndOpenSaveConfirmation(user, CENSUS_B_ROW);
      const censusBSettled = expect(censusBSave).resolves.toMatchObject({ coreMeasurementID: CENSUS_B_ROW.coreMeasurementID });
      // Census A's detached apply answers only now, while census B's confirmation is open.
      await act(async () => pendingApply?.settle(editJson({ freshPlan: WARNING_PLAN }, HASH_DRIFT_STATUS)));
      expect(await screen.findByText(NOT_SAVED)).toBeInTheDocument();
      const afterLateResponse = {
        censusBConfirmationOpen: screen.queryByRole('dialog', { name: 'Save confirmation' }) !== null,
        applies: requestsTo(APPLY_URL).length
      };
      console.log('[census switch, real hook] after the late census-A response', JSON.stringify(afterLateResponse));
      expect(afterLateResponse).toEqual({ censusBConfirmationOpen: true, applies: 1 });
      await confirmSave(user);
      await user.click(await screen.findByTestId('edit-preview-apply'));
      const observed = await expectSwitchSettled('census B save after a late census-A response', censusBSettled);
      const censusBApplyBody = JSON.parse(String((requestsTo(APPLY_URL)[1] as [string, RequestInit])[1].body));
      console.log('[census switch, real hook] census B apply body', JSON.stringify({ observed, censusBApplyBody }));
      expect(observed).toMatchObject({ previews: 2, applies: 2 });
      expect(censusBApplyBody).toMatchObject({ censusID: NEW_CENSUS_ID, targetID: CENSUS_B_ROW.coreMeasurementID });
      expect(await screen.findByText(ROW_UPDATED_MESSAGE)).toBeInTheDocument();
    });
  });
});
