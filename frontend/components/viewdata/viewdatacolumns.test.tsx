import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { GridColDef, GridRenderCellParams } from '@mui/x-data-grid';
import { buildViewDataColumns, hideEmptyViewDataColumns } from './viewdatacolumns';
import {
  VIEW_DATA_COLUMN_ORDER,
  VIEW_DATA_COLUMN_WIDTHS,
  VIEW_DATA_FILTER_OPERATOR_VALUES,
  VIEW_DATA_SORTABLE_FIELDS,
  VIEW_DATA_TEXT
} from '@/config/viewdata';
import { DETAILS_SHEET_TEXT, ERROR_TYPE_DISPLAY_LABELS, MARKED_INVALID_NO_ERROR_LOGGED_LABEL } from '@/config/errorsexplorer';
import { UNRESOLVED_ERROR_MESSAGES_SEPARATOR } from '@/config/measurementstatefilters';

vi.mock('@/lib/db/definitions/core', async importOriginal => importOriginal());
vi.mock('@/lib/db/definitions/views', async importOriginal => importOriginal());

const { MeasurementsSummaryViewGridColumns } = await import('@/components/client/datagridcolumns');

const ACTIONS_COLUMN: GridColDef = { field: 'actions', type: 'actions', headerName: VIEW_DATA_TEXT.actionsHeader, width: 92, getActions: () => [] };
const NO_FAULTS = () => new Map<string, string | null>();
const FAULT_FONT_WEIGHT = 600;

function build(overrides: Partial<Parameters<typeof buildViewDataColumns>[0]> = {}) {
  return buildViewDataColumns({
    dataColumns: MeasurementsSummaryViewGridColumns,
    actionsColumn: ACTIONS_COLUMN,
    canEditRows: true,
    canEditSpeciesCode: true,
    faultsForRow: NO_FAULTS,
    attributeTooltips: new Map(),
    ...overrides
  });
}

function renderCell(column: GridColDef, row: Record<string, unknown>, value: unknown = row[column.field]) {
  const params = { row, value, field: column.field, formattedValue: value, id: 1 } as unknown as GridRenderCellParams;
  const { container } = render(<div>{column.renderCell?.(params)}</div>);
  return container;
}

describe('buildViewDataColumns', () => {
  it('orders, sizes and labels the columns as the spec table, with the hidden ID columns after Description', () => {
    const columns = build();
    const fields = columns.map(column => column.field);
    console.log('[columns] fields', JSON.stringify(fields));
    expect(fields.slice(0, VIEW_DATA_COLUMN_ORDER.length)).toEqual([...VIEW_DATA_COLUMN_ORDER]);
    expect(fields.slice(VIEW_DATA_COLUMN_ORDER.length)).toEqual(expect.arrayContaining(['coreMeasurementID', 'stemGUID', 'treeID']));
    for (const column of columns.filter(c => VIEW_DATA_COLUMN_WIDTHS[c.field] !== undefined)) {
      expect({ field: column.field, width: column.width, flex: column.flex, renderHeader: column.renderHeader }).toEqual({
        field: column.field,
        width: VIEW_DATA_COLUMN_WIDTHS[column.field],
        flex: undefined,
        renderHeader: undefined
      });
    }
    expect(columns.find(c => c.field === 'measurementStatus')?.headerName).toBe('Validation');
    expect(columns.find(c => c.field === 'attributes')?.headerName).toBe('Codes');
  });

  it('marks exactly the whitelisted fields sortable and gives the two state columns only the "is" operator', () => {
    const columns = build();
    const sortable = columns.filter(column => column.sortable).map(column => column.field);
    console.log('[columns] sortable', JSON.stringify(sortable));
    expect(new Set(sortable)).toEqual(new Set(VIEW_DATA_SORTABLE_FIELDS));
    expect(columns.find(c => c.field === 'measurementStatus')?.filterable).toBe(false);
    for (const field of ['stemState', 'stemStatus']) {
      const column = columns.find(c => c.field === field);
      expect(column?.type).toBe('singleSelect');
      expect(column?.filterOperators?.map(operator => operator.value)).toEqual(['is']);
    }
  });

  it('offers only server-supported filter operators on every filterable column', () => {
    const columns = build();
    const offered = Object.fromEntries(
      columns
        .filter(column => column.filterable !== false && column.field !== 'actions')
        .map(column => [column.field, (column.filterOperators ?? []).map(operator => operator.value)])
    );
    console.log('[columns] filter operators', JSON.stringify(offered));
    for (const [field, operators] of Object.entries(offered)) {
      expect({ field, unsupported: operators.filter(operator => !VIEW_DATA_FILTER_OPERATOR_VALUES.has(operator)) }).toEqual({ field, unsupported: [] });
      expect({ field, count: operators.length > 0 }).toEqual({ field, count: true });
    }
    expect(offered.measurementDate).toEqual(['is', 'isEmpty', 'isNotEmpty']);
    expect(columns.find(column => column.field === 'coreMeasurementID')?.filterable).toBe(false);
  });

  it('makes cells editable only for editors, and Species only for species editors', () => {
    const editable = (columns: GridColDef[]) => columns.filter(column => column.editable).map(column => column.field);
    const fieldCrew = editable(build({ canEditSpeciesCode: false }));
    const pending = editable(build({ canEditRows: false, canEditSpeciesCode: false }));
    console.log('[columns] editable', JSON.stringify({ fieldCrew, pending }));
    expect(fieldCrew).toEqual([
      'treeTag',
      'stemTag',
      'quadratName',
      'stemLocalX',
      'stemLocalY',
      'stemPlotX',
      'stemPlotY',
      'measuredDBH',
      'measuredHOM',
      'measurementDate',
      'attributes',
      'description'
    ]);
    expect(editable(build())).toContain('speciesCode');
    expect(pending).toEqual([]);
  });
});

