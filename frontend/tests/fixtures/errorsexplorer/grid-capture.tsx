import React from 'react';
import { act } from '@testing-library/react';
import type { GridRowModel, GridRowModesModel } from '@mui/x-data-grid';

export interface CapturedGridProps {
  'aria-label': string;
  rows: Array<Record<string, unknown>>;
  columns: Array<Record<string, unknown> & { field: string; getActions?: (params: { id: unknown; row: unknown }) => React.ReactElement[] }>;
  processRowUpdate?: (newRow: GridRowModel, oldRow: GridRowModel) => Promise<GridRowModel>;
  onRowModesModelChange?: (model: GridRowModesModel) => void;
  onSortModelChange?: (model: unknown) => void;
  onFilterModelChange?: (model: unknown) => void;
  onPaginationModelChange?: (model: unknown) => void;
  onColumnVisibilityModelChange?: (model: unknown) => void;
  columnVisibilityModel?: Record<string, boolean>;
  filterModel?: { items: Array<Record<string, unknown>> };
  paginationModel?: { page: number; pageSize: number };
  slots?: { pagination?: React.ComponentType<Record<string, never>> };
  slotProps?: { pagination?: { disabled?: boolean; disabledReason?: string } };
  disableColumnSorting?: boolean;
  disableColumnFilter?: boolean;
}

export const capturedGrids = new Map<string, CapturedGridProps>();

function StyledDataGridCapture(props: CapturedGridProps) {
  const label = props['aria-label'];
  React.useLayoutEffect(() => {
    capturedGrids.set(label, props);
    return () => {
      if (capturedGrids.get(label) === props) capturedGrids.delete(label);
    };
  });
  const actionColumn = props.columns.find(column => typeof column.getActions === 'function');
  const PaginationSlot = props.slots?.pagination;
  return (
    <div role="grid" aria-label={label} data-testid={`captured-grid-${label}`}>
      {props.rows.map(row => (
        <div key={String(row.id)} data-testid={`captured-row-${label}-${String(row.id)}`}>
          <span data-testid={`captured-row-json-${String(row.id)}`}>{JSON.stringify(row)}</span>
          {actionColumn?.getActions?.({ id: row.id, row }).map((action, index) => (
            <React.Fragment key={index}>{action}</React.Fragment>
          ))}
        </div>
      ))}
      {PaginationSlot ? <PaginationSlot /> : null}
    </div>
  );
}

/** Use as: vi.mock('@/config/styleddatagrid', async () => (await import('@/tests/fixtures/errorsexplorer/grid-capture')).styledDataGridCaptureModule()) */
export function styledDataGridCaptureModule() {
  return { StyledDataGrid: StyledDataGridCapture, ALWAYS_VISIBLE_COLUMN_MENU_SX: {} };
}

/** Renders exactly the props the column builder sets on an action, outside a DataGrid. */
export function GridActionsCellItemStub({
  label,
  onClick,
  title,
  'aria-disabled': ariaDisabled
}: {
  label: string;
  onClick?: () => void;
  title?: string;
  'aria-disabled'?: boolean;
}) {
  return (
    <button type="button" role="menuitem" aria-label={label} aria-disabled={ariaDisabled} title={title} onClick={onClick}>
      {label}
    </button>
  );
}

export function requireGrid(label: string): CapturedGridProps {
  const grid = capturedGrids.get(label);
  if (!grid) throw new Error(`No grid "${label}" is mounted. Mounted: ${JSON.stringify([...capturedGrids.keys()])}`);
  return grid;
}

export function requireRow(label: string, rowID: number): Record<string, unknown> {
  const row = requireGrid(label).rows.find(candidate => Number(candidate.id) === rowID);
  if (!row) throw new Error(`No row ${rowID} in "${label}". Rows: ${JSON.stringify(requireGrid(label).rows.map(candidate => candidate.id))}`);
  return row;
}

/** What MUI does around a row save: enter Edit, call processRowUpdate, and on success remove the row from the model. */
export async function saveRowThroughGrid(label: string, rowID: number, changes: Record<string, unknown>): Promise<unknown> {
  act(() => requireGrid(label).onRowModesModelChange?.({ [rowID]: { mode: 'edit' } } as GridRowModesModel));
  const oldRow = requireRow(label, rowID);
  const processRowUpdate = requireGrid(label).processRowUpdate;
  if (!processRowUpdate) throw new Error(`"${label}" has no processRowUpdate`);
  let outcome: unknown;
  await act(async () => {
    outcome = await processRowUpdate({ ...oldRow, ...changes }, oldRow).then(
      saved => {
        requireGrid(label).onRowModesModelChange?.({});
        return saved;
      },
      (error: unknown) => error
    );
  });
  return outcome;
}

export function enterEdit(label: string, rowID: number): void {
  act(() => requireGrid(label).onRowModesModelChange?.({ [rowID]: { mode: 'edit' } } as GridRowModesModel));
}

export function resetCapturedGrids(): void {
  capturedGrids.clear();
}
