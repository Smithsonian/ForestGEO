import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SWRConfig } from 'swr';
import IsolatedDataGridCommons, {
  FILTER_APPLY_DEBOUNCE_MS,
  gridLayoutStorageKey,
  readPersistedGridLayout,
  writePersistedGridLayout
} from './isolateddatagridcommons';
import { LOADING_BAR_VISIBLE_DELAY_MS } from '@/components/loading';

const mockFetch = vi.fn();
const mockGetRowWithUpdatedValues = vi.fn();
const mockTriggerRefresh = vi.fn();
const observedGetRowHeightProps: unknown[] = [];
let echoSamePaginationOnRender = false;
const ORIGINAL_TEST_SP_CODE = 'TEST_SP_CODE_A';
const UPDATED_TEST_SP_CODE = 'TEST_SP_CODE_B';

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
  GridEventListener: {},
  GridFilterOperator: {},
  GridFilterModel: {},
  GridPreProcessEditCellProps: {},
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

        if (previousMode === 'edit' && nextMode === 'view' && props.processRowUpdate) {
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

    let patchSeen = false;
    mockFetch.mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        patchSeen = true;
        return {
          ok: true,
          json: async () => ({ message: 'Update successful' })
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({
          output: [patchSeen ? updatedRow : originalRow],
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
      const patchCalls = mockFetch.mock.calls.filter(([, init]) => init?.method === 'PATCH');
      const listCalls = mockFetch.mock.calls.filter(([, init]) => !init?.method || init.method === 'GET');

      expect(patchCalls).toHaveLength(1);
      expect(String(patchCalls[0][0])).toContain('/api/fixeddata/failedmeasurements/testschema/failedMeasurementID');
      expect(String(patchCalls[0][1]?.body)).toContain(UPDATED_TEST_SP_CODE);

      expect(listCalls).toHaveLength(initialListCallCount + 1);
      expect(screen.getByTestId('row-state').textContent).toContain(UPDATED_TEST_SP_CODE);
    });
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