describe('Validation cell', () => {
  const validation = () => build().find(column => column.field === 'measurementStatus') as GridColDef;

  it('shows the source chip, the display label, +n with the other errors, and the contradiction icon', async () => {
    const user = userEvent.setup();
    renderCell(validation(), {
      measurementStatus: 'unresolvedErrors',
      unresolvedErrorCount: 2,
      primaryErrorMessage: 'Flagged;Different species',
      primaryErrorSource: 'validation',
      unresolvedErrorMessages: ['Flagged;Different species', 'Invalid attribute code'].join(UNRESOLVED_ERROR_MESSAGES_SEPARATOR),
      hasContradiction: true
    });
    const cell = screen.getByTestId('validation-cell');
    console.log('[validation cell]', cell.textContent);
    const speciesLabel = ERROR_TYPE_DISPLAY_LABELS.get('Flagged;Different species') as string;
    expect(within(cell).getByTestId('error-source-chip-validation')).toHaveTextContent(DETAILS_SHEET_TEXT.validationChip);
    expect(within(cell).getByText(speciesLabel)).toHaveAttribute('title', speciesLabel);
    expect(within(cell).getByLabelText(VIEW_DATA_TEXT.contradictionIcon)).toBeInTheDocument();
    await user.hover(within(cell).getByText('+1'));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Invalid attribute code');
  });

  it.each([
    [{ measurementStatus: 'invalidNoLog' }, MARKED_INVALID_NO_ERROR_LOGGED_LABEL],
    [{ measurementStatus: 'pending' }, VIEW_DATA_TEXT.validationPending],
    [{ measurementStatus: 'passed' }, VIEW_DATA_TEXT.validationPassed]
  ])('renders %j as "%s" with no source chip', (row, text) => {
    renderCell(validation(), row);
    expect(screen.getByTestId('validation-cell')).toHaveTextContent(text);
    expect(screen.queryByTestId(/error-source-chip-/)).not.toBeInTheDocument();
  });

  it('renders an ingestion failure with the Ingestion chip', () => {
    renderCell(validation(), {
      measurementStatus: 'ingestionFailed',
      unresolvedErrorCount: 1,
      primaryErrorMessage: 'Invalid species reference',
      primaryErrorSource: 'ingestion'
    });
    expect(screen.getByTestId('error-source-chip-ingestion')).toBeInTheDocument();
    expect(screen.getByTestId('validation-cell')).toHaveTextContent('Invalid species reference');
  });
});

