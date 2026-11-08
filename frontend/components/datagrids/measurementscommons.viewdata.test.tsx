import React from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GridColDef } from '@mui/x-data-grid';
import { MeasurementsGridHarness } from './measurementscommons.harness';
import type { ViewDataAboveGridControls } from '@/components/viewdata/viewdatacontrols';
import ViewDataGridToolbar from '@/components/viewdata/viewdatagridtoolbar';
import { VIEW_DATA_COLUMN_ORDER, VIEW_DATA_DEFAULT_HIDDEN_COLUMNS, VIEW_DATA_ROW_HEIGHT, VIEW_DATA_TEXT } from '@/config/viewdata';
import { ALWAYS_VISIBLE_COLUMN_MENU_SX } from '@/config/styleddatagrid';
import { CLEAR_VALIDATION_ERRORS_SUCCESS, DETAILS_SHEET_TEXT, formatTreeStemLine } from '@/config/errorsexplorer';
import { PENDING_VALIDATION_SNACKBAR_MESSAGE, ROW_DELETED_MESSAGE, ROW_UPDATED_MESSAGE, UNRESOLVED_ERRORS_SNACKBAR_MESSAGE } from './measurementscommonsutils';
import { INFINITE_DEFAULT_CHUNK } from './hooks/useinfinitegridrows';
import type { ViewDataRowDetailsProps } from '@/components/viewdata/viewdatarowdetails';
import { HTTPResponses } from '@/config/macros';
import { MUI_ROW_EDIT_CANCELLED_MESSAGE } from '@/lib/muirowedit';

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
    grid: null as null | Record<string, unknown>,
    sheetProps: null as null | ViewDataRowDetailsProps
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
// Renders the real sheet and keeps its latest props, so a test can call a handler the sheet would have refused to call.
vi.mock('@/components/viewdata/viewdatarowdetails', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/viewdata/viewdatarowdetails')>();
  const RealSheet = actual.default;
  return {
    ...actual,
    default: (props: ViewDataRowDetailsProps) => {
      ctx.sheetProps = props;
      return <RealSheet {...props} />;
    }
  };
});
// Renders the real sheet and keeps its latest props, so a test can call a handler the sheet would have refused to call.
vi.mock('@/components/viewdata/viewdatarowdetails', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/viewdata/viewdatarowdetails')>();
  const RealSheet = actual.default;
  return {
    ...actual,
    default: (props: ViewDataRowDetailsProps) => {
      ctx.sheetProps = props;
      return <RealSheet {...props} />;
    }
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

const ZERO_COUNTS_ROW = { CountUnresolvedLogged: 0, CountFailedNoLog: 0, CountPending: 0, CountValid: 0 };
const FIXED_DATA_URL_PREFIX = '/api/fixeddata/measurementssummary/testschema/';
const REFRESH_VIEWS_URL_PREFIX = '/api/refreshviews';
const CLEAR_ERRORS_URL = '/api/validations/clearmeasurementerrors';
const VALIDATION_ERRORS_URL_PREFIX = '/api/validations/validationerrordisplay';
const PLOT_ID = 1;
const DELETE_METHOD = 'DELETE';
const SERVER_ERROR_STATUS = 500;
const LATE_READ_WAIT_MS = 100;

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

const deleteRequests = () =>
  fetchMock.mock.calls.filter(([url, init]) => String(url).startsWith(FIXED_DATA_URL_PREFIX) && (init as RequestInit | undefined)?.method === DELETE_METHOD);
const viewRebuildRequests = () => fetchMock.mock.calls.filter(([url]) => String(url).startsWith(REFRESH_VIEWS_URL_PREFIX));
/** A read that belongs to one census: its grid page, its validation errors or its counts query. */
const readsOfCensus = (plotCensusNumber: number) =>
  fetchMock.mock.calls
    .filter(([url, init]) => {
      const requestUrl = String(url);
      if (requestUrl.startsWith(GRID_URL_PREFIX)) return requestUrl.endsWith(`/${PLOT_ID}/${plotCensusNumber}`);
      if (requestUrl.startsWith(VALIDATION_ERRORS_URL_PREFIX)) return requestUrl.includes(`censusPCNParam=${plotCensusNumber}`);
      const body = String((init as RequestInit | undefined)?.body ?? '');
      return requestUrl === QUERY_URL && body.includes(COUNTS_MARKER) && body.includes(`PlotCensusNumber = ${plotCensusNumber}`);
    })
    .map(([url, init]) => `${String(url)} ${String((init as RequestInit | undefined)?.method ?? 'GET')}`);

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
    const columnFilterItems = () => (ctx.grid?.filterModel as { items: unknown[] }).items;
    act(() => (ctx.grid?.onFilterModelChange as (model: unknown) => void)({ items: [{ id: 1, field: 'treeTag', operator: 'contains', value: 'x' }] }));
    await waitFor(() => expect(columnFilterItems()).toHaveLength(1));
    console.log('[page controls] before clear', JSON.stringify({ items: columnFilterItems() }));
    await user.click(screen.getByRole('button', { name: VIEW_DATA_TEXT.clearFilters }));
    await waitFor(() => expect(latestControls().showOption).toBe('all'));
    console.log(
      '[page controls] after clear',
      JSON.stringify({ show: latestControls().showOption, search: latestControls().searchText, items: columnFilterItems() })
    );
    expect(latestControls().searchText).toBe('');
    expect(latestControls().appliedSearchText).toBe('');
    expect(columnFilterItems()).toEqual([]);
  });
});

