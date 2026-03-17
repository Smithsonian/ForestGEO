import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EditToolbar } from './datagridelements';

vi.mock('@/config/sqlrdsdefinitions/core', async importOriginal => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return actual;
});

vi.mock('@mui/x-data-grid', () => ({
  ColumnsPanelTrigger: ({ render }: any) => <>{render}</>,
  FilterPanelTrigger: ({ render }: any) => <>{render}</>,
  QuickFilter: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  QuickFilterControl: ({ slotProps, ...props }: any) => <input aria-label={slotProps?.input?.['aria-label']} {...props} />,
  QuickFilterClear: ({ children, ...props }: any) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Toolbar: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  ToolbarButton: ({ children, ...props }: any) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  useGridApiContext: () => ({
    current: {
      state: {
        columns: {
          columnVisibilityModel: {}
        }
      }
    }
  })
}));

describe('EditToolbar', () => {
  const handleAddNewRow = vi.fn().mockResolvedValue(undefined);
  const handleRefresh = vi.fn().mockResolvedValue(undefined);
  const handleQuickFilterChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the invalid button only as an invalid-row filter toggle', async () => {
    const user = userEvent.setup();
    const toggleErrors = vi.fn();

    render(
      <EditToolbar
        handleAddNewRow={handleAddNewRow}
        handleRefresh={handleRefresh}
        handleQuickFilterChange={handleQuickFilterChange}
        filterModel={{
          items: [],
          quickFilterValues: [],
          visible: ['errors', 'valid', 'pending'],
          tss: ['old tree', 'multi stem', 'new recruit']
        }}
        gridColumns={[{ field: 'coreMeasurementID', headerName: 'Measurement ID' }]}
        gridType="measurements"
        errorControls={{ show: true, toggle: toggleErrors, count: 3 }}
        validControls={{ show: true, toggle: vi.fn(), count: 4 }}
        pendingControls={{ show: true, toggle: vi.fn(), count: 2 }}
        otControls={{ show: true, toggle: vi.fn(), count: 1 }}
        msControls={{ show: true, toggle: vi.fn(), count: 1 }}
        nrControls={{ show: true, toggle: vi.fn(), count: 1 }}
        dynamicButtons={[]}
      />
    );

    await user.click(screen.getByTestId('filter-errors'));

    expect(toggleErrors).toHaveBeenCalledWith(false);
    expect(screen.getByTestId('filter-errors')).toHaveAttribute('aria-label', 'Hide invalid measurements (3)');
  });

  it('uses the pending button as a pending-row filter toggle', async () => {
    const user = userEvent.setup();
    const togglePending = vi.fn();

    render(
      <EditToolbar
        handleAddNewRow={handleAddNewRow}
        handleRefresh={handleRefresh}
        handleQuickFilterChange={handleQuickFilterChange}
        filterModel={{
          items: [],
          quickFilterValues: [],
          visible: ['errors', 'valid', 'pending'],
          tss: ['old tree', 'multi stem', 'new recruit']
        }}
        gridColumns={[{ field: 'coreMeasurementID', headerName: 'Measurement ID' }]}
        gridType="measurements"
        errorControls={{ show: true, toggle: vi.fn(), count: 3 }}
        validControls={{ show: true, toggle: vi.fn(), count: 4 }}
        pendingControls={{ show: true, toggle: togglePending, count: 2 }}
        otControls={{ show: true, toggle: vi.fn(), count: 1 }}
        msControls={{ show: true, toggle: vi.fn(), count: 1 }}
        nrControls={{ show: true, toggle: vi.fn(), count: 1 }}
        dynamicButtons={[]}
      />
    );

    await user.click(screen.getByTestId('filter-pending'));

    expect(togglePending).toHaveBeenCalledWith(false);
    expect(screen.getByTestId('filter-pending')).toHaveAttribute('aria-label', 'Hide pending measurements (2)');
    expect(screen.getByTestId('filter-pending')).toHaveAttribute('aria-pressed', 'true');
  });

  it('can hide the action buttons section for read-only pages', () => {
    render(
      <EditToolbar
        handleAddNewRow={handleAddNewRow}
        handleRefresh={handleRefresh}
        handleQuickFilterChange={handleQuickFilterChange}
        filterModel={{
          items: [],
          quickFilterValues: [],
          visible: ['errors'],
          tss: ['old tree', 'multi stem', 'new recruit']
        }}
        gridColumns={[{ field: 'coreMeasurementID', headerName: 'Measurement ID' }]}
        gridType="measurements"
        showToolbarActions={false}
        dynamicButtons={[
          {
            label: 'Upload',
            tooltip: 'Submit data by uploading a CSV file',
            onClick: vi.fn()
          }
        ]}
      />
    );

    expect(screen.queryByRole('button', { name: 'Upload' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export as CSV' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'More actions' })).not.toBeInTheDocument();
  });
});
