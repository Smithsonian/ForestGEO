import React, { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SWRConfig } from 'swr';
import type { GridColDef, GridRowModesModel, GridRowsProp } from '@mui/x-data-grid';
import type { AlertProps } from '@mui/material';
import MeasurementsCommons from './measurementscommons';
import { DELETE_AFTER_CANCEL_GUARD_MS } from './hooks/usedeleteaftercancelguard';

const MEASUREMENT_ROW = {
  id: 1,
  coreMeasurementID: 501,
  treeTag: 'GUARD_TREE_1',
  stemTag: '1',
  measuredDBH: 12.5,
  measurementDate: '2024-06-15'
};
const PAGE_SIZE = 10;
const GRID_COLUMNS: GridColDef[] = [{ field: 'treeTag', headerName: 'Tree Tag', editable: true }];
const DELETE_DIALOG_CONFIRM_LABEL = 'Confirm';
const FILTERED_GRID_URL_PREFIX = '/api/fixeddatafilter/';
const VALIDATION_ERRORS_URL_PREFIX = '/api/validations/validationerrordisplay';
const QUERY_URL = '/api/query';
// waitFor re-checks on this interval; the fetch count must hold still across one interval.
const HARNESS_SETTLE_POLL_MS = 100;
const HARNESS_SETTLE_TIMEOUT_MS = 3000;
// A loop would add calls well inside this window; a settled harness adds none.
const HARNESS_QUIET_PERIOD_MS = 500;

const mockFetch = vi.fn();

// One object per mock for the whole file. The real component's
// [currentPlot, currentCensus, currentSite] effect (measurementscommons.tsx:1100)
// refetches counts whenever those identities change, and the fetch sets new state,
// so a factory returning a fresh object per render would loop.
const stableHarnessContext = vi.hoisted(() => {
  const noop = () => undefined;
  return {
    plot: { plotID: 1, plotName: 'Test Plot' },
    census: { plotCensusNumber: 1, dateRanges: [{ censusID: 1 }] },
    site: { schemaName: 'testschema', siteName: 'Test Site' },
    loading: { setLoading: noop },
    // Measurements actions render only for global / db admin sessions.
    session: { data: { user: { userStatus: 'global' } }, status: 'authenticated' },
    router: { push: noop, replace: noop },
    editPreviewFlow: {
      beginEdit: async () => undefined,
      confirmDialog: async () => undefined,
      cancelDialog: noop,
      dialogState: { open: false, plan: null, busy: false, wasRefreshed: false }
    }
  };
});

