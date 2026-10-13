import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import type { GridColDef, GridRenderCellParams, GridSingleSelectColDef } from '@mui/x-data-grid';

// platform-mocks.ts stubs this module with only AttributeStatusOptions; these tests need the real exports.
vi.mock('@/lib/db/definitions/core', async importOriginal => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return actual;
});

import { AttributeGridColumns, MeasurementsSummaryViewGridColumns, ViewFullTableGridColumns, VIEW_FULL_TABLE_COLUMN_WIDTHS } from './datagridcolumns';
import { AttributesFormGridColumns } from './formcolumns';
import { ATTRIBUTE_STATUS_UNSPECIFIED_LABEL, ATTRIBUTE_STATUS_UNSPECIFIED_HINT, AttributeStatusOptions } from '@/lib/db/definitions/core';

// GridCellParams is generic over the grid's row/value types, but every field is still required at
// the type level (GridRenderCellParams in @mui/x-data-grid/models/params/gridCellParams.d.ts);
// buildBlankStatusCellParams below supplies only the fields renderAttributeStatusCell /
// renderAttributeStatusFormCell actually read (value, tabIndex), casting the rest of the required-
// but-unused fields away explicitly rather than reaching for `any`.
function buildBlankStatusCellParams(tabIndex: 0 | -1): GridRenderCellParams {
  return {
    id: 1,
    field: 'status',
    value: null,
    row: { id: 1, status: null },
    rowNode: {} as GridRenderCellParams['rowNode'],
    colDef: {} as GridRenderCellParams['colDef'],
    cellMode: 'view',
    hasFocus: tabIndex === 0,
    tabIndex,
    api: {} as GridRenderCellParams['api']
  };
}

// The archive "All Historical Data" grid formerly gave every one of its columns a
// uniform `flex: 0.3` with no minWidth, which starved headers down to one or two visible
// characters (M…, Pl…). These tests lock in that every column now carries a per-type width
// preset with a legibility floor (minWidth). 56 = the prior 54 (53 + plotGlobalCoordinatesEPSG,
// added 2026-08-04) + stemPlotX/stemPlotY (site-supplied plot coordinates, 2026-08-27).
const FORMER_UNIFORM_FLEX = 0.3;
const EXPECTED_COLUMN_COUNT = 56;
const SMALLEST_PRESET_MIN_WIDTH = VIEW_FULL_TABLE_COLUMN_WIDTHS.code.minWidth;

const presetList = Object.values(VIEW_FULL_TABLE_COLUMN_WIDTHS);

function matchesAPreset(column: { minWidth?: number; flex?: number }): boolean {
  return presetList.some(preset => preset.minWidth === column.minWidth && preset.flex === column.flex);
}

describe('ViewFullTableGridColumns width presets', () => {
  it('still defines the full archive column set', () => {
    expect(ViewFullTableGridColumns).toHaveLength(EXPECTED_COLUMN_COUNT);
  });

  it('no column retains the former uniform starvation flex without a minWidth', () => {
    for (const column of ViewFullTableGridColumns) {
      const starved = column.flex === FORMER_UNIFORM_FLEX && (column.minWidth === undefined || column.minWidth === null);
      expect(starved, `column "${column.field}" is still starved (flex ${FORMER_UNIFORM_FLEX}, no minWidth)`).toBe(false);
    }
  });

  it('gives every column a legible minWidth floor', () => {
    for (const column of ViewFullTableGridColumns) {
      expect(typeof column.minWidth, `column "${column.field}" is missing a numeric minWidth`).toBe('number');
      expect(column.minWidth, `column "${column.field}" minWidth is below the smallest preset floor`).toBeGreaterThanOrEqual(SMALLEST_PRESET_MIN_WIDTH);
    }
  });

  it('assigns every column exactly one of the named width presets', () => {
    for (const column of ViewFullTableGridColumns) {
      expect(matchesAPreset(column), `column "${column.field}" (minWidth ${column.minWidth}, flex ${column.flex}) matches no named preset`).toBe(true);
    }
  });

  it('classifies representative columns into the expected buckets', () => {
    const byField = new Map(ViewFullTableGridColumns.map(column => [column.field, column]));

    // description bucket: free-text notes need the widest floor.
    expect(byField.get('description')).toMatchObject(VIEW_FULL_TABLE_COLUMN_WIDTHS.description);
    expect(byField.get('plotDescription')).toMatchObject(VIEW_FULL_TABLE_COLUMN_WIDTHS.description);
    // tag bucket.
    expect(byField.get('treeTag')).toMatchObject(VIEW_FULL_TABLE_COLUMN_WIDTHS.tag);
    expect(byField.get('stemTag')).toMatchObject(VIEW_FULL_TABLE_COLUMN_WIDTHS.tag);
    // measurement bucket.
    expect(byField.get('measuredDBH')).toMatchObject(VIEW_FULL_TABLE_COLUMN_WIDTHS.measurement);
    expect(byField.get('stemLocalX')).toMatchObject(VIEW_FULL_TABLE_COLUMN_WIDTHS.measurement);
    // date bucket.
    expect(byField.get('censusStartDate')).toMatchObject(VIEW_FULL_TABLE_COLUMN_WIDTHS.date);
    expect(byField.get('censusEndDate')).toMatchObject(VIEW_FULL_TABLE_COLUMN_WIDTHS.date);
    // name bucket.
    expect(byField.get('plotName')).toMatchObject(VIEW_FULL_TABLE_COLUMN_WIDTHS.name);
    expect(byField.get('speciesName')).toMatchObject(VIEW_FULL_TABLE_COLUMN_WIDTHS.name);
    // code bucket (includes the hidden-by-default ID columns).
    expect(byField.get('speciesCode')).toMatchObject(VIEW_FULL_TABLE_COLUMN_WIDTHS.code);
    expect(byField.get('coreMeasurementID')).toMatchObject(VIEW_FULL_TABLE_COLUMN_WIDTHS.code);
  });
});

