import { describe, expect, it } from 'vitest';
import { buildErrorExportRows, groupErrorRowsForTest, toDisplayRowForTest, RawErrorOccurrenceRow } from './_shared';
import { ErrorExplorerFilters } from '@/config/errorsexplorer';

// DEFAULT_FILTERS mirrors the all-pass literal buildErrorExplorerDetails passes to
// toDisplayRow — no filter narrows the visible errors down.
const DEFAULT_FILTERS: ErrorExplorerFilters = {
  source: 'all',
  exactMessages: [],
  affectedFields: [],
  contradictionOnly: false,
  contradictionTypes: [],
  quickSearch: ''
};

function rawRow(overrides: Partial<RawErrorOccurrenceRow> = {}): RawErrorOccurrenceRow {
  return {
    CoreMeasurementID: 10,
    PlotID: 5,
    CensusID: 7,
    CoreStemGUID: 21,
    ErrorSource: 'validation',
    ErrorCode: '2',
    DisplayMessage: 'shrinkage',
    ValidationCriteria: 'measuredDBH',
    PriorCensusID: 1,
    PriorDBH: 50,
    PriorHOM: 1.3,
    MeasuredHOM: 2.6,
    MeasuredDBH: 40,
    ...overrides
  };
}

describe('DBH growth/shrinkage comparison context', () => {
  it('carries the prior-census snapshot on the occurrence when both HOM values are present and differ', () => {
    const grouped = groupErrorRowsForTest([rawRow()], new Map());
    const detail = grouped.get(10)!.allErrors[0];

    expect(detail.comparison).toEqual({
      priorCensusID: 1,
      priorDBH: 50,
      priorHOM: 1.3,
      homChanged: true
    });
  });

  it.each([
    ['prior HOM is null', { PriorHOM: null }, null],
    ['current HOM is null', { MeasuredHOM: null }, 1.3],
    ['both HOM values are null', { PriorHOM: null, MeasuredHOM: null }, null]
  ])('never claims a HOM change when %s', (_label, overrides, expectedPriorHOM) => {
    const grouped = groupErrorRowsForTest([rawRow(overrides as Partial<RawErrorOccurrenceRow>)], new Map());
    const comparison = grouped.get(10)!.allErrors[0].comparison;

    expect(comparison?.homChanged).toBe(false);
    expect(comparison?.priorHOM).toBe(expectedPriorHOM);
  });

  it('is not erased when an ingestion error is ordered before the validation occurrence in the raw rows', () => {
    const ingestionRow = rawRow({
      ErrorSource: 'ingestion',
      ErrorCode: 'INVALID_QUADRAT',
      DisplayMessage: 'bad quadrat',
      ValidationCriteria: null,
      PriorCensusID: null,
      PriorDBH: null,
      PriorHOM: null
    });
    const validationRow = rawRow();

    const grouped = groupErrorRowsForTest([ingestionRow, validationRow], new Map());
    const displayRow = toDisplayRowForTest(grouped.get(10)!, DEFAULT_FILTERS);

    expect(displayRow.priorDBH).toBe(50);
    expect(displayRow.homChanged).toBe(true);
  });

  it('resolves the grouped row context to the first visible ValidationID 1/2 occurrence in ascending code order, falling back when filtered out', () => {
    const growthRow = rawRow({ ErrorCode: '1', DisplayMessage: 'growth', PriorDBH: 30, PriorHOM: 1.3, MeasuredHOM: 1.5 });
    const shrinkageRow = rawRow({ ErrorCode: '2', DisplayMessage: 'shrinkage', PriorDBH: 50, PriorHOM: 1.3, MeasuredHOM: 2.6 });

    const grouped = groupErrorRowsForTest([growthRow, shrinkageRow], new Map());
    const groupedRow = grouped.get(10)!;

    const defaultDisplay = toDisplayRowForTest(groupedRow, DEFAULT_FILTERS);
    expect(defaultDisplay.priorDBH).toBe(30);

    const filteredToShrinkage = toDisplayRowForTest(groupedRow, { ...DEFAULT_FILTERS, exactMessages: ['shrinkage'] });
    expect(filteredToShrinkage.priorDBH).toBe(50);

    const comparisons = groupedRow.allErrors.map(error => error.comparison?.priorDBH);
    expect(comparisons).toEqual(expect.arrayContaining([30, 50]));
    expect(new Set(comparisons).size).toBe(2);
  });

  it('sets comparison to null for non-DBH-change occurrences, leaving the row-level fields null/false', () => {
    const ingestionOnlyRow = rawRow({
      ErrorSource: 'ingestion',
      ErrorCode: 'INVALID_QUADRAT',
      DisplayMessage: 'bad quadrat',
      ValidationCriteria: null,
      PriorCensusID: null,
      PriorDBH: null,
      PriorHOM: null
    });

    const grouped = groupErrorRowsForTest([ingestionOnlyRow], new Map());
    const groupedRow = grouped.get(10)!;

    expect(groupedRow.allErrors[0].comparison).toBeNull();

    const displayRow = toDisplayRowForTest(groupedRow, DEFAULT_FILTERS);
    expect(displayRow.priorCensusID).toBeNull();
    expect(displayRow.priorDBH).toBeNull();
    expect(displayRow.priorHOM).toBeNull();
    expect(displayRow.homChanged).toBe(false);
  });

  it('compares HOM values numerically so a DECIMAL-as-string prior does not falsely register as changed', () => {
    const grouped = groupErrorRowsForTest([rawRow({ PriorHOM: '1.300000' as unknown as number, MeasuredHOM: 1.3 })], new Map());
    const comparison = grouped.get(10)!.allErrors[0].comparison;

    expect(comparison?.homChanged).toBe(false);
  });
});