vi.mock('@/app/contexts/compat-hooks', () => ({
  usePlotContext: () => stableHarnessContext.plot,
  useOrgCensusContext: () => stableHarnessContext.census,
  useSiteContext: () => stableHarnessContext.site
}));
vi.mock('@/app/contexts/loadingprovider', () => ({ useLoading: () => stableHarnessContext.loading }));
vi.mock('next-auth/react', () => ({ useSession: () => stableHarnessContext.session }));
vi.mock('next/navigation', () => ({ useRouter: () => stableHarnessContext.router }));
// setup.ts replaces these definition modules with stubs; use the real ones, as msvdatagrid.test.tsx:14-22 does.
vi.mock('@/lib/db/definitions/core', async importOriginal => importOriginal());
vi.mock('@/lib/db/definitions/views', async importOriginal => importOriginal());
vi.mock('@/lib/db/definitions/zones', async importOriginal => importOriginal());
vi.mock('@/lib/db/definitions/personnel', async importOriginal => importOriginal());
vi.mock('@/lib/db/definitions/taxonomies', async importOriginal => importOriginal());
vi.mock('@/lib/db/definitions/timekeeping', async importOriginal => importOriginal());
vi.mock('@/lib/db/definitions/validations', async importOriginal => importOriginal());
vi.mock('@/lib/db/definitions/admin', async importOriginal => importOriginal());
vi.mock('@/components/client/modals/confirmationdialog', () => ({
  default: ({ open, onConfirm }: { open: boolean; onConfirm: () => void }) =>
    open ? (
      <button type="button" onClick={onConfirm}>
        Confirm
      </button>
    ) : null
}));
vi.mock('@/components/client/datagridelements', () => ({ EditToolbar: () => <div>Toolbar</div> }));
// Plain functions, not vi.fn: the unit config sets mockReset, which would make a vi.fn return undefined.
vi.mock('@/components/client/clientmacros', async importOriginal => ({
  ...(await importOriginal<typeof import('@/components/client/clientmacros')>()),
  loadSelectableOptions: async () => undefined,
  getSelectableOptionsForField: () => []
}));
vi.mock('@/app/hooks/useEditPreviewFlow', () => ({ useEditPreviewFlow: () => stableHarnessContext.editPreviewFlow }));
vi.mock('@mui/x-data-grid', async importOriginal => {
  const actual = await importOriginal<typeof import('@mui/x-data-grid')>();
  return {
    ...actual,
    // `disabled` is rendered as data-disabled so a click still reaches onClick.
    GridActionsCellItem: ({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) => (
      <button type="button" data-disabled={String(Boolean(disabled))} onClick={onClick}>
        {label}
      </button>
    )
  };
});
vi.mock('@/config/styleddatagrid', () => ({
  StyledDataGrid: (props: { rows?: Array<{ id: number }>; columns?: GridColDef[] }) => {
    const rows = props.rows ?? [];
    const actionColumn = (props.columns ?? []).find(column => 'getActions' in column && typeof column.getActions === 'function') as
      | { getActions: (params: { id: number; row: unknown }) => React.ReactNode[] }
      | undefined;
    if (!actionColumn) return <div data-testid="no-actions-column" />;
    return (
      <div>
        {rows.map(row => (
          <div key={row.id} data-testid={`actions-row-${row.id}`}>
            {actionColumn.getActions({ id: row.id, row }).map((action, index) => (
              <React.Fragment key={`${row.id}-${index}`}>{action}</React.Fragment>
            ))}
          </div>
        ))}
      </div>
    );
  }
}));

function jsonResponse(body: unknown): Response {
  return { ok: true, json: async () => body } as Response;
}

function routeMeasurementsFetch(input: RequestInfo | URL): Promise<Response> {
  const url = String(input);
  if (url.startsWith(FILTERED_GRID_URL_PREFIX)) return Promise.resolve(jsonResponse({ output: [MEASUREMENT_ROW], totalCount: 1 }));
  if (url.startsWith(VALIDATION_ERRORS_URL_PREFIX)) return Promise.resolve(jsonResponse({ failed: [] }));
  if (url === QUERY_URL) return Promise.resolve(jsonResponse([{}]));
  return Promise.resolve(jsonResponse({}));
}

// Owns the props the real parent (msvdatagrid.tsx) owns, so MeasurementsCommons runs unmodified.
function MeasurementsGridHarness() {
  const [rows, setRows] = useState<GridRowsProp>([MEASUREMENT_ROW]);
  const [rowCount, setRowCount] = useState(1);
  const [rowModesModel, setRowModesModel] = useState<GridRowModesModel>({});
  const [snackbar, setSnackbar] = useState<Pick<AlertProps, 'children' | 'severity'> | null>(null);
  const [refresh, setRefresh] = useState(false);
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: PAGE_SIZE });
  const [isNewRowAdded, setIsNewRowAdded] = useState(false);
  const [shouldAddRowAfterFetch, setShouldAddRowAfterFetch] = useState(false);
  return (
    <SWRConfig value={{ provider: () => new Map(), revalidateOnFocus: false, dedupingInterval: 0 }}>
      <MeasurementsCommons
        gridType="measurementssummary"
        gridColumns={GRID_COLUMNS}
        rows={rows}
        setRows={setRows}
        rowCount={rowCount}
        setRowCount={setRowCount}
        rowModesModel={rowModesModel}
        setRowModesModel={setRowModesModel}
        snackbar={snackbar}
        setSnackbar={setSnackbar}
        refresh={refresh}
        setRefresh={setRefresh}
        paginationModel={paginationModel}
        setPaginationModel={setPaginationModel}
        isNewRowAdded={isNewRowAdded}
        setIsNewRowAdded={setIsNewRowAdded}
        shouldAddRowAfterFetch={shouldAddRowAfterFetch}
        setShouldAddRowAfterFetch={setShouldAddRowAfterFetch}
        addNewRowToGrid={() => undefined}
        dynamicButtons={[]}
      />
    </SWRConfig>
  );
}

