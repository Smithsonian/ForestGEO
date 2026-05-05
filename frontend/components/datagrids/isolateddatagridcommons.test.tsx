import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SWRConfig } from 'swr';
import IsolatedDataGridCommons, { FILTER_APPLY_DEBOUNCE_MS } from './isolateddatagridcommons';
import { LOADING_BAR_VISIBLE_DELAY_MS } from '@/components/loading';

const mockFetch = vi.fn();
const mockGetRowWithUpdatedValues = vi.fn();
const mockTriggerRefresh = vi.fn();
const observedGetRowHeightProps: unknown[] = [];
let echoSamePaginationOnRender = false;
const ORIGINAL_TEST_SP_CODE = 'TEST_SP_CODE_A';
const UPDATED_TEST_SP_CODE = 'TEST_SP_CODE_B';

vi.mock('@/config/sqlrdsdefinitions/views', () => ({
  getAllTaxonomiesViewHCs: () => ({}),
  getAllViewFullTableViewsHCs: () => ({}),
  getMeasurementsSummaryViewHCs: () => ({})
}));

vi.mock('@/config/sqlrdsdefinitions/zones', () => ({
  getQuadratHCs: () => ({})
}));

vi.mock('@/config/sqlrdsdefinitions/personnel', () => ({
  getPersonnelHCs: () => ({})
}));

vi.mock('@/config/sqlrdsdefinitions/core', async importOriginal => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    getCoreMeasurementsHCs: () => ({}),
    getFailedMeasurementsHCs: () => ({})
  };
});

vi.mock('@/config/sqlrdsdefinitions/taxonomies', () => ({
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
        <div data-testid="pagination-state">{JSON.stringify(props.paginationModel ?? null)}</div>
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
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/api/fixeddata/failedmeasurements/testschema/0/10/1/1'), expect.any(Object));
      expect(screen.getByTestId('row-state').textContent).toContain(ORIGINAL_TEST_SP_CODE);
    });
    const initialListCallCount = mockFetch.mock.calls.filter(([, init]) => !init?.method || init.method === 'GET').length;

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

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
    expect(String(postCalls[0][0])).toContain('/api/fixeddatafilter/failedmeasurements/testschema/0/10/1/1');

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
});