describe('MeasurementsSummaryViewGridColumns plot coordinates', () => {
  it.each(['stemPlotX', 'stemPlotY'])('renders missing %s as blank while preserving a real zero', field => {
    const column = MeasurementsSummaryViewGridColumns.find(candidate => candidate.field === field);
    expect(column?.valueFormatter).toBeTypeOf('function');
    const format = column!.valueFormatter as (value: number | null | undefined) => string;

    expect(format(null)).toBe('');
    expect(format(undefined)).toBe('');
    expect(format(0)).toBe('0.00');
    expect(format(12.345)).toBe('12.35');
  });
});

describe('AttributeGridColumns status column (#425 null-status editing)', () => {
  // GridColDef is a union (GridBaseColDef | GridActionsColDef | GridSingleSelectColDef); the base
  // member's `type` is widened to GridColType, so `=== 'singleSelect'` alone does not let TypeScript
  // narrow the return type. Assert the runtime discriminant, then cast explicitly to the member that
  // actually carries `valueOptions` -- this is what TS2339 on the old `.valueOptions` access meant.
  function statusColumn(): GridSingleSelectColDef {
    const column = AttributeGridColumns.find(candidate => candidate.field === 'status');
    if (!column) throw new Error('AttributeGridColumns has no "status" column');
    if (column.type !== 'singleSelect') throw new Error('AttributeGridColumns "status" column is not a singleSelect column');
    return column as GridSingleSelectColDef;
  }

  it('offers exactly one blank option, with a real null value (not the string "null")', () => {
    const options = statusColumn().valueOptions as { value: string | null; label: string }[];
    const blankOptions = options.filter(option => option.value === null);

    expect(blankOptions).toHaveLength(1);
    expect(blankOptions[0].label).toBe(ATTRIBUTE_STATUS_UNSPECIFIED_LABEL);
    expect(blankOptions[0].value).toBeNull();
  });

  it('exposes every canonical status as its own value/label pair, inventing none', () => {
    const options = statusColumn().valueOptions as { value: string | null; label: string }[];
    const nonBlankOptions = options.filter(option => option.value !== null);

    expect(nonBlankOptions.map(option => option.value).sort()).toEqual([...AttributeStatusOptions].sort());
    for (const option of nonBlankOptions) {
      expect(option.label).toBe(option.value);
    }
  });

  it("renders the blank-status hint as the single reachable tab stop only when it is the grid's current cell", () => {
    const renderCell = statusColumn().renderCell as (params: GridRenderCellParams) => ReactElement;

    const { unmount: unmountFocused } = render(renderCell(buildBlankStatusCellParams(0)));
    expect(screen.getByLabelText(ATTRIBUTE_STATUS_UNSPECIFIED_HINT)).toHaveAttribute('tabindex', '0');
    unmountFocused();

    render(renderCell(buildBlankStatusCellParams(-1)));
    expect(screen.getByLabelText(ATTRIBUTE_STATUS_UNSPECIFIED_HINT)).toHaveAttribute('tabindex', '-1');
  });

  it('formats the raw/export value as blank for null, never the "Unspecified (blank)" label', () => {
    const format = statusColumn().valueFormatter as (value: string | null) => string;

    expect(format(null)).toBe('');
    expect(format('alive')).toBe('alive');
  });
});

describe('AttributesFormGridColumns status column (#425 null-status editing)', () => {
  function formStatusColumn(): GridColDef {
    const column = AttributesFormGridColumns.find(candidate => candidate.field === 'status');
    if (!column) throw new Error('AttributesFormGridColumns has no "status" column');
    return column;
  }

  it('renders the same single-tab-stop blank-status hint as the grid column (keyboard access to the explanation)', () => {
    const renderCell = formStatusColumn().renderCell as (params: GridRenderCellParams) => ReactElement;

    const { unmount: unmountFocused } = render(renderCell(buildBlankStatusCellParams(0)));
    expect(screen.getByLabelText(ATTRIBUTE_STATUS_UNSPECIFIED_HINT)).toHaveAttribute('tabindex', '0');
    unmountFocused();

    render(renderCell(buildBlankStatusCellParams(-1)));
    expect(screen.getByLabelText(ATTRIBUTE_STATUS_UNSPECIFIED_HINT)).toHaveAttribute('tabindex', '-1');
  });
});