// Resolves once the fetch count holds still for one poll interval; returns that count.
async function waitForHarnessToSettle(): Promise<number> {
  let previousCallCount = -1;
  await waitFor(
    () => {
      const currentCallCount = mockFetch.mock.calls.length;
      const unchangedSinceLastCheck = currentCallCount === previousCallCount;
      previousCallCount = currentCallCount;
      expect(unchangedSinceLastCheck, `fetch count still rising: ${currentCallCount}`).toBe(true);
    },
    { interval: HARNESS_SETTLE_POLL_MS, timeout: HARNESS_SETTLE_TIMEOUT_MS }
  );
  return previousCallCount;
}

async function enterEditModeAndFindCancel(): Promise<HTMLElement> {
  const editButton = await screen.findByRole('button', { name: 'Edit' });
  await waitForHarnessToSettle();
  fireEvent.click(editButton);
  return screen.findByRole('button', { name: 'Cancel' });
}

describe('MeasurementsCommons row actions: Delete right after Cancel (#525 item 1)', () => {
  beforeEach(() => {
    mockFetch.mockImplementation(routeMeasurementsFetch);
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('renders the real Edit and Delete actions for each row and then stops fetching (harness self-check)', async () => {
    render(<MeasurementsGridHarness />);
    const editButtons = await screen.findAllByRole('button', { name: 'Edit' });
    const deleteButtons = screen.getAllByRole('button', { name: 'Delete' });
    const settledFetchCount = await waitForHarnessToSettle();
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, HARNESS_QUIET_PERIOD_MS));
    });
    const fetchCountAfterQuietPeriod = mockFetch.mock.calls.length;

    console.log(
      `[#525 item 1] harness rendered ${editButtons.length} Edit / ${deleteButtons.length} Delete; fetches settled at ${settledFetchCount}, ${fetchCountAfterQuietPeriod} after ${HARNESS_QUIET_PERIOD_MS}ms more: ${mockFetch.mock.calls.map(([url]) => String(url)).join(', ')}`
    );
    expect(editButtons).toHaveLength(1);
    expect(deleteButtons).toHaveLength(1);
    expect(fetchCountAfterQuietPeriod, 'the harness kept fetching after it settled: a render/fetch loop, not a Delete bug').toBe(settledFetchCount);
  });

  it('(a) disables Delete straight after Cancel and re-enables it when the guard window ends', async () => {
    render(<MeasurementsGridHarness />);
    const cancelButton = await enterEditModeAndFindCancel();
    vi.useFakeTimers();

    fireEvent.click(cancelButton);
    const disabledRightAfterCancel = screen.getByRole('button', { name: 'Delete' }).getAttribute('data-disabled');
    act(() => vi.advanceTimersByTime(DELETE_AFTER_CANCEL_GUARD_MS - 1));
    const disabledJustBeforeExpiry = screen.getByRole('button', { name: 'Delete' }).getAttribute('data-disabled');
    act(() => vi.advanceTimersByTime(1));
    const disabledAtExpiry = screen.getByRole('button', { name: 'Delete' }).getAttribute('data-disabled');

    console.log(`[#525 item 1] measurements Delete data-disabled: ${disabledRightAfterCancel} → ${disabledJustBeforeExpiry} → ${disabledAtExpiry}`);
    expect(disabledRightAfterCancel).toBe('true');
    expect(disabledJustBeforeExpiry).toBe('true');
    expect(disabledAtExpiry).toBe('false');
  });

  it('(b) swallows the second click of a double-click on Cancel even though it lands on Delete', async () => {
    const user = userEvent.setup();
    render(<MeasurementsGridHarness />);
    const cancelButton = await enterEditModeAndFindCancel();

    await user.dblClick(cancelButton);

    console.log(
      `[#525 item 1] measurements slot-2 action after the double-click: "${cancelButton.textContent}"; delete dialog open: ${Boolean(screen.queryByRole('button', { name: DELETE_DIALOG_CONFIRM_LABEL }))}`
    );
    expect(cancelButton).toHaveTextContent('Delete');
    expect(screen.queryByRole('button', { name: DELETE_DIALOG_CONFIRM_LABEL })).not.toBeInTheDocument();
  });

  it('(c) opens the delete dialog for a deliberate click once the guard window has passed', async () => {
    render(<MeasurementsGridHarness />);
    const cancelButton = await enterEditModeAndFindCancel();
    vi.useFakeTimers();

    fireEvent.click(cancelButton);
    act(() => vi.advanceTimersByTime(DELETE_AFTER_CANCEL_GUARD_MS));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(screen.getByRole('button', { name: DELETE_DIALOG_CONFIRM_LABEL })).toBeInTheDocument();
  });
});
