import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import IsolatedDataGridCommons from './isolateddatagridcommons';

const mockFetch = vi.fn();
const mockGetRowWithUpdatedValues = vi.fn();
const mockTriggerRefresh = vi.fn();

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
    global.fetch = mockFetch as any;
  });

  it('invalidates the cached page before refetching after a confirmed save', async () => {
    const originalRow = {
      id: 1,
      failedMeasurementID: 123,
      spCode: 'RUBI04'
    };
    const updatedRow = {
      ...originalRow,
      spCode: 'ANOPKL'
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
    );

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/api/fixeddata/failedmeasurements/testschema/0/10/1/1'), expect.any(Object));
      expect(screen.getByTestId('row-state').textContent).toContain('RUBI04');
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
      expect(String(patchCalls[0][1]?.body)).toContain('ANOPKL');

      expect(listCalls).toHaveLength(initialListCallCount + 1);
      expect(screen.getByTestId('row-state').textContent).toContain('ANOPKL');
    });
  });
});
