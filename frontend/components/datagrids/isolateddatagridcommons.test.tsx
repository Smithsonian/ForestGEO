import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SWRConfig } from 'swr';
import IsolatedDataGridCommons, {
  FILTER_APPLY_DEBOUNCE_MS,
  gridLayoutStorageKey,
  readPersistedGridLayout,
  writePersistedGridLayout,
  ROW_UPDATED_MESSAGE,
  NEW_ROW_ADDED_MESSAGE,
  NO_CHANGES_SAVED_MESSAGE
} from './isolateddatagridcommons';
import { RowSaveFinalizationError } from '@/components/datagrids/rowsaveerror';
import { LOADING_BAR_VISIBLE_DELAY_MS } from '@/components/loading';
import { HTTPResponses } from '@/config/macros';

const mockFetch = vi.fn();
const mockGetRowWithUpdatedValues = vi.fn();
const mockTriggerRefresh = vi.fn();
const observedGetRowHeightProps: unknown[] = [];
let echoSamePaginationOnRender = false;
let capturedProcessPromises: Promise<unknown>[] = [];
const ADMIN_TEST_EMAIL = 'admin@example.org';
const DETACHED_ROW_ID = 'row-dropped-by-refetch';
const NON_JSON_ERROR_BODY = 'Service temporarily unavailable: upstream database connection refused';
const ORIGINAL_TEST_SP_CODE = 'TEST_SP_CODE_A';
const UPDATED_TEST_SP_CODE = 'TEST_SP_CODE_B';
const TEST_SCHEMA = 'testschema';

vi.mock('@/lib/db/definitions/views', () => ({
  getAllTaxonomiesViewHCs: () => ({}),
  getAllViewFullTableViewsHCs: () => ({}),
  getMeasurementsSummaryViewHCs: () => ({}),
  getStemTaxonomiesViewHCs: () => ({})
}));

vi.mock('@/lib/db/definitions/zones', () => ({
  getQuadratHCs: () => ({})
}));

vi.mock('@/lib/db/definitions/personnel', () => ({
  getPersonnelHCs: () => ({})
}));

vi.mock('@/lib/db/definitions/core', async importOriginal => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    getCoreMeasurementsHCs: () => ({}),
    getFailedMeasurementsHCs: () => ({})
  };
});

vi.mock('@/lib/db/definitions/taxonomies', () => ({
  getSpeciesLimitsHCs: () => ({})
}));

vi.mock('@/app/contexts/compat-hooks', () => ({
  usePlotContext: () => ({ plotID: 1, plotName: 'Test Plot' }),
  useOrgCensusContext: () => ({ plotCensusNumber: 1, dateRanges: [{ censusID: 1 }] }),
  useQuadratContext: () => ({ quadratID: undefined }),
  // Vitest hoists vi.mock() factories above module-scope const declarations, so this
  // literal cannot reference the TEST_SCHEMA constant used later in the file.
  useSiteContext: () => ({ schemaName: 'testschema', siteName: 'Test Site' })
}));

vi.mock('@/app/contexts/datavalidityprovider', () => ({
  useDataValidityContext: () => ({ triggerRefresh: mockTriggerRefresh })
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: null, status: 'authenticated' })
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn()
}));

vi.mock('@/components/errorboundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>
}));

vi.mock('@/components/client/modals/confirmationdialog', () => ({
  default: ({ open, onConfirm }: { open: boolean; onConfirm: () => void }) =>
    open ? (
      <button type="button" onClick={onConfirm}>
        Confirm
      </button>
    ) : null
}));

vi.mock('@/components/client/modals/resetviewmodal', () => ({
  default: () => null
}));

vi.mock('@/components/datagrids/skipreentrydatamodal', () => ({
  default: ({ row, handleSave }: { row: Record<string, unknown>; handleSave: (row: Record<string, unknown>) => void }) => (
    <button type="button" onClick={() => handleSave(row)}>
      Save Changes
    </button>
  )
}));

vi.mock('@/components/client/datagridelements', () => ({
  EditToolbar: () => <div>Toolbar</div>
}));

vi.mock('@mui/x-data-grid-generator', () => ({
  randomId: () => 'new-row-id'
}));

vi.mock('@mui/x-data-grid', () => ({
  GridActionsCellItem: ({ label, onClick }: { label: string; onClick: () => void }) => (
    <button type="button" onClick={onClick}>
      {label}
    </button>
  ),
  GridColDef: {},
  // Never invoked by StyledDataGridMock below (it doesn't call colDef.renderEditCell),
  // this stub only has to exist so importing it from the component under test doesn't
  // throw "does not provide an export named 'GridEditInputCell'".
  GridEditInputCell: () => null,
  GridEventListener: {},
  GridFilterOperator: {},
  GridFilterModel: {},
  GridPreProcessEditCellProps: {},
  GridRenderEditCellParams: {},
  GridRowEditStopReasons: { rowFocusOut: 'rowFocusOut' },
  GridRowId: {},
  GridRowModel: {},
  GridRowsProp: {},
  GridRowModes: { Edit: 'edit', View: 'view' },
  GridRowModesModel: {},
  GridSlots: {},
  GridToolbarProps: {},
  getGridNumericOperators: () => [],
  useGridApiRef: () => ({
    current: {
      getRowWithUpdatedValues: mockGetRowWithUpdatedValues,
      setCellFocus: vi.fn()
    }
  })
}));

vi.mock('@/config/styleddatagrid', async () => {
  const ReactModule = await import('react');

  function StyledDataGridMock(props: any) {
    const prevModesRef = ReactModule.useRef<Record<string, any>>({});
    const rows = props.rows || [];
    const columns = props.columns || [];
    observedGetRowHeightProps.push(props.getRowHeight);

    ReactModule.useEffect(() => {
      if (echoSamePaginationOnRender) {
        props.onPaginationModelChange?.({ ...props.paginationModel });
      }
    }, [props.paginationModel, props.onPaginationModelChange]);

    ReactModule.useEffect(() => {
      const previousModes = prevModesRef.current;
      const currentModes = props.rowModesModel || {};

      Object.entries(currentModes).forEach(([rowID, modeConfig]: [string, any]) => {
        const previousMode = previousModes[rowID]?.mode;
        const nextMode = modeConfig?.mode;

        if (previousMode === 'edit' && nextMode === 'view' && !modeConfig?.ignoreModifications && props.processRowUpdate) {
          const oldRow = rows.find((row: any) => String(row.id) === rowID);
          const newRow = mockGetRowWithUpdatedValues(rowID, 'anyField') ?? oldRow;
          void props.processRowUpdate(newRow, oldRow).catch(() => {});
        }
      });

      prevModesRef.current = currentModes;
    }, [props.rowModesModel, rows, props.processRowUpdate]);

    return (
      <div>
        <div data-testid="filter-model-state">{JSON.stringify(props.filterModel ?? null)}</div>
        <div data-testid="initial-state">{JSON.stringify(props.initialState ?? null)}</div>
        <div data-testid="column-selector-disabled">{String(props.disableColumnSelector)}</div>
        <button type="button" onClick={() => props.onColumnVisibilityModelChange?.({ plotName: false })}>
          Hide PlotName Column
        </button>
        <button type="button" onClick={() => props.onColumnWidthChange?.({ colDef: { field: 'plotName' }, width: 321 })}>
          Resize PlotName Column
        </button>
        <div data-testid="pagination-state">{JSON.stringify(props.paginationModel ?? null)}</div>
        <div data-testid="pagination-slot-present">{String(Boolean(props.slots?.pagination))}</div>
        <div data-testid="infinite-scroll-enabled">{String(Boolean(props.slots?.pagination?.infiniteScroll?.enabled))}</div>
        <div data-testid="infinite-scroll-prop-present">{String(Boolean(props.slots?.pagination?.infiniteScroll))}</div>
        <div data-testid="export-csv-handler-present">{String(typeof props.slotProps?.toolbar?.handleExportCSV === 'function')}</div>
        <button type="button" onClick={() => props.slots?.pagination?.infiniteScroll?.onToggle?.(true)}>
          Test Toggle Infinite On
        </button>
        <button type="button" onClick={() => props.slots?.pagination?.infiniteScroll?.onToggle?.(false)}>
          Test Toggle Infinite Off
        </button>
        <button type="button" onClick={() => void props.slotProps?.toolbar?.handleAddNewRow?.()}>
          Test Add New Row
        </button>
        <button
          type="button"
          onClick={() =>
            props.onPaginationModelChange?.({
              page: 2,
              pageSize: props.paginationModel?.pageSize ?? 10
            })
          }
        >
          Go Page 2
        </button>
        <button
          type="button"
          onClick={() =>
            props.onFilterModelChange?.({
              ...(props.filterModel ?? {}),
              items: [{ id: 1, field: 'spCode', operator: 'contains', value: UPDATED_TEST_SP_CODE }],
              quickFilterValues: []
            })
          }
        >
          Apply Panel Filter
        </button>
        <button
          type="button"
          onClick={() =>
            props.onFilterModelChange?.({
              ...(props.filterModel ?? {}),
              items: [{ id: 1, field: 'spCode', operator: 'contains' }],
              logicOperator: 'and',
              quickFilterLogicOperator: 'and',
              quickFilterValues: []
            })
          }
        >
          Open Draft Panel Filter
        </button>
        <div data-testid="row-state">{JSON.stringify(rows)}</div>
        <div data-testid="grid-saving">{String(Boolean(props['aria-busy']))}</div>
        <button
          type="button"
          onClick={() => {
            const oldRow = rows.find((row: any) => row.isNew === true) ?? rows[0];
            if (oldRow) {
              const processPromise = props.processRowUpdate?.({ ...oldRow, isNew: true }, { ...oldRow, isNew: true });
              if (processPromise) capturedProcessPromises.push(processPromise);
            }
          }}
        >
          Test Process New Row
        </button>
        <button
          type="button"
          onClick={() => {
            // Simulates MUI committing an edit via Tab-out-of-last-cell/programmatic stop,
            // which calls processRowUpdate directly - no Save-icon click, no confirm dialog.
            const oldRow = rows.find((row: any) => row.isNew !== true) ?? rows[0];
            if (oldRow) {
              const newRow = mockGetRowWithUpdatedValues(oldRow.id, 'anyField') ?? oldRow;
              const processPromise = props.processRowUpdate?.(newRow, oldRow);
              if (processPromise) {
                processPromise.catch(() => {});
                capturedProcessPromises.push(processPromise);
              }
            }
          }}
        >
          Test Process Row
        </button>
        <button
          type="button"
          onClick={() => {
            // A new row whose local copy a refetch already discarded: MUI still holds
            // it in edit state and will hand it back to processRowUpdate.
            const detachedRow = { id: DETACHED_ROW_ID, isNew: true };
            const processPromise = props.processRowUpdate?.(detachedRow, detachedRow);
            if (processPromise) {
              processPromise.catch(() => {});
              capturedProcessPromises.push(processPromise);
            }
          }}
        >
          Test Process Detached New Row
        </button>
        {rows.map((row: any) => {
          const actionColumn = columns.find((column: any) => typeof column.getActions === 'function');
          if (!actionColumn) return null;
          return (
            <div key={row.id}>
              {actionColumn.getActions({ id: row.id, row }).map((action: React.ReactNode, index: number) => (
                <React.Fragment key={`${row.id}-${index}`}>{action}</React.Fragment>
              ))}
            </div>
          );
        })}
      </div>
    );
  }

  return {
    StyledDataGrid: StyledDataGridMock
  };
});