describe('HOMChanged in the CSV export', () => {
  function exportHOMChanged(overrides: Partial<RawErrorOccurrenceRow> = {}): string {
    const grouped = groupErrorRowsForTest([rawRow(overrides)], new Map());
    const rows = buildErrorExportRows(grouped, DEFAULT_FILTERS);
    expect(rows).toHaveLength(1);
    return rows[0].HOMChanged;
  }

  it('reports true only when both HOM values are present and differ', () => {
    expect(exportHOMChanged({ PriorHOM: 1.3, MeasuredHOM: 2.6 })).toBe('true');
  });

  it('reports false when both HOM values are present and equal', () => {
    expect(exportHOMChanged({ PriorHOM: 1.3, MeasuredHOM: 1.3 })).toBe('false');
  });

  // The bug this guards: a legacy row carries no snapshot at all, so every
  // Prior* column exports blank. Printing "false" beside them would claim a
  // comparison that never ran.
  it('leaves HOMChanged blank for a legacy row that predates the prior-census snapshot', () => {
    const legacy = { PriorCensusID: null, PriorDBH: null, PriorHOM: null };
    const grouped = groupErrorRowsForTest([rawRow(legacy as Partial<RawErrorOccurrenceRow>)], new Map());
    const row = buildErrorExportRows(grouped, DEFAULT_FILTERS)[0];

    expect(row.PriorCensusID).toBe('');
    expect(row.PriorDBH).toBe('');
    expect(row.PriorHOM).toBe('');
    expect(row.HOMChanged).toBe('');
  });

  it.each([
    ['the prior census recorded no HOM', { PriorHOM: null }],
    ['the current measurement has no HOM', { MeasuredHOM: null }],
    ['neither census recorded a HOM', { PriorHOM: null, MeasuredHOM: null }]
  ])('leaves HOMChanged blank when %s', (_label, overrides) => {
    expect(exportHOMChanged(overrides as Partial<RawErrorOccurrenceRow>)).toBe('');
  });

  // Prior DBH stays exportable even when HOM is not comparable -- the DBH
  // comparison is what the growth/shrinkage finding was actually based on.
  it('still exports the prior DBH when only the HOM is unavailable', () => {
    const grouped = groupErrorRowsForTest([rawRow({ PriorHOM: null })], new Map());
    const row = buildErrorExportRows(grouped, DEFAULT_FILTERS)[0];

    expect(row.PriorDBH).toBe(50);
    expect(row.PriorHOM).toBe('');
    expect(row.HOMChanged).toBe('');
  });

  it('leaves HOMChanged blank for a non-DBH-change occurrence, which has no comparison at all', () => {
    expect(
      exportHOMChanged({
        ErrorSource: 'ingestion',
        ErrorCode: 'INVALID_QUADRAT',
        DisplayMessage: 'bad quadrat',
        ValidationCriteria: null,
        PriorCensusID: null,
        PriorDBH: null,
        PriorHOM: null
      } as Partial<RawErrorOccurrenceRow>)
    ).toBe('');
  });
});
