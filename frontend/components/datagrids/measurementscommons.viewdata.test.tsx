import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GridColDef } from '@mui/x-data-grid';
import { MeasurementsGridHarness } from './measurementscommons.harness';
import type { ViewDataAboveGridControls } from '@/components/viewdata/viewdatacontrols';
import ViewDataGridToolbar from '@/components/viewdata/viewdatagridtoolbar';
import { VIEW_DATA_TEXT } from '@/config/viewdata';
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
      beginEdit: async () => undefined,
      confirmDialog: async () => undefined,
      cancelDialog: noop,
      cancelPendingOperation: () => 'none' as const,
      dialogState: { open: false, plan: null, busy: false, wasRefreshed: false }
    },
    grid: null as null | Record<string, unknown>
  };
});

vi.mock('@/app/contexts/compat-hooks', () => ({ usePlotContext: () => ctx.plot, useOrgCensusContext: () => ctx.census, useSiteContext: () => ctx.site }));
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
vi.mock('@/app/hooks/useEditPreviewFlow', async importOriginal => ({
  ...(await importOriginal<typeof import('@/app/hooks/useEditPreviewFlow')>()),
  useEditPreviewFlow: () => ctx.editPreviewFlow
}));
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