describe('Stem state, Stem status and faulted cells', () => {
  it('shows stem state labels or a dash, and joined stem statuses or a dash', () => {
    const columns = build();
    const stemState = columns.find(c => c.field === 'stemState') as GridColDef;
    const stemStatus = columns.find(c => c.field === 'stemStatus') as GridColDef;
    const observed = {
      oldTree: renderCell(stemState, { userDefinedFields: 'old tree' }, 'old tree').textContent,
      failed: renderCell(stemState, {}, undefined).textContent,
      statuses: renderCell(stemStatus, { stemStatuses: 'alive,dead' }, ['alive', 'dead']).textContent,
      none: renderCell(stemStatus, {}, []).textContent
    };
    console.log('[state cells]', JSON.stringify(observed));
    expect(observed).toEqual({ oldTree: 'Old tree', failed: '—', statuses: 'Alive · Dead', none: '—' });
  });

  it('renders a faulted value in the warning style with a tooltip and never adds text under the cell', async () => {
    const user = userEvent.setup();
    const columns = build({ faultsForRow: () => new Map([['measuredDBH', 'DBH growth exceeds the maximum']]) });
    const dbh = columns.find(c => c.field === 'measuredDBH') as GridColDef;
    const container = renderCell(dbh, { measuredDBH: 12.5 }, 12.5);
    const value = within(container).getByText('12.50');
    console.log('[faulted cell]', container.innerHTML);
    expect(value).toHaveAttribute('data-faulted', 'true');
    expect(value).toHaveStyle({ fontWeight: String(FAULT_FONT_WEIGHT) });
    expect(container.querySelectorAll('p, span.MuiTypography-root').length).toBe(1);
    await user.hover(value);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('DBH growth exceeds the maximum');
  });

  it('gives every chip of a faulted Codes cell weight 600 for an attribute validation error, and none to an unfaulted one (P2-7)', () => {
    const faulted = build({ faultsForRow: () => new Map([['attributes', 'Invalid attribute code']]) }).find(c => c.field === 'attributes') as GridColDef;
    const faultedCell = renderCell(faulted, { attributes: 'A;XX' }, 'A;XX');
    const faultedChips = Array.from(faultedCell.querySelectorAll('.MuiChip-root')) as HTMLElement[];
    console.log('[faulted codes]', JSON.stringify(faultedChips.map(chip => ({ text: chip.textContent, weight: getComputedStyle(chip).fontWeight }))));
    expect(faultedChips).toHaveLength(2);
    for (const chip of faultedChips) expect(chip).toHaveStyle({ fontWeight: String(FAULT_FONT_WEIGHT) });

    const plain = build().find(c => c.field === 'attributes') as GridColDef;
    const plainChip = renderCell(plain, { attributes: 'A' }, 'A').querySelector('.MuiChip-root') as HTMLElement;
    expect(plainChip).not.toHaveStyle({ fontWeight: String(FAULT_FONT_WEIGHT) });
  });

  it('renders a blank numeric value as a dash, not "null"', () => {
    const columns = build();
    const x = columns.find(c => c.field === 'stemLocalX') as GridColDef;
    expect(renderCell(x, { stemLocalX: null }, null).textContent).toBe('—');
  });
});

describe('hideEmptyViewDataColumns', () => {
  it('judges stem state and stem status by their row keys and always keeps Actions and Validation', () => {
    const columns = build();
    const rows = [{ id: 1, measurementStatus: 'ingestionFailed', treeTag: 'T1' }];
    const kept = hideEmptyViewDataColumns(rows, columns).map(column => column.field);
    console.log('[hide empty]', JSON.stringify(kept));
    expect(kept).toEqual(expect.arrayContaining(['actions', 'measurementStatus', 'treeTag']));
    expect(kept).not.toContain('stemState');
    expect(kept).not.toContain('stemStatus');
    const withStates = hideEmptyViewDataColumns([{ id: 1, userDefinedFields: 'old tree', stemStatuses: 'alive' }], columns).map(column => column.field);
    expect(withStates).toEqual(expect.arrayContaining(['stemState', 'stemStatus']));
  });

  it('returns the columns unchanged for an empty page, so MUI keeps the filter items of every column', () => {
    const columns = build();
    const kept = hideEmptyViewDataColumns([], columns, ['speciesCode']);
    console.log('[hide empty, empty page]', JSON.stringify({ built: columns.map(column => column.field), kept: kept.map(column => column.field) }));
    expect(kept.map(column => column.field)).toEqual(columns.map(column => column.field));
  });

  it('keeps a blank column that has an active filter item, and still hides the other blank columns', () => {
    const columns = build();
    const rows = [{ id: 1, measurementStatus: 'passed', treeTag: 'T1', speciesCode: null }];
    const withoutFilter = hideEmptyViewDataColumns(rows, columns).map(column => column.field);
    const withFilter = hideEmptyViewDataColumns(rows, columns, ['speciesCode', 'stemState']).map(column => column.field);
    console.log('[hide empty, filtered column]', JSON.stringify({ withoutFilter, withFilter }));
    expect(withoutFilter).not.toContain('speciesCode');
    expect(withFilter).toEqual(expect.arrayContaining(['speciesCode', 'stemState']));
    expect(withFilter).not.toContain('stemStatus');
    expect(withFilter).not.toContain('measuredDBH');
  });
});
