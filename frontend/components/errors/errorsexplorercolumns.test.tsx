import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { getGridNumericOperators, getGridStringOperators, GridRowModes, type GridColDef } from '@mui/x-data-grid';
import {
  EDIT_LOCK_TOOLTIPS,
  ERROR_EXPLORER_COLUMN_FIELDS,
  ERROR_EXPLORER_NUMBER_OPERATORS,
  ERROR_EXPLORER_TEXT_OPERATORS,
  isErrorExplorerNumberField,
  type ErrorExplorerRow
} from '@/config/errorsexplorer';
import type { OrgCensus } from '@/lib/db/definitions/timekeeping';
import { buildErrorsExplorerColumns, buildGroupColumnVisibility, resolvePriorDbhHeader, type ErrorsExplorerColumnOptions } from './errorsexplorercolumns';

// GridActionsCellItem reads the grid's root props, which exist only inside a DataGrid. This stand-in renders
// exactly the props the builder sets (label, onClick, aria-disabled, title); the real grid is covered by Task 24.
vi.mock('@mui/x-data-grid', async importOriginal => {
  const actual = await importOriginal<typeof import('@mui/x-data-grid')>();
  return {
    ...actual,
    GridActionsCellItem: ({
      label,
      onClick,
      title,
      'aria-disabled': ariaDisabled
    }: {
      label: string;
      onClick?: () => void;
      title?: string;
      'aria-disabled'?: boolean;
    }) => (
      <button type="button" role="menuitem" aria-label={label} aria-disabled={ariaDisabled} title={title} onClick={onClick}>
        {label}
      </button>
    )
  };
});

const ROW = {
  id: 101,
  coreMeasurementID: 101,
  errorMessages: ['Attribute code does not exist in attributes table'],
  totalErrorCount: 3,
  contradictionTypes: ['duplicate_tag_stem'],
  contradictionType: 'duplicate_tag_stem',
  errorFields: ['attributes']
} as unknown as ErrorExplorerRow;

function options(overrides: Partial<ErrorsExplorerColumnOptions> = {}): ErrorsExplorerColumnOptions {
  return {
    canEditRows: true,
    canEditSpeciesCode: false,
    codeOptions: [],
    rowModesModel: {},
    lockedHeaderDescription: null,
    faultedFieldsFor: () => new Set(['attributes']),
    errorLabelFor: () => 'Attribute code does not exist in attributes table',
    priorDbhHeader: 'Prior DBH',
    actions: {
      onOpenDetails: vi.fn(),
      onStartEdit: vi.fn(),
      onSave: vi.fn(),
      onCancel: vi.fn(),
      editDisabledReason: () => null,
      detailsDisabledReason: () => null
    },
    ...overrides
  };
}

function column(columns: GridColDef[], field: string): GridColDef {
  const found = columns.find(candidate => candidate.field === field);
  if (!found) throw new Error(`No column ${field}; have ${columns.map(candidate => candidate.field).join(', ')}`);
  return found;
}

function renderActions(columns: GridColDef[], row = ROW) {
  const actions = column(columns, 'actions') as GridColDef & { getActions: (params: { id: number; row: ErrorExplorerRow }) => React.ReactElement[] };
  return render(
    <div>
      {actions.getActions({ id: row.id, row }).map((action, index) => (
        <React.Fragment key={index}>{action}</React.Fragment>
      ))}
    </div>
  );
}