describe('MeasurementsCommons View Data details sheet', () => {
  beforeEach(() => {
    controlsLog.length = 0;
    countsRow = COUNTS_ROW;
    ctx.grid = null;
    ctx.sheetProps = null;
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

  async function openSheetForRow(user: ReturnType<typeof userEvent.setup>, row: typeof ROW) {
    renderRowActions(row);
    await user.click(screen.getByRole('button', { name: new RegExp(VIEW_DATA_TEXT.detailsFor(row.treeTag, row.stemTag)) }));
    return screen.findByRole('heading', { name: `Measurement ${row.coreMeasurementID}` });
  }

  async function turnInfiniteScrollOn() {
    const infiniteScroll = () =>
      (ctx.grid?.slots as { pagination: { infiniteScroll: { onToggle: (next: boolean) => void; enabled: boolean } } }).pagination.infiniteScroll;
    act(() => infiniteScroll().onToggle(true));
    await waitFor(() => expect(gridRequests().some(request => request.url.includes(`/${INFINITE_DEFAULT_CHUNK}/`))).toBe(true));
    await waitFor(() => expect(infiniteScroll().enabled).toBe(true));
  }

  it('reports a failed ROWS re-read after a clear instead of swallowing it', async () => {
    const user = userEvent.setup();
    const invalidRow = { ...ROW, measurementStatus: 'invalidNoLog' };
    let cleared = false;
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === CLEAR_ERRORS_URL) {
        cleared = true;
        return Promise.resolve(respond({ clearedErrorCount: 0 }));
      }
      if (cleared && String(input).startsWith(GRID_URL_PREFIX)) {
        return Promise.resolve({ ok: false, status: SERVER_ERROR_STATUS, json: async () => ({}) } as Response);
      }
      if (String(input).startsWith(GRID_URL_PREFIX)) return Promise.resolve(respond({ output: [invalidRow], totalCount: 1 }));
      return route(input, init);
    });
    render(<MeasurementsGridHarness initialRows={[invalidRow]} gridColumns={GRID_COLUMNS} renderAboveGrid={renderAboveGrid} />);
    await waitFor(() => expect(ctx.grid).not.toBeNull());
    await openSheetForRow(user, invalidRow);
    await user.click(await screen.findByRole('button', { name: 'Clear validation errors' }));
    console.log('[sheet] rows re-read failure, visible alerts', JSON.stringify(screen.queryAllByRole('alert').map(alert => alert.textContent)));
    expect(await screen.findByText(VIEW_DATA_TEXT.clearRefreshFailed)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: VIEW_DATA_TEXT.retryRefresh })).toBeInTheDocument();
  });

  it('reports a failed infinite-rows re-read after a clear even though the paginated re-read succeeds', async () => {
    const user = userEvent.setup();
    const invalidRow = { ...ROW, measurementStatus: 'invalidNoLog' };
    let cleared = false;
    const infiniteChunkSegment = `/${INFINITE_DEFAULT_CHUNK}/`;
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === CLEAR_ERRORS_URL) {
        cleared = true;
        return Promise.resolve(respond({ clearedErrorCount: 0 }));
      }
      if (String(input).startsWith(GRID_URL_PREFIX)) {
        const isInfiniteRead = String(input).includes(infiniteChunkSegment);
        if (cleared && isInfiniteRead) return Promise.resolve({ ok: false, status: SERVER_ERROR_STATUS, json: async () => ({}) } as Response);
        return Promise.resolve(respond({ output: [invalidRow], totalCount: 1 }));
      }
      return route(input, init);
    });
    render(<MeasurementsGridHarness initialRows={[invalidRow]} gridColumns={GRID_COLUMNS} renderAboveGrid={renderAboveGrid} enableInfiniteScroll />);
    await waitFor(() => expect(ctx.grid).not.toBeNull());
    await turnInfiniteScrollOn();
    await openSheetForRow(user, invalidRow);
    await user.click(await screen.findByRole('button', { name: 'Clear validation errors' }));
    console.log('[sheet] infinite re-read failure, visible alerts', JSON.stringify(screen.queryAllByRole('alert').map(alert => alert.textContent)));
    expect(await screen.findByText(VIEW_DATA_TEXT.clearRefreshFailed)).toBeInTheDocument();
  });

  it('deleting from the sheet closes it, sends the delete, rebuilds the view, re-reads the counts and says the row was deleted', async () => {
    const user = userEvent.setup();
    countsRow = ZERO_COUNTS_ROW;
    render(<MeasurementsGridHarness initialRows={[ROW]} gridColumns={GRID_COLUMNS} renderAboveGrid={renderAboveGrid} />);
    await waitFor(() => expect(ctx.grid).not.toBeNull());
    await waitFor(() => expect(countRequests().length).toBeGreaterThan(0));
    await openSheetForRow(user, ROW);
    await user.click(await screen.findByRole('button', { name: VIEW_DATA_TEXT.deleteMeasurement }));
    const countsBeforeDelete = countRequests().length;
    await user.click(screen.getByRole('button', { name: VIEW_DATA_TEXT.deleteConfirm }));
    await waitFor(() => expect(countRequests().length).toBeGreaterThan(countsBeforeDelete));
    console.log(
      '[sheet] after delete',
      JSON.stringify({
        deletes: deleteRequests().map(([url]) => String(url)),
        rebuilds: viewRebuildRequests().map(([url]) => String(url)),
        counts: [countsBeforeDelete, countRequests().length],
        sheetOpen: screen.queryByRole('heading', { name: 'Measurement 501' }) !== null,
        alerts: screen.queryAllByRole('alert').map(alert => alert.textContent)
      })
    );
    expect(deleteRequests()).toHaveLength(1);
    expect(viewRebuildRequests()).toHaveLength(1);
    expect(await screen.findByText(ROW_DELETED_MESSAGE)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Measurement 501' })).not.toBeInTheDocument());
  });

  it('keeps the Row deleted message on screen after the counts re-read settles, even when the counts have unresolved errors', async () => {
    const user = userEvent.setup();
    render(<MeasurementsGridHarness initialRows={[ROW]} gridColumns={GRID_COLUMNS} renderAboveGrid={renderAboveGrid} />);
    await waitFor(() => expect(ctx.grid).not.toBeNull());
    await waitFor(() => expect(countRequests().length).toBeGreaterThan(0));
    await openSheetForRow(user, ROW);
    await user.click(await screen.findByRole('button', { name: VIEW_DATA_TEXT.deleteMeasurement }));
    const countsBeforeDelete = countRequests().length;
    await user.click(screen.getByRole('button', { name: VIEW_DATA_TEXT.deleteConfirm }));
    await waitFor(() => expect(countRequests().length).toBeGreaterThan(countsBeforeDelete));
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, LATE_READ_WAIT_MS));
    });
    const visibleAlerts = screen.queryAllByRole('alert').map(alert => alert.textContent);
    console.log('[sheet] after delete with unresolved counts', JSON.stringify({ visibleAlerts, countsRequests: [countsBeforeDelete, countRequests().length] }));
    expect(visibleAlerts).toEqual([ROW_DELETED_MESSAGE]);
  });

  it('still replaces a counts message with the newer counts message', async () => {
    const PENDING_ONLY_COUNT = 5;
    const { rerender } = render(<MeasurementsGridHarness initialRows={[ROW]} gridColumns={GRID_COLUMNS} renderAboveGrid={renderAboveGrid} />);
    expect(await screen.findByText(UNRESOLVED_ERRORS_SNACKBAR_MESSAGE(COUNTS_ROW.CountUnresolvedLogged))).toBeInTheDocument();
    countsRow = { CountUnresolvedLogged: 0, CountFailedNoLog: 0, CountPending: PENDING_ONLY_COUNT, CountValid: 0 };
    switchCensus(rerender);
    await screen.findByText(PENDING_VALIDATION_SNACKBAR_MESSAGE(PENDING_ONLY_COUNT));
    const visibleAlerts = screen.queryAllByRole('alert').map(alert => alert.textContent);
    console.log('[counts snackbar] after the counts changed', JSON.stringify(visibleAlerts));
    expect(visibleAlerts).toEqual([PENDING_VALIDATION_SNACKBAR_MESSAGE(PENDING_ONLY_COUNT)]);
  });

  describe('deleting from the sheet: server failures and infinite scrolling', () => {
    const BAD_GATEWAY_STATUS = 502;
    const BAD_GATEWAY_HTML = '<html><body>502 Bad Gateway</body></html>';
    const DELETE_FAILED_FALLBACK_MESSAGE = 'Error: Deletion failed';
    const LOADED_ROW_COUNT = 12;
    const PAGINATED_PAGE_SIZE = 10;
    const loadedRows = Array.from({ length: LOADED_ROW_COUNT }, (_, index) => ({
      ...ROW,
      id: index + 1,
      coreMeasurementID: 500 + index + 1,
      treeTag: `0102${String(index + 1).padStart(2, '0')}`
    }));
    const lastLoadedRow = loadedRows[LOADED_ROW_COUNT - 1];
    let serverRows: typeof loadedRows;

    /** A server that pages like the real one and forgets a row once it is deleted. */
    function serveRows(onDelete?: (init: RequestInit | undefined) => Response | null) {
      fetchMock.mockImplementation((input: RequestInit | URL | string, init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith(FIXED_DATA_URL_PREFIX) && init?.method === DELETE_METHOD) {
          const failure = onDelete?.(init);
          if (failure) return Promise.resolve(failure);
          const deletedID = (JSON.parse(String(init.body)) as { newRow: { id: number } }).newRow.id;
          serverRows = serverRows.filter(row => row.id !== deletedID);
          return Promise.resolve(respond({}));
        }
        if (url.startsWith(GRID_URL_PREFIX)) {
          const [page, pageSize] = url.slice(GRID_URL_PREFIX.length).split('/').map(Number);
          return Promise.resolve(respond({ output: serverRows.slice(page * pageSize, (page + 1) * pageSize), totalCount: serverRows.length }));
        }
        return route(url, init);
      });
    }

    const gridRowIDs = () => (ctx.grid?.rows as Array<{ id: number }>).map(row => row.id);

    beforeEach(() => {
      serverRows = loadedRows;
      countsRow = ZERO_COUNTS_ROW;
    });

    it('reports a delete that fails with a non-JSON body instead of rejecting unhandled, and leaves the sheet open', async () => {
      const user = userEvent.setup();
      serveRows(() => new Response(BAD_GATEWAY_HTML, { status: BAD_GATEWAY_STATUS }));
      render(<MeasurementsGridHarness initialRows={serverRows.slice(0, PAGINATED_PAGE_SIZE)} gridColumns={GRID_COLUMNS} renderAboveGrid={renderAboveGrid} />);
      await waitFor(() => expect(ctx.grid).not.toBeNull());
      await openSheetForRow(user, ROW);
      await user.click(await screen.findByRole('button', { name: VIEW_DATA_TEXT.deleteMeasurement }));
      await user.click(screen.getByRole('button', { name: VIEW_DATA_TEXT.deleteConfirm }));
      await waitFor(() => expect(deleteRequests()).toHaveLength(1));
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, LATE_READ_WAIT_MS));
      });
      // The open sheet is modal and hides the rest of the page from the accessibility tree, the snackbar included.
      const visibleAlerts = screen.queryAllByRole('alert', { hidden: true }).map(alert => alert.textContent);
      console.log(
        '[sheet] delete answered with an HTML 502',
        JSON.stringify({ visibleAlerts, sheetOpen: screen.queryByRole('heading', { name: 'Measurement 501' }) !== null })
      );
      expect(visibleAlerts).toEqual([DELETE_FAILED_FALLBACK_MESSAGE]);
      expect(screen.getByRole('heading', { name: 'Measurement 501' })).toBeInTheDocument();
    });

    it('infinite mode: deletes a loaded row that is past the first page of the paginated grid and removes it from the grid', async () => {
      const user = userEvent.setup();
      serveRows();
      render(
        <MeasurementsGridHarness
          initialRows={serverRows.slice(0, PAGINATED_PAGE_SIZE)}
          gridColumns={GRID_COLUMNS}
          renderAboveGrid={renderAboveGrid}
          enableInfiniteScroll
        />
      );
      await waitFor(() => expect(ctx.grid).not.toBeNull());
      await turnInfiniteScrollOn();
      await waitFor(() => expect(gridRowIDs()).toContain(lastLoadedRow.id));
      await openSheetForRow(user, lastLoadedRow);
      await user.click(await screen.findByRole('button', { name: VIEW_DATA_TEXT.deleteMeasurement }));
      await user.click(screen.getByRole('button', { name: VIEW_DATA_TEXT.deleteConfirm }));
      await waitFor(() => expect(screen.queryByRole('heading', { name: `Measurement ${lastLoadedRow.coreMeasurementID}` })).not.toBeInTheDocument());
      console.log(
        '[sheet] infinite delete of a row past the first page',
        JSON.stringify({ deletes: deleteRequests().length, gridRowIDs: gridRowIDs(), alerts: screen.queryAllByRole('alert').map(alert => alert.textContent) })
      );
      expect(deleteRequests()).toHaveLength(1);
      expect(screen.getByText(ROW_DELETED_MESSAGE)).toBeInTheDocument();
      expect(gridRowIDs()).not.toContain(lastLoadedRow.id);
      expect(gridRowIDs()).toHaveLength(LOADED_ROW_COUNT - 1);
    });

    it('infinite mode: a deleted first-page row leaves the grid at once, without waiting for any re-read', async () => {
      const user = userEvent.setup();
      serveRows();
      render(
        <MeasurementsGridHarness
          initialRows={serverRows.slice(0, PAGINATED_PAGE_SIZE)}
          gridColumns={GRID_COLUMNS}
          renderAboveGrid={renderAboveGrid}
          enableInfiniteScroll
        />
      );
      await waitFor(() => expect(ctx.grid).not.toBeNull());
      await turnInfiniteScrollOn();
      await waitFor(() => expect(gridRowIDs()).toHaveLength(LOADED_ROW_COUNT));
      const infiniteReadsBeforeDelete = gridRequests().filter(request => request.url.includes(`/${INFINITE_DEFAULT_CHUNK}/`)).length;
      await openSheetForRow(user, ROW);
      await user.click(await screen.findByRole('button', { name: VIEW_DATA_TEXT.deleteMeasurement }));
      await user.click(screen.getByRole('button', { name: VIEW_DATA_TEXT.deleteConfirm }));
      await waitFor(() => expect(gridRowIDs()).not.toContain(ROW.id));
      const infiniteReadsAfterDelete = gridRequests().filter(request => request.url.includes(`/${INFINITE_DEFAULT_CHUNK}/`)).length;
      console.log(
        '[sheet] infinite delete of a first-page row',
        JSON.stringify({ gridRowIDs: gridRowIDs(), infiniteReads: [infiniteReadsBeforeDelete, infiniteReadsAfterDelete] })
      );
      expect(gridRowIDs()).toHaveLength(LOADED_ROW_COUNT - 1);
      expect(infiniteReadsAfterDelete).toBe(infiniteReadsBeforeDelete);
    });
  });

  describe('the sheet delete handler guards itself, even when the sheet is bypassed', () => {
    async function cancelEditOnRow(user: ReturnType<typeof userEvent.setup>, row: typeof ROW) {
      act(() => (ctx.grid?.onRowModesModelChange as (model: unknown) => void)({ [row.id]: { mode: 'edit' } }));
      await waitFor(() => expect((ctx.grid?.rowModesModel as Record<string, { mode: string }>)[row.id]?.mode).toBe('edit'));
      const editingActions = renderRowActions(row);
      await user.click(within(editingActions.container).getByRole('button', { name: VIEW_DATA_TEXT.cancelRow }));
      await waitFor(() => expect((ctx.grid?.rowModesModel as Record<string, { mode: string }>)[row.id]?.mode).toBe('view'));
    }

    async function callSheetDelete() {
      const sheetProps = ctx.sheetProps as ViewDataRowDetailsProps;
      await act(async () => sheetProps.onDeleteRow(ROW.coreMeasurementID));
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, LATE_READ_WAIT_MS));
      });
    }

    it('refuses while a row is in edit mode', async () => {
      const user = userEvent.setup();
      render(<MeasurementsGridHarness initialRows={[ROW]} gridColumns={GRID_COLUMNS} renderAboveGrid={renderAboveGrid} />);
      await waitFor(() => expect(ctx.grid).not.toBeNull());
      await openSheetForRow(user, ROW);
      act(() => (ctx.grid?.onRowModesModelChange as (model: unknown) => void)({ [ROW.id]: { mode: 'edit' } }));
      await waitFor(() => expect(ctx.sheetProps?.isAnyRowEditing).toBe(true));
      await callSheetDelete();
      console.log(
        '[sheet] delete during edit',
        JSON.stringify({ deletes: deleteRequests().length, alerts: screen.queryAllByRole('alert').map(a => a.textContent) })
      );
      expect(deleteRequests()).toHaveLength(0);
      expect(screen.queryByText(ROW_DELETED_MESSAGE)).not.toBeInTheDocument();
    });

    it('refuses inside the delete-after-Cancel guard window', async () => {
      const user = userEvent.setup();
      render(<MeasurementsGridHarness initialRows={[ROW]} gridColumns={GRID_COLUMNS} renderAboveGrid={renderAboveGrid} />);
      await waitFor(() => expect(ctx.grid).not.toBeNull());
      await cancelEditOnRow(user, ROW);
      await openSheetForRow(user, ROW);
      await waitFor(() => expect(ctx.sheetProps?.isDeleteGuarded).toBe(true));
      await callSheetDelete();
      console.log(
        '[sheet] delete inside the guard window',
        JSON.stringify({ deletes: deleteRequests().length, alerts: screen.queryAllByRole('alert').map(a => a.textContent) })
      );
      expect(deleteRequests()).toHaveLength(0);
      expect(screen.queryByText(ROW_DELETED_MESSAGE)).not.toBeInTheDocument();
    });
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

  it('does not put the row back in edit mode when a MUI-style cancellation reaches a save after the census changed', async () => {
    const user = userEvent.setup();
    let rejectApply: (error: Error) => void = () => undefined;
    ctx.editPreviewFlow.beginEdit = () =>
      new Promise((_resolve, reject) => {
        rejectApply = reject;
      });
    const { rerender } = render(<MeasurementsGridHarness initialRows={[ROW]} gridColumns={GRID_COLUMNS} renderAboveGrid={renderAboveGrid} />);
    await waitFor(() => expect(ctx.grid).not.toBeNull());
    await startEditAndOpenSaveConfirmation(user);
    await user.click(screen.getByRole('button', { name: 'Confirm save' }));
    switchCensus(rerender);
    await waitFor(() => expect((ctx.grid?.rowModesModel as Record<string, { mode: string }>)[ROW.id]?.mode).toBe('view'));
    await act(async () => {
      rejectApply(new Error(MUI_ROW_EDIT_CANCELLED_MESSAGE));
      await new Promise(resolve => setTimeout(resolve, LATE_READ_WAIT_MS));
    });
    const observed = {
      rowModes: ctx.grid?.rowModesModel,
      alerts: screen.queryAllByRole('alert').map(alert => alert.textContent)
    };
    console.log('[census switch] after a late MUI cancellation', JSON.stringify(observed));
    expect((ctx.grid?.rowModesModel as Record<string, { mode: string }>)[ROW.id]?.mode).toBe('view');
  });

  describe('a Clear or Delete that finishes after a census switch', () => {
    const INVALID_ROW = { ...ROW, measurementStatus: 'invalidNoLog' };
    let releaseHeldResponse: (response: Response) => void;

    /** Serves census 1 and census 2 their own grid page and holds the answer to one URL until the test releases it. */
    function holdAnswerTo(isHeldRequest: (url: string, init?: RequestInit) => boolean) {
      fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (isHeldRequest(url, init)) return new Promise<Response>(resolve => (releaseHeldResponse = resolve));
        if (url.startsWith(GRID_URL_PREFIX)) {
          const isNewCensus = url.endsWith(`/${PLOT_ID}/${NEW_CENSUS_ID}`);
          return Promise.resolve(respond({ output: [isNewCensus ? CENSUS_B_ROW : INVALID_ROW], totalCount: 1 }));
        }
        return route(input, init);
      });
    }

    async function startThenSwitchCensus(start: (user: ReturnType<typeof userEvent.setup>) => Promise<void>) {
      const user = userEvent.setup();
      const view = render(<MeasurementsGridHarness initialRows={[INVALID_ROW]} gridColumns={GRID_COLUMNS} renderAboveGrid={renderAboveGrid} />);
      await waitFor(() => expect(ctx.grid).not.toBeNull());
      await waitFor(() => expect(countRequests().length).toBeGreaterThan(0));
      await openSheetForRow(user, INVALID_ROW);
      await start(user);
      const countsBeforeSwitch = countRequests().length;
      switchCensus(view.rerender, [INVALID_ROW]);
      await waitFor(() => expect(countRequests().length).toBeGreaterThan(countsBeforeSwitch));
      await waitFor(() => expect((ctx.grid?.rows as Array<{ treeTag: string }>)[0]?.treeTag).toBe(CENSUS_B_ROW.treeTag));
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, LATE_READ_WAIT_MS));
      });
    }

    async function releaseAndWaitForLateReads(response: Response) {
      await act(async () => {
        releaseHeldResponse(response);
        await new Promise(resolve => setTimeout(resolve, LATE_READ_WAIT_MS));
      });
    }

    const observeAfterRelease = (label: string, readsBeforeRelease: string[]) => {
      const observed = {
        oldCensusReads: { before: readsBeforeRelease, after: readsOfCensus(1) },
        newCensusGridRows: (ctx.grid?.rows as Array<{ treeTag: string }>).map(row => row.treeTag),
        alerts: screen.queryAllByRole('alert').map(alert => alert.textContent)
      };
      console.log(`[census switch] ${label}`, JSON.stringify(observed));
      return observed;
    };

    it('a Clear that answers after the census switch re-reads nothing from the old census', async () => {
      holdAnswerTo(url => url === CLEAR_ERRORS_URL);
      await startThenSwitchCensus(async user => {
        await user.click(await screen.findByRole('button', { name: 'Clear validation errors' }));
        await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url) === CLEAR_ERRORS_URL)).toBe(true));
      });
      const readsBeforeRelease = readsOfCensus(1);
      await releaseAndWaitForLateReads(respond({ clearedErrorCount: 1 }));
      const observed = observeAfterRelease('late Clear', readsBeforeRelease);
      expect(observed.oldCensusReads.after).toEqual(readsBeforeRelease);
      expect(observed.newCensusGridRows).toEqual([CENSUS_B_ROW.treeTag]);
    });

    it('a Delete that answers after the census switch re-reads nothing from the old census, keeps census B rows and still says the row was deleted', async () => {
      holdAnswerTo((url, init) => url.startsWith(FIXED_DATA_URL_PREFIX) && init?.method === DELETE_METHOD);
      await startThenSwitchCensus(async user => {
        await user.click(await screen.findByRole('button', { name: VIEW_DATA_TEXT.deleteMeasurement }));
        await user.click(screen.getByRole('button', { name: VIEW_DATA_TEXT.deleteConfirm }));
        await waitFor(() => expect(deleteRequests()).toHaveLength(1));
      });
      const readsBeforeRelease = readsOfCensus(1);
      await releaseAndWaitForLateReads(respond({}));
      const observed = observeAfterRelease('late Delete', readsBeforeRelease);
      expect(observed.oldCensusReads.after).toEqual(readsBeforeRelease);
      expect(observed.newCensusGridRows).toEqual([CENSUS_B_ROW.treeTag]);
      expect(observed.alerts).toContain(ROW_DELETED_MESSAGE);
    });
  });

  describe('post-Clear and post-Delete reads that are still in flight when the census switches (stage 7 F1)', () => {
    const INVALID_ROW = { ...ROW, measurementStatus: 'invalidNoLog' };
    const CENSUS_B_FAULTED_ROW = {
      ...CENSUS_B_ROW,
      measurementStatus: 'unresolvedErrors',
      unresolvedErrorCount: 1,
      primaryErrorMessage: 'Flagged;Different species',
      primaryErrorSource: 'validation'
    };
    const CENSUS_A_COUNTS = { CountUnresolvedLogged: 0, CountFailedNoLog: 0, CountPending: 7, CountValid: 0 };
    const CENSUS_B_COUNTS = { CountUnresolvedLogged: 0, CountFailedNoLog: 0, CountPending: 0, CountValid: 9 };
    const CENSUS_B_VALIDATION_FAULTS = {
      failed: [
        {
          coreMeasurementID: CENSUS_B_FAULTED_ROW.coreMeasurementID,
          validationErrorIDs: [1],
          descriptions: ['Flagged;Different species'],
          criteria: ['treeTag']
        }
      ]
    };
    const NO_VALIDATION_FAULTS = { failed: [] };
    const counted = (init: RequestInit | undefined, plotCensusNumber: number) =>
      String(init?.body ?? '').includes(COUNTS_MARKER) && String(init?.body ?? '').includes(`PlotCensusNumber = ${plotCensusNumber}`);

    interface HeldRead {
      isHeld: (url: string, init?: RequestInit) => boolean;
      release: ((response: Response) => void) | null;
      fail: ((error: Error) => void) | null;
    }
    let heldReads: HeldRead[];
    let armed: boolean;

    /** Each census has its own grid page, counts and validation faults; an armed hold keeps back the first matching request. */
    function serveTwoCensuses() {
      fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const held = armed ? heldReads.find(read => read.release === null && read.isHeld(url, init)) : undefined;
        if (held) {
          return new Promise<Response>((resolve, reject) => {
            held.release = resolve;
            held.fail = reject;
          });
        }
        if (url === CLEAR_ERRORS_URL) return Promise.resolve(respond({ clearedErrorCount: 1 }));
        if (url.startsWith(GRID_URL_PREFIX)) {
          const isNewCensus = url.endsWith(`/${PLOT_ID}/${NEW_CENSUS_ID}`);
          return Promise.resolve(respond({ output: [isNewCensus ? CENSUS_B_FAULTED_ROW : INVALID_ROW], totalCount: 1 }));
        }
        if (url === QUERY_URL && String(init?.body ?? '').includes(COUNTS_MARKER)) {
          return Promise.resolve(respond([counted(init, NEW_CENSUS_ID) ? CENSUS_B_COUNTS : CENSUS_A_COUNTS]));
        }
        if (url.startsWith(VALIDATION_ERRORS_URL_PREFIX)) {
          return Promise.resolve(respond(url.includes(`censusPCNParam=${NEW_CENSUS_ID}`) ? CENSUS_B_VALIDATION_FAULTS : NO_VALIDATION_FAULTS));
        }
        return route(input, init);
      });
    }

    const isCensusOneCounts = (url: string, init?: RequestInit) => url === QUERY_URL && counted(init, 1);
    const isCensusOneValidation = (url: string) => url.startsWith(VALIDATION_ERRORS_URL_PREFIX) && url.includes('censusPCNParam=1');
    const isViewRebuild = (url: string) => url.startsWith(REFRESH_VIEWS_URL_PREFIX);

    function holdAndArm(...reads: HeldRead['isHeld'][]): HeldRead[] {
      heldReads = reads.map(isHeld => ({ isHeld, release: null, fail: null }));
      armed = true;
      return heldReads;
    }

    async function switchToCensusB(view: ReturnType<typeof render>) {
      switchCensus(view.rerender, [INVALID_ROW]);
      await waitFor(() => expect(latestControls().stateCounts?.valid).toBe(CENSUS_B_COUNTS.CountValid));
      await waitFor(() => expect((ctx.grid?.rows as Array<{ treeTag: string }>)[0]?.treeTag).toBe(CENSUS_B_ROW.treeTag));
    }

    async function releaseAndSettle(held: HeldRead, response: Response) {
      await waitFor(() => expect(held.release).not.toBeNull());
      await act(async () => {
        held.release?.(response);
        await new Promise(resolve => setTimeout(resolve, LATE_READ_WAIT_MS));
      });
    }

    function isTreeTagFaulted(row: Record<string, unknown>) {
      const treeTagColumn = (ctx.grid?.columns as GridColDef[]).find(column => column.field === 'treeTag') as GridColDef;
      const params = { row, value: row.treeTag, field: 'treeTag', formattedValue: row.treeTag, id: row.id };
      const cell = render(<div>{treeTagColumn.renderCell?.(params as never)}</div>);
      const faulted = screen.getByText(String(row.treeTag)).getAttribute('data-faulted') === 'true';
      cell.unmount();
      return faulted;
    }

    const observeCensusB = (label: string, oldCensusReadsBefore: string[]) => {
      const observed = {
        oldCensusReads: { before: oldCensusReadsBefore, after: readsOfCensus(1) },
        stateCounts: latestControls().stateCounts,
        censusBTreeTagFaulted: isTreeTagFaulted(CENSUS_B_FAULTED_ROW),
        alerts: screen.queryAllByRole('alert', { hidden: true }).map(alert => alert.textContent)
      };
      console.log(`[census switch] ${label}`, JSON.stringify(observed));
      return observed;
    };

    async function renderCensusAWithSheetOpen() {
      const user = userEvent.setup();
      const view = render(<MeasurementsGridHarness initialRows={[INVALID_ROW]} gridColumns={GRID_COLUMNS} renderAboveGrid={renderAboveGrid} />);
      await waitFor(() => expect(ctx.grid).not.toBeNull());
      await waitFor(() => expect(latestControls().stateCounts?.pending).toBe(CENSUS_A_COUNTS.CountPending));
      await openSheetForRow(user, INVALID_ROW);
      return { user, view };
    }

    beforeEach(() => {
      armed = false;
      heldReads = [];
      serveTwoCensuses();
    });

    it('a Delete whose view rebuild finishes after the switch reads nothing more from the old census and keeps census B counts and faults', async () => {
      const { user, view } = await renderCensusAWithSheetOpen();
      const [rebuild] = holdAndArm(isViewRebuild);
      await user.click(await screen.findByRole('button', { name: VIEW_DATA_TEXT.deleteMeasurement }));
      await user.click(screen.getByRole('button', { name: VIEW_DATA_TEXT.deleteConfirm }));
      await waitFor(() => expect(viewRebuildRequests()).toHaveLength(1));
      await switchToCensusB(view);
      const readsBeforeRelease = readsOfCensus(1);
      await releaseAndSettle(rebuild, respond({}));
      const observed = observeCensusB('rebuild finished after the switch', readsBeforeRelease);
      expect(observed.oldCensusReads.after).toEqual(readsBeforeRelease);
      expect(observed.stateCounts?.valid).toBe(CENSUS_B_COUNTS.CountValid);
      expect(observed.stateCounts?.pending).toBe(CENSUS_B_COUNTS.CountPending);
      expect(observed.censusBTreeTagFaulted).toBe(true);
    });

    it('counts and validation reads of a Clear that answer after the switch are discarded: census B counts and faults survive', async () => {
      const { user, view } = await renderCensusAWithSheetOpen();
      const [countsRead, validationRead] = holdAndArm(isCensusOneCounts, isCensusOneValidation);
      await user.click(await screen.findByRole('button', { name: 'Clear validation errors' }));
      await waitFor(() => expect(countsRead.release).not.toBeNull());
      await waitFor(() => expect(validationRead.release).not.toBeNull());
      await switchToCensusB(view);
      const readsBeforeRelease = readsOfCensus(1);
      await releaseAndSettle(countsRead, respond([CENSUS_A_COUNTS]));
      await releaseAndSettle(validationRead, respond(NO_VALIDATION_FAULTS));
      const observed = observeCensusB('counts and validation answered after the switch', readsBeforeRelease);
      expect(observed.oldCensusReads.after).toEqual(readsBeforeRelease);
      expect(observed.stateCounts?.valid).toBe(CENSUS_B_COUNTS.CountValid);
      expect(observed.stateCounts?.pending).toBe(CENSUS_B_COUNTS.CountPending);
      expect(observed.censusBTreeTagFaulted).toBe(true);
    });

    it('a census A counts read that fails after the switch reports nothing in census B', async () => {
      const { user, view } = await renderCensusAWithSheetOpen();
      const [countsRead] = holdAndArm(isCensusOneCounts);
      await user.click(await screen.findByRole('button', { name: 'Clear validation errors' }));
      await waitFor(() => expect(countsRead.release).not.toBeNull());
      await switchToCensusB(view);
      const readsBeforeRelease = readsOfCensus(1);
      await act(async () => {
        countsRead.fail?.(new TypeError('Failed to fetch'));
        await new Promise(resolve => setTimeout(resolve, LATE_READ_WAIT_MS));
      });
      const observed = observeCensusB('counts failed after the switch', readsBeforeRelease);
      expect(observed.alerts).not.toContain(VIEW_DATA_TEXT.clearRefreshFailed);
      expect(observed.stateCounts?.valid).toBe(CENSUS_B_COUNTS.CountValid);
    });
  });

  describe('an open sheet whose row a Clear removes from the filtered page (stage 7 F3)', () => {
    const ERROR_FILTER = JSON.stringify(['errors']);
    const FLAGGED_MESSAGE = 'Flagged;Different species';
    const FLAGGED_ROW = {
      ...ROW,
      measurementStatus: 'unresolvedErrors',
      unresolvedErrorCount: 1,
      primaryErrorMessage: FLAGGED_MESSAGE,
      primaryErrorSource: 'validation'
    };
    const FLAGGED_DETAILS = {
      row: {
        ...FLAGGED_ROW,
        id: FLAGGED_ROW.coreMeasurementID,
        errorMessages: [FLAGGED_MESSAGE],
        errorSources: ['validation'],
        errorFields: ['treeTag'],
        errorCodes: ['7'],
        errorCount: 1,
        hasContradiction: false,
        contradictionTypes: [],
        contradictionType: null,
        contradictionGroupKey: null,
        relatedMeasurementIDs: [],
        isFailedRow: false
      },
      allErrors: [{ source: 'validation', code: '7', message: FLAGGED_MESSAGE, fields: ['treeTag'], comparison: null }],
      relatedRows: []
    };
    const NO_ERRORS_DETAILS = { row: null, allErrors: [], relatedRows: [] };

    it('keeps the tags, the Measurement section and the Pending chip, and keeps Edit and Delete off-page restricted', async () => {
      const user = userEvent.setup();
      let cleared = false;
      fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === CLEAR_ERRORS_URL) {
          cleared = true;
          return Promise.resolve(respond({ clearedErrorCount: 1 }));
        }
        if (url.startsWith('/api/errors/explorer/details/')) return Promise.resolve(respond(cleared ? NO_ERRORS_DETAILS : FLAGGED_DETAILS));
        if (url.startsWith(GRID_URL_PREFIX)) {
          const showsErrorsOnly = JSON.stringify(JSON.parse(String(init?.body)).filterModel.visible) === ERROR_FILTER;
          return Promise.resolve(respond({ output: showsErrorsOnly && !cleared ? [FLAGGED_ROW] : [], totalCount: showsErrorsOnly && !cleared ? 1 : 0 }));
        }
        return route(input, init);
      });
      render(<MeasurementsGridHarness initialRows={[FLAGGED_ROW]} gridColumns={GRID_COLUMNS} renderAboveGrid={renderAboveGrid} />);
      await waitFor(() => expect(ctx.grid).not.toBeNull());
      act(() => latestControls().onShowOptionChange('withErrors'));
      await waitFor(() => expect(gridRequests().some(request => JSON.stringify(request.body.filterModel.visible) === ERROR_FILTER)).toBe(true));
      await openSheetForRow(user, FLAGGED_ROW);
      await user.click(await screen.findByRole('button', { name: 'Clear validation errors' }));
      expect(await screen.findByText(CLEAR_VALIDATION_ERRORS_SUCCESS, undefined, { timeout: 3000 })).toBeInTheDocument();
      await waitFor(() => expect((ctx.grid?.rows as unknown[]).length).toBe(0));
      const statusChips = screen.queryByTestId('view-data-status-chips');
      const observed = {
        gridRows: (ctx.grid?.rows as unknown[]).length,
        sheetGridRow: ctx.sheetProps?.target?.gridRow ?? null,
        measurementSection: screen.queryByTestId('view-data-measurement-section') !== null,
        tagLine: screen.queryByText(formatTreeStemLine(FLAGGED_ROW.treeTag, FLAGGED_ROW.stemTag))?.textContent ?? null,
        dbhField: screen.queryByTestId('measurement-field-measuredDBH')?.textContent ?? null,
        statusChips: statusChips?.textContent ?? null,
        editDisabled: (screen.queryByRole('button', { name: DETAILS_SHEET_TEXT.editThisRow }) as HTMLButtonElement | null)?.disabled ?? 'not offered',
        deleteDisabled: (screen.queryByRole('button', { name: VIEW_DATA_TEXT.deleteMeasurement }) as HTMLButtonElement | null)?.disabled ?? 'not offered'
      };
      console.log('[sheet] after a Clear under With errors', JSON.stringify(observed));
      expect(observed.sheetGridRow).toBeNull();
      expect(observed.measurementSection).toBe(true);
      expect(observed.tagLine).toBe(formatTreeStemLine(FLAGGED_ROW.treeTag, FLAGGED_ROW.stemTag));
      expect(observed.dbhField).toContain(String(FLAGGED_ROW.measuredDBH));
      expect(observed.statusChips).toContain(VIEW_DATA_TEXT.validationPending);
      expect(observed.editDisabled).toBe(true);
      expect(observed.deleteDisabled).toBe(true);
    });
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
    const APPLY_FAILURE_TEXT = 'apply exploded on the server';

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

    /** The census switch makes refreshCounts re-read; with COUNTS_ROW's unresolved errors it posts its own snackbar once it resolves. */
    async function switchCensusAndSettleCountsReread(rerender: (ui: React.ReactElement) => void, rows: Array<Record<string, unknown>> = [ROW]) {
      const countRequestsBeforeSwitch = countRequests().length;
      switchCensus(rerender, rows);
      await waitFor(() => expect(countRequests().length).toBeGreaterThan(countRequestsBeforeSwitch));
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
      });
    }

    const visibleSnackbarTexts = () => screen.queryAllByRole('alert').map(alert => alert.textContent);

    /** Logs what the snackbar shows before asserting, so a replaced message is visible in the failure output. */
    async function expectNotSavedMessage(label: string) {
      try {
        await screen.findByText(NOT_SAVED);
      } finally {
        console.log(`[census switch, real hook] snackbar: ${label}`, JSON.stringify({ expected: NOT_SAVED, visible: visibleSnackbarTexts() }));
      }
      expect(screen.getByText(NOT_SAVED)).toBeInTheDocument();
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
      await switchCensusAndSettleCountsReread(rerender);
      const observed = await expectSwitchSettled('save confirmation open', saveSettled);
      await expectNotSavedMessage('save confirmation open');
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
      await switchCensusAndSettleCountsReread(rerender);
      const observed = await expectSwitchSettled('preview in flight', saveSettled);
      await expectNotSavedMessage('preview in flight');
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
      await switchCensusAndSettleCountsReread(rerender);
      const observed = await expectSwitchSettled('preview dialog open', saveSettled);
      await expectNotSavedMessage('preview dialog open');
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
      await switchCensusAndSettleCountsReread(rerender);
      await waitFor(() => expect(screen.queryByTestId('edit-preview-apply')).not.toBeInTheDocument());
      await act(async () => pendingApply?.settle(editJson({ freshPlan: WARNING_PLAN }, HASH_DRIFT_STATUS)));
      await expectNotSavedMessage('apply in flight, then 409');
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
      await switchCensusAndSettleCountsReread(rerender);
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

    /** Starts a save in census A, holds its apply, switches to census B and returns once B's own re-read has settled. */
    async function startDetachedApplyThenSwitchCensus() {
      const user = userEvent.setup();
      applyAnswer = init => holdResponse(init, pending => (pendingApply = pending));
      const { rerender } = await renderWithRealHook();
      const { pendingSave } = await startEditAndOpenSaveConfirmation(user);
      const saveSettled = expect(pendingSave).resolves.toEqual(ROW);
      await confirmSave(user);
      await user.click(await screen.findByTestId('edit-preview-apply'));
      await waitFor(() => expect(pendingApply).not.toBeNull());
      await switchCensusAndSettleCountsReread(rerender);
      return { saveSettled };
    }

    async function waitForLateReads() {
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, LATE_READ_WAIT_MS));
      });
    }

    it('a detached apply that succeeds after a census change sends no grid, counts or validation request to the old census', async () => {
      const { saveSettled } = await startDetachedApplyThenSwitchCensus();
      const oldCensusReadsBeforeApplyAnswers = readsOfCensus(OLD_CENSUS_ID);
      await act(async () => pendingApply?.settle(editJson(APPLY_RESULT)));
      expect(await screen.findByText(ROW_UPDATED_MESSAGE)).toBeInTheDocument();
      await expectSwitchSettled('late success, old-census reads', saveSettled);
      await waitForLateReads();
      const oldCensusReadsAfterApplyAnswers = readsOfCensus(OLD_CENSUS_ID);
      console.log(
        '[census switch, real hook] old-census reads',
        JSON.stringify({ before: oldCensusReadsBeforeApplyAnswers, after: oldCensusReadsAfterApplyAnswers, newCensus: readsOfCensus(NEW_CENSUS_ID) })
      );
      expect(oldCensusReadsAfterApplyAnswers).toEqual(oldCensusReadsBeforeApplyAnswers);
      expect(readsOfCensus(NEW_CENSUS_ID).length).toBeGreaterThan(0);
    });

    it('a detached apply that answers 409 after a census change sends no grid, counts or validation request to the old census', async () => {
      const { saveSettled } = await startDetachedApplyThenSwitchCensus();
      const oldCensusReadsBeforeApplyAnswers = readsOfCensus(OLD_CENSUS_ID);
      await act(async () => pendingApply?.settle(editJson({ freshPlan: WARNING_PLAN }, HASH_DRIFT_STATUS)));
      await expectNotSavedMessage('late 409, old-census reads');
      await expectSwitchSettled('late 409, old-census reads', saveSettled);
      await waitForLateReads();
      const oldCensusReadsAfterApplyAnswers = readsOfCensus(OLD_CENSUS_ID);
      console.log(
        '[census switch, real hook] old-census reads',
        JSON.stringify({ before: oldCensusReadsBeforeApplyAnswers, after: oldCensusReadsAfterApplyAnswers, newCensus: readsOfCensus(NEW_CENSUS_ID) })
      );
      expect(oldCensusReadsAfterApplyAnswers).toEqual(oldCensusReadsBeforeApplyAnswers);
    });

    it('a detached apply that fails with a server error after a census change posts the error, and the row stays out of edit mode', async () => {
      const { saveSettled } = await startDetachedApplyThenSwitchCensus();
      await act(async () => pendingApply?.settle(new Response(APPLY_FAILURE_TEXT, { status: SERVER_ERROR_STATUS })));
      try {
        await screen.findByText(`Error: ${APPLY_FAILURE_TEXT}`);
      } finally {
        console.log('[census switch, real hook] server error snackbar', JSON.stringify({ visible: visibleSnackbarTexts(), rowsInEditMode: rowsInEditMode() }));
      }
      await expectSwitchSettled('late server error', saveSettled);
      expect(screen.getByText(`Error: ${APPLY_FAILURE_TEXT}`)).toBeInTheDocument();
      expect(screen.queryByText(ROW_UPDATED_MESSAGE)).not.toBeInTheDocument();
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
      await switchCensusAndSettleCountsReread(rerender, [CENSUS_B_ROW]);
      await waitFor(() => expect(screen.queryByTestId('edit-preview-apply')).not.toBeInTheDocument());
      await censusASettled;
      const { pendingSave: censusBSave } = await startEditAndOpenSaveConfirmation(user, CENSUS_B_ROW);
      const censusBSettled = expect(censusBSave).resolves.toMatchObject({ coreMeasurementID: CENSUS_B_ROW.coreMeasurementID });
      // Census A's detached apply answers only now, while census B's confirmation is open.
      await act(async () => pendingApply?.settle(editJson({ freshPlan: WARNING_PLAN }, HASH_DRIFT_STATUS)));
      await expectNotSavedMessage('late census-A response');
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

describe('MeasurementsCommons View Data grid configuration', () => {
  beforeEach(() => {
    controlsLog.length = 0;
    countsRow = COUNTS_ROW;
    ctx.grid = null;
    ctx.session.data.user.userStatus = 'field crew';
    ctx.census = { plotCensusNumber: 1, dateRanges: [{ censusID: 1 }] };
    fetchMock.mockImplementation(route);
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    ctx.session.data.user.userStatus = 'field crew';
  });

  const SUMMARY_COLUMNS_PROMISE = import('@/components/client/datagridcolumns').then(module => module.MeasurementsSummaryViewGridColumns);
  const PENDING_DETAILS_COLUMN_WIDTH = 64;
  const STARTING_PAGE = 2;
  const DESCENDING_DATE_SORT = [{ field: 'measurementDate', sort: 'desc' }];

  async function renderGrid(rows: Array<Record<string, unknown>> = [ROW], initialPage = 0) {
    const columns = await SUMMARY_COLUMNS_PROMISE;
    render(<MeasurementsGridHarness initialRows={rows} gridColumns={columns} renderAboveGrid={renderAboveGrid} initialPage={initialPage} />);
    await waitFor(() => expect(ctx.grid).not.toBeNull());
    return ctx.grid as Record<string, unknown>;
  }

  type ActionsColumn = GridColDef & { getActions: (params: { id: number; row: unknown }) => React.ReactNode[] };
  const actionsColumnOfCurrentGrid = () => (ctx.grid?.columns as GridColDef[])[0] as ActionsColumn;
  const SECOND_ROW = { ...ROW, id: 2, coreMeasurementID: 502, treeTag: '010204' };

  it('configures server sorting, fixed 44 px rows, the column menu style and the column selector', async () => {
    const grid = await renderGrid();
    const hiddenFields = Object.entries((grid.initialState as { columns: { columnVisibilityModel: Record<string, boolean> } }).columns.columnVisibilityModel)
      .filter(([, visible]) => !visible)
      .map(([field]) => field);
    const observed = {
      sortingMode: grid.sortingMode,
      rowHeight: grid.rowHeight,
      getRowHeight: grid.getRowHeight,
      getEstimatedRowHeight: grid.getEstimatedRowHeight,
      disableColumnSelector: grid.disableColumnSelector,
      firstColumn: (grid.columns as GridColDef[])[0].field,
      hiddenFields
    };
    console.log('[grid config]', JSON.stringify(observed));
    expect(observed).toMatchObject({
      sortingMode: 'server',
      rowHeight: VIEW_DATA_ROW_HEIGHT,
      getRowHeight: undefined,
      getEstimatedRowHeight: undefined,
      disableColumnSelector: undefined,
      firstColumn: 'actions'
    });
    expect(hiddenFields).toEqual(expect.arrayContaining([...VIEW_DATA_DEFAULT_HIDDEN_COLUMNS, 'coreMeasurementID']));
    expect(Object.keys(grid.sx as Record<string, unknown>)).toEqual(expect.arrayContaining(Object.keys(ALWAYS_VISIBLE_COLUMN_MENU_SX)));
  });

  it('keeps the spec column order among the columns it shows', async () => {
    const grid = await renderGrid();
    const shown = (grid.columns as GridColDef[]).map(column => column.field);
    const expectedOrder = VIEW_DATA_COLUMN_ORDER.filter(field => shown.includes(field));
    const observed = shown.filter(field => (expectedOrder as readonly string[]).includes(field));
    console.log('[column order]', JSON.stringify({ shown, observed }));
    expect(observed).toEqual([...expectedOrder]);
    expect(observed.length).toBeGreaterThan(1);
  });

  it('sends a header sort to the server, returns to page 0 and never reorders the rows itself', async () => {
    const olderRow = { ...ROW, id: 3, coreMeasurementID: 503, measurementDate: '2024-06-10' };
    const newerRow = { ...ROW, id: 4, coreMeasurementID: 504, measurementDate: '2024-06-20' };
    const serverOrder = [olderRow.id, newerRow.id];
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) =>
      String(input).startsWith(GRID_URL_PREFIX) ? Promise.resolve(respond({ output: [olderRow, newerRow], totalCount: 2 })) : route(input, init)
    );
    const grid = await renderGrid([olderRow, newerRow], STARTING_PAGE);
    expect(gridRequests().some(request => request.url.includes(`${GRID_URL_PREFIX}${STARTING_PAGE}/`))).toBe(true);
    await act(async () => {
      (grid.onSortModelChange as (model: unknown) => void)(DESCENDING_DATE_SORT);
      await Promise.resolve();
    });
    const sortedRequest = () => gridRequests().find(request => JSON.stringify(request.body.sortModel) === JSON.stringify(DESCENDING_DATE_SORT));
    await waitFor(() => expect(sortedRequest()).toBeDefined());
    const rowOrder = (ctx.grid?.rows as Array<{ id: number }>).map(row => row.id);
    console.log('[server sort] request', JSON.stringify(sortedRequest()), 'row order', JSON.stringify(rowOrder));
    expect(sortedRequest()?.url).toContain(`${GRID_URL_PREFIX}0/`);
    expect(rowOrder).toEqual(serverOrder);
  });

  it.each([
    ['field crew', { treeTag: true, speciesCode: false }],
    ['global', { treeTag: true, speciesCode: true }],
    ['db admin', { treeTag: true, speciesCode: true }],
    ['pending', { treeTag: false, speciesCode: false }]
  ])('cell editability for %s', async (userStatus, expected) => {
    ctx.session.data.user.userStatus = userStatus;
    const grid = await renderGrid();
    const isCellEditable = grid.isCellEditable as (params: { field: string; id: number }) => boolean;
    const observed = { treeTag: isCellEditable({ field: 'treeTag', id: 1 }), speciesCode: isCellEditable({ field: 'speciesCode', id: 1 }) };
    console.log('[editability]', userStatus, JSON.stringify(observed));
    expect(observed).toEqual(expected);
  });

  it('gives a pending user a Details-only column', async () => {
    ctx.session.data.user.userStatus = 'pending';
    await renderGrid();
    const actions = actionsColumnOfCurrentGrid();
    render(<div>{actions.getActions({ id: 1, row: ROW })}</div>);
    console.log('[pending actions]', JSON.stringify({ header: actions.headerName, width: actions.width }));
    expect({ header: actions.headerName, width: actions.width }).toEqual({ header: VIEW_DATA_TEXT.detailsHeader, width: PENDING_DETAILS_COLUMN_WIDTH });
    expect(screen.queryByRole('button', { name: VIEW_DATA_TEXT.editRow })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: VIEW_DATA_TEXT.detailsFor('010203', '1') })).toBeInTheDocument();
  });

  it("disables other rows' Edit with the lock tooltip and shows the editing caption while a row is edited", async () => {
    const grid = await renderGrid([ROW, SECOND_ROW]);
    act(() => (grid.onRowModesModelChange as (model: unknown) => void)({ 1: { mode: 'edit' } }));
    const toolbarCaption = () => (ctx.grid?.slotProps as { toolbar: { viewDataToolbar: { caption: string } } }).toolbar.viewDataToolbar.caption;
    await waitFor(() => expect(toolbarCaption()).toBe(VIEW_DATA_TEXT.captionEditing('010203', '1')));
    render(<div data-testid="second-row">{actionsColumnOfCurrentGrid().getActions({ id: 2, row: SECOND_ROW })}</div>);
    const lockedEdit = screen.getByRole('button', { name: VIEW_DATA_TEXT.editLockTooltip });
    console.log('[edit lock] second row edit button', lockedEdit.outerHTML);
    expect(lockedEdit).toHaveAttribute('data-disabled', 'true');
  });

  it('keeps native edit entry inside the one-row lock: no cell of another row is editable while a row is edited (A23)', async () => {
    ctx.session.data.user.userStatus = 'global';
    const grid = await renderGrid([ROW, SECOND_ROW]);
    const editabilityOf = () => {
      const isCellEditable = ctx.grid?.isCellEditable as (params: { field: string; id: number }) => boolean;
      return {
        row1TreeTag: isCellEditable({ field: 'treeTag', id: 1 }),
        row2TreeTag: isCellEditable({ field: 'treeTag', id: 2 }),
        row2Species: isCellEditable({ field: 'speciesCode', id: 2 })
      };
    };
    const beforeEdit = editabilityOf();
    act(() => (grid.onRowModesModelChange as (model: unknown) => void)({ 1: { mode: 'edit' } }));
    await waitFor(() => expect((ctx.grid?.rowModesModel as Record<string, { mode: string }>)[1]?.mode).toBe('edit'));
    const duringEdit = editabilityOf();
    console.log('[one-row lock] isCellEditable', JSON.stringify({ beforeEdit, duringEdit }));
    expect(beforeEdit).toEqual({ row1TreeTag: true, row2TreeTag: true, row2Species: true });
    expect(duringEdit).toEqual({ row1TreeTag: true, row2TreeTag: false, row2Species: false });
  });
});
