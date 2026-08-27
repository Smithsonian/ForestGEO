import { describe, expect, it } from 'vitest';
import { ViewFullTableGridColumns, VIEW_FULL_TABLE_COLUMN_WIDTHS } from './datagridcolumns';

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