describe('buildErrorsExplorerColumns — editability (P1-2)', () => {
  it('makes nothing editable for a read-only user and offers only Details', () => {
    const columns = buildErrorsExplorerColumns(options({ canEditRows: false }));
    const editable = columns.filter(candidate => candidate.editable).map(candidate => candidate.field);
    console.log('[view-errors columns read-only]', JSON.stringify({ editable, actionsHeader: column(columns, 'actions').headerName }));
    expect(editable).toEqual([]);
    expect(column(columns, 'actions').headerName).toBe('Details');
    renderActions(columns);
    expect(screen.getByRole('menuitem', { name: 'Details' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Edit' })).toBeNull();
  });

  it('keeps Species editable only with the species role', () => {
    expect(column(buildErrorsExplorerColumns(options()), 'speciesCode').editable).toBe(false);
    expect(column(buildErrorsExplorerColumns(options({ canEditSpeciesCode: true })), 'speciesCode').editable).toBe(true);
    expect(column(buildErrorsExplorerColumns(options()), 'treeTag').editable).toBe(true);
    for (const field of ['errors', 'stemPlotX', 'stemPlotY', 'priorDBH', 'dbhChangePercent', 'priorHOM', 'homChanged']) {
      expect(column(buildErrorsExplorerColumns(options()), field).editable, field).toBeFalsy();
    }
  });

  it('shows Details then Edit for an editor, and Details, Save, Cancel while the row is open', () => {
    const columns = buildErrorsExplorerColumns(options());
    const { unmount } = renderActions(columns);
    expect(screen.getAllByRole('menuitem').map(item => item.getAttribute('aria-label'))).toEqual(['Details', 'Edit']);
    unmount();
    renderActions(buildErrorsExplorerColumns(options({ rowModesModel: { 101: { mode: GridRowModes.Edit } } })));
    expect(screen.getAllByRole('menuitem').map(item => item.getAttribute('aria-label'))).toEqual(['Details', 'Save', 'Cancel']);
  });

  it('marks a locked Edit aria-disabled with the tooltip and ignores its click', async () => {
    const onStartEdit = vi.fn();
    const columns = buildErrorsExplorerColumns(
      options({ actions: { ...options().actions, onStartEdit, editDisabledReason: () => EDIT_LOCK_TOOLTIPS.editing } })
    );
    renderActions(columns);
    const edit = screen.getByRole('menuitem', { name: 'Edit' });
    expect(edit).toHaveAttribute('aria-disabled', 'true');
    expect(edit).toHaveAttribute('title', EDIT_LOCK_TOOLTIPS.editing);
    await userEvent.click(edit);
    expect(onStartEdit).not.toHaveBeenCalled();
  });
});

describe('buildErrorsExplorerColumns — menus, sort and filter (D-a, D-b, P2-11, P2-15)', () => {
  it('enables the Actions column menu but keeps it unsortable, unfilterable and unhideable', () => {
    const actions = column(buildErrorsExplorerColumns(options()), 'actions');
    expect({ disableColumnMenu: actions.disableColumnMenu, hideable: actions.hideable, sortable: actions.sortable, filterable: actions.filterable }).toEqual({
      disableColumnMenu: false,
      hideable: false,
      sortable: false,
      filterable: false
    });
  });

  it('sorts and filters exactly the allow-list, with MUI operators narrowed to it', () => {
    const columns = buildErrorsExplorerColumns(options());
    for (const field of ERROR_EXPLORER_COLUMN_FIELDS) {
      const definition = column(columns, field);
      const allowed: readonly string[] = isErrorExplorerNumberField(field) ? ERROR_EXPLORER_NUMBER_OPERATORS : ERROR_EXPLORER_TEXT_OPERATORS;
      const muiValues = (isErrorExplorerNumberField(field) ? getGridNumericOperators() : getGridStringOperators())
        .map(operator => operator.value)
        .filter(value => allowed.includes(value));
      expect(definition.sortable, field).toBe(true);
      expect(definition.filterable, field).toBe(true);
      expect(
        definition.filterOperators?.map(operator => operator.value),
        field
      ).toEqual(muiValues);
    }
    for (const field of ['errors', 'attributes', 'priorHOM', 'homChanged']) {
      expect(column(columns, field).sortable, field).toBe(false);
      expect(column(columns, field).filterable, field).toBe(false);
    }
  });

  it('puts the lock tooltip on sortable headers of a locked grid only', () => {
    const columns = buildErrorsExplorerColumns(options({ lockedHeaderDescription: EDIT_LOCK_TOOLTIPS.editing }));
    expect(column(columns, 'treeTag').description).toBe(EDIT_LOCK_TOOLTIPS.editing);
    expect(column(columns, 'errors').description).toBeUndefined();
  });
});

describe('Errors and Change cells', () => {
  it('shows the label, "+n more" and the contradiction chip', () => {
    const errors = column(buildErrorsExplorerColumns(options()), 'errors');
    render(<>{errors.renderCell?.({ row: ROW } as never)}</>);
    expect(screen.getByText('Attribute code does not exist in attributes table')).toBeInTheDocument();
    expect(screen.getByText('+2 more')).toBeInTheDocument();
    expect(screen.getByText('Duplicate tag/stem')).toBeInTheDocument();
  });

  it('formats Change as a signed percent and a blank as empty', () => {
    const change = column(buildErrorsExplorerColumns(options()), 'dbhChangePercent');
    const format = change.valueFormatter as unknown as (value: number | null) => string;
    expect([format(23.4), format(-4), format(null)]).toEqual(['+23.4%', '−4.0%', '']);
  });
});

describe('buildGroupColumnVisibility', () => {
  it('adds the group fields and Codes for an attribute-code group', () => {
    const model = buildGroupColumnVisibility({ source: 'validation', code: '14', fields: ['attributes'] });
    console.log('[view-errors group visibility]', JSON.stringify(model));
    expect(model.attributes).toBe(true);
    expect(model.priorDBH).toBe(false);
    expect(model.stemLocalX).toBe(false);
  });

  it('adds Prior DBH, DBH and Change for validations 1 and 2', () => {
    for (const code of ['1', '2']) {
      const model = buildGroupColumnVisibility({ source: 'validation', code, fields: ['measuredDBH'] });
      expect([model.priorDBH, model.measuredDBH, model.dbhChangePercent], code).toEqual([true, true, true]);
    }
  });

  it('ignores criteria fields that are not grid columns', () => {
    const model = buildGroupColumnVisibility({ source: 'validation', code: '8', fields: ['stemLocalX', 'quadratStartX', 'plotGlobalX'] });
    expect(model.stemLocalX).toBe(true);
    expect(Object.keys(model)).not.toContain('quadratStartX');
  });
});

describe('resolvePriorDbhHeader', () => {
  const censusList: OrgCensus[] = [undefined, { plotID: 1, plotCensusNumber: 2, censusIDs: [4, 5], dateRanges: [], description: '', isActive: true }];

  it('names the plot census when every prior census maps to one', () => {
    expect(resolvePriorDbhHeader([{ priorCensusID: 4 }, { priorCensusID: 5 }, { priorCensusID: null }], censusList)).toBe('DBH in Census 2');
  });

  it.each([
    ['different prior censuses', [{ priorCensusID: 4 }, { priorCensusID: 9 }]],
    ['no mapping', [{ priorCensusID: 9 }]],
    ['no prior census', [{ priorCensusID: null }]]
  ])('falls back to Prior DBH for %s', (_label, rows) => {
    expect(resolvePriorDbhHeader(rows, censusList)).toBe('Prior DBH');
  });

  it('falls back when the census list is missing', () => {
    expect(resolvePriorDbhHeader([{ priorCensusID: 4 }], undefined)).toBe('Prior DBH');
  });
});