describe('IsolatedDataGridCommons', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    observedGetRowHeightProps.length = 0;
    echoSamePaginationOnRender = false;
    capturedProcessPromises = [];
    global.fetch = mockFetch as any;
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('refetches from the server after a confirmed save, bypassing the SWR cache', async () => {
    const originalRow = {
      id: 1,
      failedMeasurementID: 123,
      spCode: ORIGINAL_TEST_SP_CODE
    };
    const updatedRow = {
      ...originalRow,
      spCode: UPDATED_TEST_SP_CODE
    };

    mockGetRowWithUpdatedValues.mockReturnValue(updatedRow);

    let saveSeen = false;
    const editFlowOverride = vi.fn(async (row: any) => {
      saveSeen = true;
      return { row, changed: true };
    });
    mockFetch.mockImplementation(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return {
        ok: true,
        json: async () => ({
          output: [saveSeen ? updatedRow : originalRow],
          totalCount: 1,
          finishedQuery: 'SELECT 1'
        })
      } as Response;
    });

    render(
      <SWRConfig value={{ provider: () => new Map(), revalidateOnFocus: false, dedupingInterval: 0 }}>
        <IsolatedDataGridCommons
          gridType="failedmeasurements"
          gridColumns={[
            { field: 'id', editable: false },
            { field: 'spCode', editable: true }
          ]}
          refresh={false}
          setRefresh={vi.fn()}
          dynamicButtons={[]}
          initialRow={originalRow}
          onDataUpdate={vi.fn().mockResolvedValue(undefined)}
          editFlowOverride={editFlowOverride}
        />
      </SWRConfig>
    );

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/api/fixeddata/failedmeasurements/testschema/0/50/1/1'), expect.any(Object));
      expect(screen.getByTestId('row-state').textContent).toContain(ORIGINAL_TEST_SP_CODE);
    });
    const initialListCallCount = mockFetch.mock.calls.filter(([, init]) => !init?.method || init.method === 'GET').length;

    // The row's action buttons render asynchronously after the fetched rows land;
    // a non-retrying query here races the grid's render under CI load.
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save Changes' }));

    await waitFor(() => {
      const listCalls = mockFetch.mock.calls.filter(([, init]) => !init?.method || init.method === 'GET');

      expect(editFlowOverride).toHaveBeenCalledWith(updatedRow, originalRow);
      expect(mockFetch.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(0);

      expect(listCalls).toHaveLength(initialListCallCount + 1);
      expect(screen.getByTestId('row-state').textContent).toContain(UPDATED_TEST_SP_CODE);
    });
  });

  it('rejects failed-measurement saves without an override and keeps the row editable', async () => {
    const originalRow = { id: 1, failedMeasurementID: 123, spCode: ORIGINAL_TEST_SP_CODE };
    const updatedRow = { ...originalRow, spCode: UPDATED_TEST_SP_CODE };
    mockGetRowWithUpdatedValues.mockReturnValue(updatedRow);
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ output: [originalRow], totalCount: 1, finishedQuery: 'SELECT 1' })
    } as Response);

    render(
      <SWRConfig value={{ provider: () => new Map(), revalidateOnFocus: false, dedupingInterval: 0 }}>
        <IsolatedDataGridCommons
          gridType="failedmeasurements"
          gridColumns={[
            { field: 'id', editable: false },
            { field: 'spCode', editable: true }
          ]}
          refresh={false}
          setRefresh={vi.fn()}
          dynamicButtons={[]}
          initialRow={originalRow}
        />
      </SWRConfig>
    );

    await waitFor(() => expect(screen.getByTestId('row-state').textContent).toContain(ORIGINAL_TEST_SP_CODE));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('preview/apply flow'));
    expect(mockFetch.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('surfaces non-JSON HTTP errors and allows a supported legacy update to retry', async () => {
    const originalRow = { id: 1, personID: 123, personName: 'Original' };
    const updatedRow = { ...originalRow, personName: 'Updated' };
    let patchCount = 0;
    mockGetRowWithUpdatedValues.mockReturnValue(updatedRow);
    mockFetch.mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        patchCount += 1;
        if (patchCount === 1) {
          // A real Response: its body is a single-use stream, so a helper that calls
          // json() before text() cannot recover this body and the message is lost.
          return new Response(NON_JSON_ERROR_BODY, {
            status: 503,
            statusText: 'Service Unavailable',
            headers: { 'Content-Type': 'text/plain' }
          });
        }
        return new Response(JSON.stringify({ message: 'updated' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return { ok: true, json: async () => ({ output: [patchCount ? updatedRow : originalRow], totalCount: 1, finishedQuery: 'SELECT 1' }) } as Response;
    });

    render(
      <SWRConfig value={{ provider: () => new Map(), revalidateOnFocus: false, dedupingInterval: 0 }}>
        <IsolatedDataGridCommons
          gridType="personnel"
          gridColumns={[
            { field: 'id', editable: false },
            { field: 'personName', editable: true }
          ]}
          refresh={false}
          setRefresh={vi.fn()}
          dynamicButtons={[]}
          initialRow={originalRow}
        />
      </SWRConfig>
    );

    await waitFor(() => expect(screen.getByTestId('row-state').textContent).toContain('Original'));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(NON_JSON_ERROR_BODY));
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(patchCount).toBe(2));
    expect(screen.getByTestId('row-state').textContent).toContain('Updated');
  });

  it('rejects an existing row whose edited ID changes before any mutation', async () => {
    const originalRow = { id: 1, personID: 123, personName: 'Original' };
    const changedRow = { ...originalRow, id: 2, personName: 'Changed' };
    const editFlowOverride = vi.fn(async (row: any) => ({ row, changed: true }));
    mockGetRowWithUpdatedValues.mockReturnValue(changedRow);
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ output: [originalRow], totalCount: 1, finishedQuery: 'SELECT 1' })
    } as Response);

    render(
      <SWRConfig value={{ provider: () => new Map(), revalidateOnFocus: false, dedupingInterval: 0 }}>
        <IsolatedDataGridCommons
          gridType="personnel"
          gridColumns={[
            { field: 'id', editable: false },
            { field: 'personName', editable: true }
          ]}
          refresh={false}
          setRefresh={vi.fn()}
          dynamicButtons={[]}
          initialRow={originalRow}
          editFlowOverride={editFlowOverride}
        />
      </SWRConfig>
    );

    await waitFor(() => expect(screen.getByTestId('row-state').textContent).toContain('Original'));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('ID changed'));
    expect(editFlowOverride).not.toHaveBeenCalled();
    expect(mockFetch.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(0);
  });

  it('rejects an existing row whose edited ID is missing before any mutation', async () => {
    const originalRow = { id: 1, personID: 123, personName: 'Original' };
    const missingIDRow = { ...originalRow, id: undefined, personName: 'Changed' };
    mockGetRowWithUpdatedValues.mockReturnValue(missingIDRow);
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ output: [originalRow], totalCount: 1, finishedQuery: 'SELECT 1' })
    } as Response);

    render(
      <SWRConfig value={{ provider: () => new Map(), revalidateOnFocus: false, dedupingInterval: 0 }}>
        <IsolatedDataGridCommons
          gridType="personnel"
          gridColumns={[
            { field: 'id', editable: false },
            { field: 'personName', editable: true }
          ]}
          refresh={false}
          setRefresh={vi.fn()}
          dynamicButtons={[]}
          initialRow={originalRow}
        />
      </SWRConfig>
    );

    await waitFor(() => expect(screen.getByTestId('row-state').textContent).toContain('Original'));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('edited ID is missing'));
    expect(mockFetch.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(0);
  });

  it('creates an explicit new row with one POST after confirmation', async () => {
    const originalRow = { id: 1, personID: 123, personName: 'Original' };
    const createdRow = { ...originalRow, id: 42, personnelID: 42 };
    let postCount = 0;
    mockFetch.mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        postCount += 1;
        return new Response(JSON.stringify({ message: 'created', createdIDs: { personnel: 42 } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return { ok: true, json: async () => ({ output: [postCount ? createdRow : originalRow], totalCount: 1, finishedQuery: 'SELECT 1' }) } as Response;
    });

    render(
      <SWRConfig value={{ provider: () => new Map(), revalidateOnFocus: false, dedupingInterval: 0 }}>
        <IsolatedDataGridCommons
          gridType="personnel"
          gridColumns={[
            { field: 'id', editable: false },
            { field: 'personName', editable: true }
          ]}
          refresh={false}
          setRefresh={vi.fn()}
          dynamicButtons={[]}
          initialRow={originalRow}
        />
      </SWRConfig>
    );

    await waitFor(() => expect(screen.getByTestId('row-state').textContent).toContain('Original'));
    fireEvent.click(screen.getByRole('button', { name: 'Test Add New Row' }));
    await waitFor(() => expect(screen.getByTestId('row-state').textContent).toContain('"isNew":true'));
    fireEvent.click(screen.getByRole('button', { name: 'Test Process New Row' }));
    fireEvent.click(screen.getByRole('button', { name: 'Test Process New Row' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(postCount).toBe(1));
    expect(capturedProcessPromises).toHaveLength(2);
    await expect(capturedProcessPromises[0]).resolves.toMatchObject({ personnelID: 42 });
    await expect(capturedProcessPromises[1]).resolves.toMatchObject({ personnelID: 42 });
    expect(screen.getByTestId('row-state').textContent).toContain('"personnelID":42');
    expect(JSON.parse(screen.getByTestId('row-state').textContent ?? '[]')).toHaveLength(1);
  });

  it('does not wedge the grid when a new row disappears before its confirmation dialog can open', async () => {
    const originalRow = { id: 1, personID: 123, personName: 'Original' };
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ output: [originalRow], totalCount: 1, finishedQuery: 'SELECT 1' })
    } as Response);

    render(
      <SWRConfig value={{ provider: () => new Map(), revalidateOnFocus: false, dedupingInterval: 0 }}>
        <IsolatedDataGridCommons
          gridType="personnel"
          gridColumns={[
            { field: 'id', editable: false },
            { field: 'personName', editable: true }
          ]}
          refresh={false}
          setRefresh={vi.fn()}
          dynamicButtons={[]}
          initialRow={originalRow}
        />
      </SWRConfig>
    );

    await waitFor(() => expect(screen.getByTestId('row-state').textContent).toContain('Original'));

    fireEvent.click(screen.getByRole('button', { name: 'Test Process Detached New Row' }));

    // The promise MUI awaits must settle rather than hang forever.
    expect(capturedProcessPromises).toHaveLength(1);
    await expect(capturedProcessPromises[0]).rejects.toThrow(`Cannot save row ${DETACHED_ROW_ID}`);
    expect(screen.queryByRole('button', { name: 'Save Changes' })).not.toBeInTheDocument();
    expect(mockFetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);

    // The pending-save lock must have been released: every other entry point on the
    // grid short-circuits on it, so a stuck ref leaves the whole grid read-only.
    fireEvent.click(screen.getByRole('button', { name: 'Test Add New Row' }));
    await waitFor(() => expect(screen.getByTestId('row-state').textContent).toContain('"isNew":true'));

    fireEvent.click(screen.getByRole('button', { name: 'Test Process New Row' }));
    expect(await screen.findByRole('button', { name: 'Save Changes' })).toBeInTheDocument();
  });

  it('rejects the awaited new-row save with a message when the grid is locked at confirmation time', async () => {
    const originalRow = { id: 1, personID: 123, personName: 'Original' };
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ output: [originalRow], totalCount: 1, finishedQuery: 'SELECT 1' })
    } as Response);

    render(
      <SWRConfig value={{ provider: () => new Map(), revalidateOnFocus: false, dedupingInterval: 0 }}>
        <IsolatedDataGridCommons
          gridType="personnel"
          gridColumns={[
            { field: 'id', editable: false },
            { field: 'personName', editable: true }
          ]}
          refresh={false}
          setRefresh={vi.fn()}
          dynamicButtons={[]}
          initialRow={originalRow}
          locked
        />
      </SWRConfig>
    );

    await waitFor(() => expect(screen.getByTestId('row-state').textContent).toContain('Original'));

    fireEvent.click(screen.getByRole('button', { name: 'Test Process New Row' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save Changes' }));

    expect(capturedProcessPromises).toHaveLength(1);
    await expect(capturedProcessPromises[0]).rejects.toThrow('This grid is locked');
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('This grid is locked'));
    expect(mockFetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
  });

  it('keeps an administrative row editable after creation by using the identifier the admin route returns', async () => {
    const originalRow = { id: 1, userID: 7, firstName: 'Original', lastName: 'Admin' };
    let postCount = 0;
    mockFetch.mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        postCount += 1;
        return new Response(JSON.stringify({ message: 'Successfully inserted', userID: 99, createdIDs: { users: 99 } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify({ output: [originalRow], totalCount: 1, finishedQuery: 'SELECT 1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    });

    render(
      <SWRConfig value={{ provider: () => new Map(), revalidateOnFocus: false, dedupingInterval: 0 }}>
        <IsolatedDataGridCommons
          gridType="users"
          gridColumns={[
            { field: 'id', editable: false },
            { field: 'firstName', editable: true }
          ]}
          refresh={false}
          setRefresh={vi.fn()}
          dynamicButtons={[]}
          initialRow={originalRow}
          adminEmail={ADMIN_TEST_EMAIL}
        />
      </SWRConfig>
    );

    await waitFor(() => expect(screen.getByTestId('row-state').textContent).toContain('Original'));
    fireEvent.click(screen.getByRole('button', { name: 'Test Add New Row' }));
    await waitFor(() => expect(screen.getByTestId('row-state').textContent).toContain('"isNew":true'));
    fireEvent.click(screen.getByRole('button', { name: 'Test Process New Row' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(postCount).toBe(1));

    const [postURL] = mockFetch.mock.calls.find(([, init]) => init?.method === 'POST') ?? [];
    expect(String(postURL)).toContain('/api/administrative/fetch/users');

    // The admin route's identifier must land on the row, so it is addressable by the
    // admin PATCH handler (WHERE UserID = ?) without waiting for a refetch.
    await expect(capturedProcessPromises[0]).resolves.toMatchObject({ userID: 99 });
    const savedRows = JSON.parse(screen.getByTestId('row-state').textContent ?? '[]');
    expect(savedRows.some((row: any) => row.userID === 99 && row.creationNeedsRefresh === undefined)).toBe(true);
  });

  it('blocks editing a created row until refresh supplies its missing server ID', async () => {
    const originalRow = { id: 1, personID: 123, personName: 'Original' };
    let postCount = 0;
    let listCount = 0;
    mockFetch.mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        postCount += 1;
        return new Response(JSON.stringify({ message: 'created' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      listCount += 1;
      if (listCount > 1) throw new Error('refresh unavailable');
      return { ok: true, json: async () => ({ output: [originalRow], totalCount: 1, finishedQuery: 'SELECT 1' }) } as Response;
    });

    render(
      <SWRConfig value={{ provider: () => new Map(), revalidateOnFocus: false, dedupingInterval: 0 }}>
        <IsolatedDataGridCommons
          gridType="personnel"
          gridColumns={[
            { field: 'id', editable: false },
            { field: 'personName', editable: true }
          ]}
          refresh={false}
          setRefresh={vi.fn()}
          dynamicButtons={[]}
          initialRow={originalRow}
        />
      </SWRConfig>
    );

    await waitFor(() => expect(screen.getByTestId('row-state').textContent).toContain('Original'));
    fireEvent.click(screen.getByRole('button', { name: 'Test Add New Row' }));
    await waitFor(() => expect(screen.getByTestId('row-state').textContent).toContain('"isNew":true'));
    fireEvent.click(screen.getByRole('button', { name: 'Test Process New Row' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(postCount).toBe(1));
    await waitFor(() => expect(screen.getByTestId('row-state').textContent).toContain('"creationNeedsRefresh":true'));
    await waitFor(() => expect(screen.getByTestId('grid-saving')).toHaveTextContent('false'));
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' }).at(-1)!);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument());
    expect(postCount).toBe(1);
  });

  it('commits a typed partial save locally when the follow-up refresh fails', async () => {
    const originalRow = { id: 1, personID: 123, personName: 'Original' };
    const updatedRow = { ...originalRow, personName: 'Updated' };
    let saveCount = 0;
    let listCount = 0;
    mockGetRowWithUpdatedValues.mockReturnValue(updatedRow);
    const editFlowOverride = vi.fn(async () => {
      saveCount += 1;
      if (saveCount === 1) throw new RowSaveFinalizationError('Changes were saved, but reingestion failed', updatedRow);
      return { row: updatedRow, changed: true };
    });
    mockFetch.mockImplementation(async () => {
      listCount += 1;
      if (listCount > 1) throw new Error('refresh unavailable');
      return { ok: true, json: async () => ({ output: [originalRow], totalCount: 1, finishedQuery: 'SELECT 1' }) } as Response;
    });

    render(
      <SWRConfig value={{ provider: () => new Map(), revalidateOnFocus: false, dedupingInterval: 0 }}>
        <IsolatedDataGridCommons
          gridType="personnel"
          gridColumns={[
            { field: 'id', editable: false },
            { field: 'personName', editable: true }
          ]}
          refresh={false}
          setRefresh={vi.fn()}
          dynamicButtons={[]}
          initialRow={originalRow}
          editFlowOverride={editFlowOverride}
        />
      </SWRConfig>
    );

    await waitFor(() => expect(screen.getByTestId('row-state').textContent).toContain('Original'));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(screen.getByTestId('row-state').textContent).toContain('Updated'));
    expect(screen.getByRole('alert')).toHaveTextContent('Changes were saved, but reingestion failed');
    expect(editFlowOverride).toHaveBeenCalledWith(updatedRow, originalRow);
    // describeSaveOutcome checks outcome.partialError first, unconditionally - a partial
    // save must never be reported as (or alongside) a no-op/info outcome.
    expect(screen.queryByText(NO_CHANGES_SAVED_MESSAGE), 'a partial save must outrank any info/no-op phrasing').not.toBeInTheDocument();
  });

  it('ignores a duplicate confirmation while the first save is pending', async () => {
    const originalRow = { id: 1, personID: 123, personName: 'Original' };
    const updatedRow = { ...originalRow, personName: 'Updated' };
    let resolveSave: ((result: { row: typeof updatedRow; changed: boolean }) => void) | undefined;
    const editFlowOverride = vi.fn(
      () =>
        new Promise<{ row: typeof updatedRow; changed: boolean }>(resolve => {
          resolveSave = resolve;
        })
    );
    mockGetRowWithUpdatedValues.mockReturnValue(updatedRow);
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ output: [originalRow], totalCount: 1, finishedQuery: 'SELECT 1' })
    } as Response);

    render(
      <SWRConfig value={{ provider: () => new Map(), revalidateOnFocus: false, dedupingInterval: 0 }}>
        <IsolatedDataGridCommons
          gridType="personnel"
          gridColumns={[
            { field: 'id', editable: false },
            { field: 'personName', editable: true }
          ]}
          refresh={false}
          setRefresh={vi.fn()}
          dynamicButtons={[]}
          initialRow={originalRow}
          editFlowOverride={editFlowOverride}
        />
      </SWRConfig>
    );

    await waitFor(() => expect(screen.getByTestId('row-state').textContent).toContain('Original'));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
    const confirm = await screen.findByRole('button', { name: 'Save Changes' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(editFlowOverride).toHaveBeenCalledTimes(1));
    resolveSave?.({ row: updatedRow, changed: true });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('successfully updated'));
  });

  it('keeps the grid mounted while debounced server filters are loading', async () => {
    const originalRow = {
      id: 1,
      failedMeasurementID: 123,
      spCode: ORIGINAL_TEST_SP_CODE
    };
    const filteredRow = {
      ...originalRow,
      spCode: UPDATED_TEST_SP_CODE
    };

    let resolveFilteredFetch: (() => void) | undefined;

    mockFetch.mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Promise<Response>(resolve => {
          resolveFilteredFetch = () =>
            resolve({
              ok: true,
              json: async () => ({
                output: [filteredRow],
                totalCount: 1,
                finishedQuery: 'SELECT filtered'
              })
            } as Response);
        });
      }

      return {
        ok: true,
        json: async () => ({
          output: [originalRow],
          totalCount: 1,
          finishedQuery: 'SELECT initial'
        })
      } as Response;
    });

    render(
      <SWRConfig value={{ provider: () => new Map(), revalidateOnFocus: false, dedupingInterval: 0 }}>
        <IsolatedDataGridCommons
          gridType="failedmeasurements"
          gridColumns={[
            { field: 'id', editable: false },
            { field: 'spCode', editable: true }
          ]}
          refresh={false}
          setRefresh={vi.fn()}
          dynamicButtons={[]}
          initialRow={originalRow}
          onDataUpdate={vi.fn().mockResolvedValue(undefined)}
        />
      </SWRConfig>
    );

    await waitFor(() => {
      expect(screen.getByTestId('row-state').textContent).toContain(ORIGINAL_TEST_SP_CODE);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Go Page 2' }));

    await waitFor(() => {
      expect(screen.getByTestId('pagination-state').textContent).toContain('"page":2');
    });
    expect(observedGetRowHeightProps.length).toBeGreaterThan(1);
    expect(observedGetRowHeightProps[observedGetRowHeightProps.length - 1]).toBe(observedGetRowHeightProps[0]);

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: 'Apply Panel Filter' }));

    expect(screen.getByTestId('filter-model-state').textContent).toContain(UPDATED_TEST_SP_CODE);
    expect(mockFetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);

    await act(async () => {
      vi.advanceTimersByTime(FILTER_APPLY_DEBOUNCE_MS);
      await Promise.resolve();
    });

    const postCalls = mockFetch.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(postCalls).toHaveLength(1);
    expect(String(postCalls[0][0])).toContain('/api/fixeddatafilter/failedmeasurements/testschema/0/50/1/1');

    expect(screen.getByTestId('pagination-state').textContent).toContain('"page":0');
    expect(screen.getByTestId('row-state').textContent).toContain(ORIGINAL_TEST_SP_CODE);
    expect(screen.queryByTestId('skeleton-grid-row')).not.toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(LOADING_BAR_VISIBLE_DELAY_MS);
      await Promise.resolve();
    });
    expect(screen.getByRole('progressbar')).toBeInTheDocument();

    vi.useRealTimers();
    await act(async () => {
      resolveFilteredFetch?.();
    });

    await waitFor(() => {
      expect(screen.getByTestId('row-state').textContent).toContain(UPDATED_TEST_SP_CODE);
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });
  });

  it('ignores same-value pagination echoes from the controlled DataGrid', async () => {
    echoSamePaginationOnRender = true;
    const originalRow = {
      id: 1,
      failedMeasurementID: 123,
      spCode: ORIGINAL_TEST_SP_CODE
    };

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        output: [originalRow],
        totalCount: 1,
        finishedQuery: 'SELECT initial'
      })
    } as Response);

    render(
      <SWRConfig value={{ provider: () => new Map(), revalidateOnFocus: false, dedupingInterval: 0 }}>
        <IsolatedDataGridCommons
          gridType="failedmeasurements"
          gridColumns={[
            { field: 'id', editable: false },
            { field: 'spCode', editable: true }
          ]}
          refresh={false}
          setRefresh={vi.fn()}
          dynamicButtons={[]}
          initialRow={originalRow}
          onDataUpdate={vi.fn().mockResolvedValue(undefined)}
        />
      </SWRConfig>
    );

    await waitFor(() => {
      expect(screen.getByTestId('row-state').textContent).toContain(ORIGINAL_TEST_SP_CODE);
      expect(screen.getByTestId('pagination-state').textContent).toContain('"page":0');
    });
  });

  it('does not refetch when the filter panel creates an incomplete draft filter', async () => {
    const originalRow = {
      id: 1,
      failedMeasurementID: 123,
      spCode: ORIGINAL_TEST_SP_CODE
    };

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        output: [originalRow],
        totalCount: 1,
        finishedQuery: 'SELECT initial'
      })
    } as Response);

    render(
      <SWRConfig value={{ provider: () => new Map(), revalidateOnFocus: false, dedupingInterval: 0 }}>
        <IsolatedDataGridCommons
          gridType="failedmeasurements"
          gridColumns={[
            { field: 'id', editable: false },
            { field: 'spCode', editable: true }
          ]}
          refresh={false}
          setRefresh={vi.fn()}
          dynamicButtons={[]}
          initialRow={originalRow}
          onDataUpdate={vi.fn().mockResolvedValue(undefined)}
        />
      </SWRConfig>
    );

    await waitFor(() => {
      expect(screen.getByTestId('row-state').textContent).toContain(ORIGINAL_TEST_SP_CODE);
    });

    const initialFetchCount = mockFetch.mock.calls.length;

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: 'Open Draft Panel Filter' }));

    expect(screen.getByTestId('filter-model-state').textContent).toContain('spCode');
    expect(screen.getByTestId('filter-model-state').textContent).not.toContain(UPDATED_TEST_SP_CODE);

    await act(async () => {
      vi.advanceTimersByTime(FILTER_APPLY_DEBOUNCE_MS);
      await Promise.resolve();
    });

    expect(mockFetch).toHaveBeenCalledTimes(initialFetchCount);
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('skeleton-grid-row')).not.toBeInTheDocument();

    vi.useRealTimers();
  });

  it('does not render page-jump or infinite-scroll opt-ins by default', async () => {
    const originalRow = { id: 1, failedMeasurementID: 123, spCode: ORIGINAL_TEST_SP_CODE };
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ output: [originalRow], totalCount: 1, finishedQuery: 'SELECT 1' })
    } as Response);

    render(
      <SWRConfig value={{ provider: () => new Map(), revalidateOnFocus: false, dedupingInterval: 0 }}>
        <IsolatedDataGridCommons
          gridType="failedmeasurements"
          gridColumns={[
            { field: 'id', editable: false },
            { field: 'spCode', editable: true }
          ]}
          refresh={false}
          setRefresh={vi.fn()}
          dynamicButtons={[]}
          initialRow={originalRow}
        />
      </SWRConfig>
    );

    await waitFor(() => expect(screen.getByTestId('row-state').textContent).toContain(ORIGINAL_TEST_SP_CODE));

    expect(screen.getByTestId('pagination-slot-present').textContent).toBe('false');
    expect(screen.getByTestId('infinite-scroll-prop-present').textContent).toBe('false');
  });

  it('renders the pagination slot and infinite toolbar prop when both flags are enabled', async () => {
    const originalRow = { id: 1, failedMeasurementID: 123, spCode: ORIGINAL_TEST_SP_CODE };
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ output: [originalRow], totalCount: 1, finishedQuery: 'SELECT 1' })
    } as Response);

    render(
      <SWRConfig value={{ provider: () => new Map(), revalidateOnFocus: false, dedupingInterval: 0 }}>
        <IsolatedDataGridCommons
          gridType="failedmeasurements"
          gridColumns={[
            { field: 'id', editable: false },
            { field: 'spCode', editable: true }
          ]}
          refresh={false}
          setRefresh={vi.fn()}
          dynamicButtons={[]}
          initialRow={originalRow}
          enablePageJump
          enableInfiniteScroll
        />
      </SWRConfig>
    );

    await waitFor(() => expect(screen.getByTestId('row-state').textContent).toContain(ORIGINAL_TEST_SP_CODE));

    expect(screen.getByTestId('pagination-slot-present').textContent).toBe('true');
    expect(screen.getByTestId('infinite-scroll-prop-present').textContent).toBe('true');
    expect(screen.getByTestId('infinite-scroll-enabled').textContent).toBe('false');
  });

  it('toggling infinite mode flips the infinite-scroll enabled flag on the pagination slot', async () => {
    const originalRow = { id: 1, failedMeasurementID: 123, spCode: ORIGINAL_TEST_SP_CODE };
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ output: [originalRow], totalCount: 1, finishedQuery: 'SELECT 1' })
    } as Response);

    render(
      <SWRConfig value={{ provider: () => new Map(), revalidateOnFocus: false, dedupingInterval: 0 }}>
        <IsolatedDataGridCommons
          gridType="failedmeasurements"
          gridColumns={[
            { field: 'id', editable: false },
            { field: 'spCode', editable: true }
          ]}
          refresh={false}
          setRefresh={vi.fn()}
          dynamicButtons={[]}
          initialRow={originalRow}
          enablePageJump
          enableInfiniteScroll
        />
      </SWRConfig>
    );

    await waitFor(() => expect(screen.getByTestId('row-state').textContent).toContain(ORIGINAL_TEST_SP_CODE));

    fireEvent.click(screen.getByRole('button', { name: 'Test Toggle Infinite On' }));

    await waitFor(() => {
      expect(screen.getByTestId('infinite-scroll-enabled').textContent).toBe('true');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Test Toggle Infinite Off' }));

    await waitFor(() => {
      expect(screen.getByTestId('infinite-scroll-enabled').textContent).toBe('false');
    });
  });

  it('omits the CSV export handler for stemtaxonomiesview (no formdownload endpoint) but provides it for a grid that can export', async () => {
    // The toolbar renders its "Export as CSV" button only when handleExportCSV is a function
    // (datagridelements hasAnyExport). exportAllCSV has no stemtaxonomiesview case, so passing the
    // handler would surface a button that silently no-ops. This asserts the handler is withheld.
    const row = { id: 1, speciesID: 1, spCode: ORIGINAL_TEST_SP_CODE };
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ output: [row], totalCount: 1, finishedQuery: 'SELECT 1' })
    } as Response);

    const gridColumns = [
      { field: 'id', editable: false },
      { field: 'spCode', editable: true }
    ];

    // Control: alltaxonomiesview has a real export path (species formdownload), so the handler is passed.
    const { unmount } = render(
      <SWRConfig value={{ provider: () => new Map(), revalidateOnFocus: false, dedupingInterval: 0 }}>
        <IsolatedDataGridCommons
          gridType="alltaxonomiesview"
          gridColumns={gridColumns}
          refresh={false}
          setRefresh={vi.fn()}
          dynamicButtons={[]}
          initialRow={row}
        />
      </SWRConfig>
    );
    await waitFor(() => expect(screen.getByTestId('row-state').textContent).toContain(ORIGINAL_TEST_SP_CODE));
    expect(screen.getByTestId('export-csv-handler-present').textContent).toBe('true');
    unmount();

    render(
      <SWRConfig value={{ provider: () => new Map(), revalidateOnFocus: false, dedupingInterval: 0 }}>
        <IsolatedDataGridCommons
          gridType="stemtaxonomiesview"
          gridColumns={gridColumns}
          refresh={false}
          setRefresh={vi.fn()}
          dynamicButtons={[]}
          initialRow={row}
        />
      </SWRConfig>
    );
    await waitFor(() => expect(screen.getByTestId('row-state').textContent).toContain(ORIGINAL_TEST_SP_CODE));
    expect(screen.getByTestId('export-csv-handler-present').textContent).toBe('false');
  });

  // gridType 'attributes' drives every case below except the two editFlowOverride ones:
  // persistRow refuses an existing-row save for gridType 'failedmeasurements' without an
  // editFlowOverride (PR #483's preview/apply guard, see 'rejects failed-measurement saves
  // without an override' above), which would short-circuit before ever reaching
  // updateRow/fetch. This suite exercises the generic PATCH `changed`-flag reporting, and the
  // real #481 repro is the Attributes grid's DIR26 edit, not a failed-measurement correction -
  // so it uses attributes' own gridID ('code') and fields, matching
  // isolateddatagridcommons.editflush.test.tsx's fixture. The two editFlowOverride tests keep
  // gridType 'failedmeasurements': that is the real preview/apply wiring
  // isolatedfailedmeasurementsdatagrid.tsx uses, and an override bypasses the guard above
  // regardless of gridType.
  describe('no-op save reporting', () => {
    const ATTRIBUTE_CODE = 'DIR26';
    const originalAttributeRow = { id: 1, code: ATTRIBUTE_CODE, description: 'Original attribute description' };
    const updatedAttributeRow = { ...originalAttributeRow, description: 'Edited attribute description' };
    const ATTRIBUTE_GRID_COLUMNS = [
      { field: 'id', editable: false },
      { field: 'code', editable: false },
      { field: 'description', editable: true }
    ];

    const originalFailedMeasurementRow = { id: 1, failedMeasurementID: 123, spCode: ORIGINAL_TEST_SP_CODE };
    const updatedFailedMeasurementRow = { ...originalFailedMeasurementRow, spCode: UPDATED_TEST_SP_CODE };
    const FAILED_MEASUREMENT_GRID_COLUMNS = [
      { field: 'id', editable: false },
      { field: 'spCode', editable: true }
    ];

    const renderEditableGrid = (
      gridType: string,
      row: Record<string, unknown>,
      rowAfterEdit: Record<string, unknown>,
      extraProps: Record<string, unknown> = {}
    ) => {
      mockGetRowWithUpdatedValues.mockReturnValue(rowAfterEdit);
      return render(
        <SWRConfig value={{ provider: () => new Map(), revalidateOnFocus: false, dedupingInterval: 0 }}>
          <IsolatedDataGridCommons
            gridType={gridType}
            gridColumns={gridType === 'attributes' ? ATTRIBUTE_GRID_COLUMNS : FAILED_MEASUREMENT_GRID_COLUMNS}
            refresh={false}
            setRefresh={vi.fn()}
            dynamicButtons={[]}
            initialRow={row}
            onDataUpdate={vi.fn().mockResolvedValue(undefined)}
            {...extraProps}
          />
        </SWRConfig>
      );
    };

    const driveEditSaveConfirm = async (originalText: string) => {
      await waitFor(() => {
        expect(screen.getByTestId('row-state').textContent).toContain(originalText);
      });

      fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Save Changes' }));
    };

    it('shows the no-changes info toast, and neither success toast, when the PATCH reports changed:false', async () => {
      let patchURL: string | undefined;
      mockFetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'PATCH') {
          patchURL = String(input);
          return new Response(JSON.stringify({ message: 'Update successful', changed: false }), {
            status: HTTPResponses.OK,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        return {
          ok: true,
          json: async () => ({ output: [originalAttributeRow], totalCount: 1, finishedQuery: 'SELECT 1' })
        } as Response;
      });

      renderEditableGrid('attributes', originalAttributeRow, updatedAttributeRow);
      await driveEditSaveConfirm(originalAttributeRow.description);

      const alert = await screen.findByRole('alert');
      expect(alert, 'a changed:false PATCH response must surface the no-changes info toast').toHaveTextContent(NO_CHANGES_SAVED_MESSAGE);
      expect(alert, 'the no-changes toast must render as an info Alert, not success, so it reads as a warning rather than a confirmation').toHaveClass(
        'MuiAlert-standardInfo'
      );
      expect(screen.queryByText(ROW_UPDATED_MESSAGE), 'the success toast must not also appear alongside the no-changes toast').not.toBeInTheDocument();
      expect(screen.queryByText('Row successfully updated!'), 'the confirm-modal success toast must not paper over a no-op save').not.toBeInTheDocument();
      expect(patchURL, 'the attributes grid must PATCH the real fixeddata endpoint keyed on its gridID (code)').toContain(
        `/api/fixeddata/attributes/${TEST_SCHEMA}/code`
      );
    });

    it('leads with the no-changes fact, and never claims a save happened, when a changed:false save also fails to refresh', async () => {
      // handleConfirmAction must check outcome.changed === false BEFORE outcome.followUpError:
      // a no-op save (the server made no change) whose post-save refresh then fails must not be
      // reported as "Changes were saved, but the grid could not refresh" - the server already
      // said nothing was saved, so that phrasing would be a false claim on top of a real error.
      // finishPersistedSave folds a rejecting onDataUpdate into followUpError, so a rejecting
      // onDataUpdate here reproduces the exact case it catches.
      const refreshFailureMessage = 'onDataUpdate rejected: could not refresh the grid';
      mockFetch.mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'PATCH') {
          return new Response(JSON.stringify({ message: 'Update successful', changed: false }), {
            status: HTTPResponses.OK,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        return {
          ok: true,
          json: async () => ({ output: [originalAttributeRow], totalCount: 1, finishedQuery: 'SELECT 1' })
        } as Response;
      });

      renderEditableGrid('attributes', originalAttributeRow, updatedAttributeRow, {
        onDataUpdate: vi.fn().mockRejectedValue(new Error(refreshFailureMessage))
      });
      await driveEditSaveConfirm(originalAttributeRow.description);

      const alert = await screen.findByRole('alert');
      expect(alert, 'a no-op save whose refresh also fails must still lead with the no-changes fact').toHaveTextContent(NO_CHANGES_SAVED_MESSAGE);
      expect(alert, 'the refresh failure must be reported alongside the no-changes fact, not silently dropped').toHaveTextContent(refreshFailureMessage);
      expect(alert.textContent, 'must never claim the save happened when changed:false says it did not').not.toContain('Changes were saved');
    });

    it('shows the no-changes info toast for the plain #481 shape: an edit that resubmits the unmodified row', async () => {
      // The exact repro from #481: the user "edits" a field but the grid's getRowWithUpdatedValues
      // hands back a row identical to what's on the server, and the server correctly reports
      // changed:false. This must not be confused with a fetch/parse failure or a real update.
      let capturedPatchBody: { oldRow: unknown; newRow: { description: string } } | undefined;
      mockFetch.mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'PATCH') {
          capturedPatchBody = JSON.parse(String(init.body));
          return new Response(JSON.stringify({ message: 'Update successful', changed: false }), {
            status: HTTPResponses.OK,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        return {
          ok: true,
          json: async () => ({ output: [originalAttributeRow], totalCount: 1, finishedQuery: 'SELECT 1' })
        } as Response;
      });

      renderEditableGrid('attributes', originalAttributeRow, updatedAttributeRow);
      // renderEditableGrid's first statement points getRowWithUpdatedValues at rowAfterEdit, so
      // this must be set afterward - it's read later, inside handleSaveClick, when the Save icon
      // is clicked - to actually exercise "the user's edit round-trips to an unchanged row"
      // instead of silently submitting a real change.
      mockGetRowWithUpdatedValues.mockReturnValue(originalAttributeRow);
      await driveEditSaveConfirm(originalAttributeRow.description);

      const alert = await screen.findByRole('alert');
      expect(alert, 'an identical-row resubmit with changed:false must surface the no-changes info toast, not a success toast').toHaveTextContent(
        NO_CHANGES_SAVED_MESSAGE
      );
      expect(screen.queryByText(ROW_UPDATED_MESSAGE), 'an unmodified row must never be reported as a successful update').not.toBeInTheDocument();
      expect(capturedPatchBody?.newRow.description, 'the PATCH body must carry the unmodified row, not a synthetic diff').toBe(
        originalAttributeRow.description
      );
      expect(capturedPatchBody?.newRow.description, 'this test only proves something if the submitted row is NOT the updated value').not.toBe(
        updatedAttributeRow.description
      );
    });

    it('shows the ROW_UPDATED_MESSAGE success toast when the PATCH reports changed:true', async () => {
      let patchSeen = false;
      mockFetch.mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'PATCH') {
          patchSeen = true;
          return new Response(JSON.stringify({ message: 'Update successful', changed: true }), {
            status: HTTPResponses.OK,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        return {
          ok: true,
          json: async () => ({ output: [patchSeen ? updatedAttributeRow : originalAttributeRow], totalCount: 1, finishedQuery: 'SELECT 1' })
        } as Response;
      });

      renderEditableGrid('attributes', originalAttributeRow, updatedAttributeRow);
      await driveEditSaveConfirm(originalAttributeRow.description);

      expect(await screen.findByText(ROW_UPDATED_MESSAGE), 'a changed:true PATCH response must surface the success toast').toBeInTheDocument();
      expect(screen.queryByText(NO_CHANGES_SAVED_MESSAGE), 'a real change must not surface the no-changes toast').not.toBeInTheDocument();
    });

    it('shows the ROW_UPDATED_MESSAGE success toast on the direct row-edit path (no confirm dialog) when the PATCH reports changed:true', async () => {
      // processRowUpdate's own success branch (MUI calls this directly when row edit stops via
      // Tab-out-of-last-cell or programmatically, bypassing the Save-icon confirm dialog
      // entirely) used to toast nothing on success or a no-op. describeSaveOutcome now backs
      // both paths, so this must report the same outcome handleConfirmAction does.
      let patchURL: string | undefined;
      let patchSeen = false;
      mockFetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'PATCH') {
          patchURL = String(input);
          patchSeen = true;
          return new Response(JSON.stringify({ message: 'Update successful', changed: true }), {
            status: HTTPResponses.OK,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        return {
          ok: true,
          json: async () => ({ output: [patchSeen ? updatedAttributeRow : originalAttributeRow], totalCount: 1, finishedQuery: 'SELECT 1' })
        } as Response;
      });

      renderEditableGrid('attributes', originalAttributeRow, updatedAttributeRow);
      await waitFor(() => expect(screen.getByTestId('row-state').textContent).toContain(originalAttributeRow.description));

      fireEvent.click(screen.getByRole('button', { name: 'Test Process Row' }));

      expect(
        await screen.findByText(ROW_UPDATED_MESSAGE),
        'the direct row-edit path must report success too, not just the confirm-dialog path'
      ).toBeInTheDocument();
      expect(screen.queryByText(NO_CHANGES_SAVED_MESSAGE), 'a real change on the direct path must not surface the no-changes toast').not.toBeInTheDocument();
      expect(patchURL, 'the direct path must still PATCH the real fixeddata endpoint').toContain(`/api/fixeddata/attributes/${TEST_SCHEMA}/code`);
      expect(capturedProcessPromises, 'the mock button must have actually invoked processRowUpdate').toHaveLength(1);
      await expect(
        capturedProcessPromises[0],
        'MUI still needs the saved row back from processRowUpdate, independent of the toast it now also shows'
      ).resolves.toMatchObject(updatedAttributeRow);
    });

    it('shows the NO_CHANGES_SAVED_MESSAGE info toast on the direct row-edit path (no confirm dialog) when the PATCH reports changed:false', async () => {
      // Same #481 no-op shape as the confirm-dialog tests above, but exercised through
      // processRowUpdate's direct success branch instead of handleConfirmAction. Before this
      // fix, a no-op save on this path reported nothing at all.
      let patchURL: string | undefined;
      mockFetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'PATCH') {
          patchURL = String(input);
          return new Response(JSON.stringify({ message: 'Update successful', changed: false }), {
            status: HTTPResponses.OK,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        return {
          ok: true,
          json: async () => ({ output: [originalAttributeRow], totalCount: 1, finishedQuery: 'SELECT 1' })
        } as Response;
      });

      renderEditableGrid('attributes', originalAttributeRow, updatedAttributeRow);
      await waitFor(() => expect(screen.getByTestId('row-state').textContent).toContain(originalAttributeRow.description));

      fireEvent.click(screen.getByRole('button', { name: 'Test Process Row' }));

      const alert = await screen.findByRole('alert');
      expect(alert, 'a changed:false PATCH on the direct path must surface the no-changes info toast').toHaveTextContent(NO_CHANGES_SAVED_MESSAGE);
      expect(alert, 'the no-changes toast on the direct path must render as an info Alert, not success').toHaveClass('MuiAlert-standardInfo');
      expect(
        screen.queryByText(ROW_UPDATED_MESSAGE),
        'the success toast must not also appear alongside the direct-path no-changes toast'
      ).not.toBeInTheDocument();
      expect(patchURL, 'the direct path must still PATCH the real fixeddata endpoint').toContain(`/api/fixeddata/attributes/${TEST_SCHEMA}/code`);
      expect(capturedProcessPromises, 'the mock button must have actually invoked processRowUpdate').toHaveLength(1);
      await expect(
        capturedProcessPromises[0],
        'a no-op save must still hand MUI back the row it submitted, independent of the info toast'
      ).resolves.toMatchObject(updatedAttributeRow);
    });

    it('leads with the no-changes fact, and never claims a save happened, on the direct row-edit path when a changed:false save also fails to refresh', async () => {
      // Mirrors the confirm-dialog version of this test above: outcome.changed === false must be
      // checked before outcome.followUpError so a no-op save whose post-save refresh then fails is
      // never reported as "Changes were saved, but the grid could not refresh" - the server already
      // said nothing was saved. describeSaveOutcome backs both paths, so the direct path must get
      // this right too, not just handleConfirmAction.
      const refreshFailureMessage = 'onDataUpdate rejected: could not refresh the grid';
      mockFetch.mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'PATCH') {
          return new Response(JSON.stringify({ message: 'Update successful', changed: false }), {
            status: HTTPResponses.OK,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        return {
          ok: true,
          json: async () => ({ output: [originalAttributeRow], totalCount: 1, finishedQuery: 'SELECT 1' })
        } as Response;
      });

      renderEditableGrid('attributes', originalAttributeRow, updatedAttributeRow, {
        onDataUpdate: vi.fn().mockRejectedValue(new Error(refreshFailureMessage))
      });
      await waitFor(() => expect(screen.getByTestId('row-state').textContent).toContain(originalAttributeRow.description));

      fireEvent.click(screen.getByRole('button', { name: 'Test Process Row' }));

      const alert = await screen.findByRole('alert');
      expect(alert, 'a no-op save whose refresh also fails must still lead with the no-changes fact on the direct path').toHaveTextContent(
        NO_CHANGES_SAVED_MESSAGE
      );
      expect(alert, 'the refresh failure must be reported alongside the no-changes fact, not silently dropped').toHaveTextContent(refreshFailureMessage);
      expect(alert.textContent, 'must never claim the save happened when changed:false says it did not').not.toContain('Changes were saved');
    });

    it('falls back to the success toast when the PATCH body omits changed (backward compatibility)', async () => {
      let patchSeen = false;
      mockFetch.mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'PATCH') {
          patchSeen = true;
          return new Response(JSON.stringify({ message: 'Update successful' }), {
            status: HTTPResponses.OK,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        return {
          ok: true,
          json: async () => ({ output: [patchSeen ? updatedAttributeRow : originalAttributeRow], totalCount: 1, finishedQuery: 'SELECT 1' })
        } as Response;
      });

      renderEditableGrid('attributes', originalAttributeRow, updatedAttributeRow);
      await driveEditSaveConfirm(originalAttributeRow.description);

      expect(
        await screen.findByText(ROW_UPDATED_MESSAGE),
        'an endpoint that does not report changed must keep reporting success (e.g. /api/administrative/fetch)'
      ).toBeInTheDocument();
      expect(screen.queryByText(NO_CHANGES_SAVED_MESSAGE), 'omitted changed must never be treated as a no-op').not.toBeInTheDocument();
    });

    it('shows NEW_ROW_ADDED_MESSAGE, never the no-changes toast, after a POST - even one whose response includes changed:false', async () => {
      // updateRow derives `changed` only on the existing-row/PATCH branch (see the PersistResult
      // comment above it); the POST/insert branch always returns `changed: undefined`. This uses
      // the idiom from 'creates an explicit new row with one POST after confirmation' above, and
      // additionally has the POST response carry changed:false - a shape the real fixeddata POST
      // handler doesn't send today - to prove a future one could not misreport a real insert as
      // the #481 no-op bug.
      const originalRow = { id: 1, personID: 123, personName: 'Original' };
      const createdRow = { ...originalRow, id: 42, personnelID: 42 };
      let postCount = 0;
      mockFetch.mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'POST') {
          postCount += 1;
          return new Response(JSON.stringify({ message: 'created', createdIDs: { personnel: 42 }, changed: false }), {
            status: HTTPResponses.OK,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        return { ok: true, json: async () => ({ output: [postCount ? createdRow : originalRow], totalCount: 1, finishedQuery: 'SELECT 1' }) } as Response;
      });

      render(
        <SWRConfig value={{ provider: () => new Map(), revalidateOnFocus: false, dedupingInterval: 0 }}>
          <IsolatedDataGridCommons
            gridType="personnel"
            gridColumns={[
              { field: 'id', editable: false },
              { field: 'personName', editable: true }
            ]}
            refresh={false}
            setRefresh={vi.fn()}
            dynamicButtons={[]}
            initialRow={originalRow}
          />
        </SWRConfig>
      );

      await waitFor(() => expect(screen.getByTestId('row-state').textContent).toContain('Original'));
      fireEvent.click(screen.getByRole('button', { name: 'Test Add New Row' }));
      await waitFor(() => expect(screen.getByTestId('row-state').textContent).toContain('"isNew":true'));
      fireEvent.click(screen.getByRole('button', { name: 'Test Process New Row' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Save Changes' }));
      await waitFor(() => expect(postCount).toBe(1));

      expect(
        await screen.findByText(NEW_ROW_ADDED_MESSAGE),
        'a POST/insert must report success even if its response body happens to include changed:false'
      ).toBeInTheDocument();
      expect(
        screen.queryByText(NO_CHANGES_SAVED_MESSAGE),
        'the POST/insert branch must never derive `changed` from the response, or a future changed:false there would misreport a real insert as the #481 no-op bug'
      ).not.toBeInTheDocument();
    });

    it('shows the ROW_UPDATED_MESSAGE success toast once editFlowOverride resolves, without issuing its own PATCH', async () => {
      // applyEditViaPreviewFlow (isolatedfailedmeasurementsdatagrid.tsx) owns applying the
      // edit; handleConfirmAction now owns the resulting toast (PR #483). editFlowOverride
      // reports `changed` explicitly (EditFlowPersistResult) - here it reports changed:true,
      // so handleConfirmAction's `else if (outcome)` branch reports the same success message
      // as a plain updateRow save.
      let overrideCalled = false;
      mockFetch.mockImplementation(async (_input: RequestInfo | URL) => {
        return {
          ok: true,
          json: async () => ({
            output: [overrideCalled ? updatedFailedMeasurementRow : originalFailedMeasurementRow],
            totalCount: 1,
            finishedQuery: 'SELECT 1'
          })
        } as Response;
      });

      const editFlowOverride = vi.fn().mockImplementation(async () => {
        overrideCalled = true;
        return { row: updatedFailedMeasurementRow, changed: true };
      });
      renderEditableGrid('failedmeasurements', originalFailedMeasurementRow, updatedFailedMeasurementRow, { editFlowOverride });
      await driveEditSaveConfirm(ORIGINAL_TEST_SP_CODE);

      await waitFor(() => {
        expect(editFlowOverride, 'the preview flow bypasses updateRow entirely').toHaveBeenCalledTimes(1);
      });
      expect(
        mockFetch.mock.calls.some(([, init]) => init?.method === 'PATCH'),
        'editFlowOverride must not also PATCH via updateRow'
      ).toBe(false);
      expect(await screen.findByText(ROW_UPDATED_MESSAGE), 'a resolved editFlowOverride must surface the standard success toast').toBeInTheDocument();
      expect(screen.queryByText(NO_CHANGES_SAVED_MESSAGE), 'an override reporting changed:true must never show the no-op toast').not.toBeInTheDocument();
    });

    it('shows an error toast with the failure message when editFlowOverride rejects, instead of swallowing it', async () => {
      // performSaveAction's catch previously only called promiseArguments.reject, which is a
      // no-op for the Save-icon flow (handleSaveClick sets resolve/reject to no-ops), so a
      // rejected override silently reported nothing to the user.
      const failureMessage = 'preview apply failed';
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ output: [originalFailedMeasurementRow], totalCount: 1, finishedQuery: 'SELECT 1' })
      } as Response);

      const editFlowOverride = vi.fn().mockRejectedValue(new Error(failureMessage));
      renderEditableGrid('failedmeasurements', originalFailedMeasurementRow, updatedFailedMeasurementRow, { editFlowOverride });
      await driveEditSaveConfirm(ORIGINAL_TEST_SP_CODE);

      expect(await screen.findByText(`Error: ${failureMessage}`), 'a rejected editFlowOverride must surface its error message in a toast').toBeInTheDocument();
      expect(screen.queryByText(ROW_UPDATED_MESSAGE), 'a failed save must never show the success toast').not.toBeInTheDocument();
      expect(screen.queryByText(NO_CHANGES_SAVED_MESSAGE), 'a failed save must never show the no-changes toast').not.toBeInTheDocument();
    });

    it('shows the override infoMessage (not the generic no-changes text) when editFlowOverride reports changed:false (confirm-dialog path)', async () => {
      // The failed-measurements grid's applyEditViaPreviewFlow reports changed:false with a
      // rounding explanation for a pure no-op save; describeSaveOutcome must prefer that
      // specific infoMessage over the generic NO_CHANGES_SAVED_MESSAGE.
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ output: [originalFailedMeasurementRow], totalCount: 1, finishedQuery: 'SELECT 1' })
      } as Response);

      const overrideInfoMessage = 'No change saved: DBH rounded to the existing value (server stores at fixed precision).';
      const editFlowOverride = vi.fn().mockResolvedValue({ row: originalFailedMeasurementRow, changed: false, infoMessage: overrideInfoMessage });
      renderEditableGrid('failedmeasurements', originalFailedMeasurementRow, updatedFailedMeasurementRow, { editFlowOverride });
      await driveEditSaveConfirm(ORIGINAL_TEST_SP_CODE);

      const alert = await screen.findByRole('alert');
      expect(alert, 'an override-reported no-op with an infoMessage must surface that exact message').toHaveTextContent(overrideInfoMessage);
      expect(alert, 'the no-changes toast must render as an info Alert, not success').toHaveClass('MuiAlert-standardInfo');
      expect(screen.queryByText(ROW_UPDATED_MESSAGE)).not.toBeInTheDocument();
      expect(screen.queryByText(NO_CHANGES_SAVED_MESSAGE), 'a specific infoMessage must replace the generic no-changes text').not.toBeInTheDocument();
    });

    it('shows the override infoMessage on the direct row-edit path (no confirm dialog) when editFlowOverride reports changed:false', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ output: [originalFailedMeasurementRow], totalCount: 1, finishedQuery: 'SELECT 1' })
      } as Response);

      const overrideInfoMessage = 'No change saved: DBH rounded to the existing value (server stores at fixed precision).';
      const editFlowOverride = vi.fn().mockResolvedValue({ row: originalFailedMeasurementRow, changed: false, infoMessage: overrideInfoMessage });
      renderEditableGrid('failedmeasurements', originalFailedMeasurementRow, updatedFailedMeasurementRow, { editFlowOverride });
      await waitFor(() => expect(screen.getByTestId('row-state').textContent).toContain(ORIGINAL_TEST_SP_CODE));

      fireEvent.click(screen.getByRole('button', { name: 'Test Process Row' }));

      const alert = await screen.findByRole('alert');
      expect(alert, 'the direct path must surface the same override infoMessage as the confirm-dialog path').toHaveTextContent(overrideInfoMessage);
      expect(alert, 'the no-changes toast on the direct path must render as an info Alert, not success').toHaveClass('MuiAlert-standardInfo');
      expect(screen.queryByText(ROW_UPDATED_MESSAGE)).not.toBeInTheDocument();
      expect(capturedProcessPromises, 'the mock button must have actually invoked processRowUpdate').toHaveLength(1);
      await expect(capturedProcessPromises[0], 'a no-op override save must still hand MUI back its row').resolves.toMatchObject(originalFailedMeasurementRow);
    });

    it('leads with the composite no-changes/refresh-failure text over an override infoMessage when a changed:false override save also fails to refresh', async () => {
      // Mirrors the PATCH-driven composite-priority tests above (outcome.changed === false
      // with a followUpError outranks a plain info message), but for an editFlowOverride that
      // reports its own infoMessage - the composite error text must still win.
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ output: [originalFailedMeasurementRow], totalCount: 1, finishedQuery: 'SELECT 1' })
      } as Response);
      const overrideInfoMessage = 'No change saved: DBH rounded to the existing value (server stores at fixed precision).';
      const refreshFailureMessage = 'onDataUpdate rejected: could not refresh the grid';
      const editFlowOverride = vi.fn().mockResolvedValue({ row: originalFailedMeasurementRow, changed: false, infoMessage: overrideInfoMessage });
      renderEditableGrid('failedmeasurements', originalFailedMeasurementRow, updatedFailedMeasurementRow, {
        editFlowOverride,
        onDataUpdate: vi.fn().mockRejectedValue(new Error(refreshFailureMessage))
      });
      await driveEditSaveConfirm(ORIGINAL_TEST_SP_CODE);

      const alert = await screen.findByRole('alert');
      expect(alert, 'the composite no-changes+refresh-failure text must win over an override infoMessage').toHaveTextContent(NO_CHANGES_SAVED_MESSAGE);
      expect(alert).toHaveTextContent(refreshFailureMessage);
      expect(alert.textContent, 'must never claim the save happened').not.toContain('Changes were saved');
      expect(alert.textContent, 'the override infoMessage must not appear once the composite error wins').not.toContain(overrideInfoMessage);
    });

    it('shows responseErrorMessage’s server-error text on a failed confirmed PATCH, instead of a stringified rejected row', async () => {
      // updateRow throws responseErrorMessage(responseJSON, response) on a non-ok PATCH.
      // performSaveAction's catch used to toast unconditionally with `String(error)`, which for a
      // plain object stringifies to "[object Object]"; that regression is what this test guards
      // against. This is the Save-icon confirm flow, no editFlowOverride.
      const serverErrorMessage = 'Row is locked by another session';
      mockFetch.mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'PATCH') {
          return new Response(JSON.stringify({ message: serverErrorMessage }), {
            status: HTTPResponses.LOCKED,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        return {
          ok: true,
          json: async () => ({ output: [originalAttributeRow], totalCount: 1, finishedQuery: 'SELECT 1' })
        } as Response;
      });

      renderEditableGrid('attributes', originalAttributeRow, updatedAttributeRow);
      await driveEditSaveConfirm(originalAttributeRow.description);

      expect(
        await screen.findByText(`Error: ${serverErrorMessage}`),
        'a failed PATCH must surface the real server error message, not a stringified row'
      ).toBeInTheDocument();
      expect(
        screen.queryByText('Error: [object Object]'),
        'performSaveAction must not overwrite updateRow’s toast by stringifying the rejected row'
      ).not.toBeInTheDocument();
      expect(screen.queryByText(ROW_UPDATED_MESSAGE), 'a failed save must never show the success toast').not.toBeInTheDocument();
      expect(screen.queryByText(NO_CHANGES_SAVED_MESSAGE), 'a failed save must never show the no-changes toast').not.toBeInTheDocument();
    });
  });

  describe('persisted column layout', () => {
    const PERSISTED_GRID_TYPE = 'failedmeasurements';
    const RESTORED_WIDTH = 200;
    const RESIZED_WIDTH = 321;

    const renderGrid = (gridType: string) => {
      const row = { id: 1, failedMeasurementID: 123, spCode: ORIGINAL_TEST_SP_CODE };
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ output: [row], totalCount: 1, finishedQuery: 'SELECT 1' })
      } as Response);
      return render(
        <SWRConfig value={{ provider: () => new Map(), revalidateOnFocus: false, dedupingInterval: 0 }}>
          <IsolatedDataGridCommons
            gridType={gridType}
            gridColumns={[
              { field: 'id', editable: false },
              { field: 'plotName', editable: false }
            ]}
            refresh={false}
            setRefresh={vi.fn()}
            dynamicButtons={[]}
            initialRow={row}
          />
        </SWRConfig>
      );
    };

    const readInitialState = () => JSON.parse(screen.getByTestId('initial-state').textContent ?? 'null');

    it('restores a saved per-gridType layout (visibility + widths) into the grid initial state', async () => {
      writePersistedGridLayout(PERSISTED_GRID_TYPE, {
        visibility: { plotName: false },
        widths: { plotName: RESTORED_WIDTH }
      });

      renderGrid(PERSISTED_GRID_TYPE);
      await waitFor(() => expect(screen.getByTestId('row-state').textContent).toContain(ORIGINAL_TEST_SP_CODE));

      const initialState = readInitialState();
      // Default hidden-ID model is preserved and the saved visibility is layered over it.
      expect(initialState.columns.columnVisibilityModel).toMatchObject({ id: false, plotName: false });
      // Saved width is applied through the v8 initialState.columns.dimensions path.
      expect(initialState.columns.dimensions).toEqual({ plotName: { width: RESTORED_WIDTH } });
    });

    it('falls back to defaults and clears the poisoned key when the stored layout is corrupt', async () => {
      const key = gridLayoutStorageKey(PERSISTED_GRID_TYPE);
      localStorage.setItem(key, '{ this is not valid json');

      renderGrid(PERSISTED_GRID_TYPE);
      await waitFor(() => expect(screen.getByTestId('row-state').textContent).toContain(ORIGINAL_TEST_SP_CODE));

      const initialState = readInitialState();
      expect(initialState.columns.columnVisibilityModel).toEqual({ id: false });
      expect(initialState.columns.dimensions).toBeUndefined();
      expect(localStorage.getItem(key)).toBeNull();
    });

    it('leaves the default initial state untouched when no layout is saved', async () => {
      renderGrid(PERSISTED_GRID_TYPE);
      await waitFor(() => expect(screen.getByTestId('row-state').textContent).toContain(ORIGINAL_TEST_SP_CODE));

      const initialState = readInitialState();
      expect(initialState.columns.columnVisibilityModel).toEqual({ id: false });
      expect(initialState.columns.dimensions).toBeUndefined();
    });

    it('persists column visibility changes under the per-gridType key', async () => {
      renderGrid(PERSISTED_GRID_TYPE);
      await waitFor(() => expect(screen.getByTestId('row-state').textContent).toContain(ORIGINAL_TEST_SP_CODE));

      fireEvent.click(screen.getByRole('button', { name: 'Hide PlotName Column' }));

      const saved = readPersistedGridLayout(PERSISTED_GRID_TYPE);
      expect(saved?.visibility).toEqual({ plotName: false });
    });

    it('persists resized column widths under the per-gridType key', async () => {
      renderGrid(PERSISTED_GRID_TYPE);
      await waitFor(() => expect(screen.getByTestId('row-state').textContent).toContain(ORIGINAL_TEST_SP_CODE));

      fireEvent.click(screen.getByRole('button', { name: 'Resize PlotName Column' }));

      const saved = readPersistedGridLayout(PERSISTED_GRID_TYPE);
      expect(saved?.widths).toEqual({ plotName: RESIZED_WIDTH });
    });

    it('swallows storage-quota DOMExceptions on write so a failed persist cannot break the resize handler', async () => {
      renderGrid(PERSISTED_GRID_TYPE);
      await waitFor(() => expect(screen.getByTestId('row-state').textContent).toContain(ORIGINAL_TEST_SP_CODE));

      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('quota exceeded', 'QuotaExceededError');
      });
      try {
        expect(() => fireEvent.click(screen.getByRole('button', { name: 'Resize PlotName Column' }))).not.toThrow();
        expect(setItemSpy).toHaveBeenCalled();
      } finally {
        setItemSpy.mockRestore();
      }
      expect(readPersistedGridLayout(PERSISTED_GRID_TYPE)).toBeNull();
    });

    it('a visibility write followed by a width write in the same session preserves both in storage', async () => {
      renderGrid(PERSISTED_GRID_TYPE);
      await waitFor(() => expect(screen.getByTestId('row-state').textContent).toContain(ORIGINAL_TEST_SP_CODE));

      fireEvent.click(screen.getByRole('button', { name: 'Hide PlotName Column' }));
      fireEvent.click(screen.getByRole('button', { name: 'Resize PlotName Column' }));

      const saved = readPersistedGridLayout(PERSISTED_GRID_TYPE);
      expect(saved).toEqual({
        visibility: { plotName: false },
        widths: { plotName: RESIZED_WIDTH }
      });
    });

    it('enables the column selector for viewfulltable so persisted hides remain recoverable, but keeps it disabled elsewhere', async () => {
      // With persistence, hiding a column via the column menu on a grid without the
      // Columns panel would be a one-way trap: nothing in the UI could unhide it.
      const { unmount } = renderGrid('viewfulltable');
      await waitFor(() => expect(screen.getByTestId('row-state').textContent).toContain(ORIGINAL_TEST_SP_CODE));
      expect(screen.getByTestId('column-selector-disabled').textContent).toBe('false');
      unmount();

      renderGrid(PERSISTED_GRID_TYPE);
      await waitFor(() => expect(screen.getByTestId('row-state').textContent).toContain(ORIGINAL_TEST_SP_CODE));
      expect(screen.getByTestId('column-selector-disabled').textContent).toBe('true');
    });
  });
});
