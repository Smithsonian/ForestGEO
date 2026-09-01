import { describe, expect, it } from 'vitest';
import { computeDiff, ExistingMeasurementRow } from './matchdiff';
import type { FileRow } from '@/config/macros/formdetails';

function makeDbRow(overrides: Partial<ExistingMeasurementRow> = {}): ExistingMeasurementRow {
  return {
    CoreMeasurementID: 1,
    StemGUID: 10,
    IsActive: 1,
    MeasuredDBH: 12.3,
    MeasuredHOM: 1.3,
    MeasurementDate: '2026-04-01',
    RawCodes: null,
    Description: null,
    RawTreeTag: 'T1',
    RawStemTag: 'S1',
    StemIsActive: 1,
    TreeIsActive: 1,
    QuadratIsActive: 1,
    PlotID: 1,
    TreeTag: 'T1',
    StemTag: 'S1',
    SpeciesCode: 'ACERRU',
    QuadratName: 'Q1',
    LocalX: 3.5,
    LocalY: 4.25,
    StemPlotX: null,
    StemPlotY: null,
    ...overrides
  };
}

describe('computeDiff plot coordinates', () => {
  it('flags a px/py change against the stored plot coordinates', () => {
    const dbRow = makeDbRow({ StemPlotX: 100.123456, StemPlotY: 200.5 });
    const csvRow = { px: '-2.75', py: '200.5' } as unknown as FileRow;

    const changes = computeDiff(csvRow, dbRow);

    expect(changes.px).toEqual({ from: '100.123456', to: '-2.75' });
    // py matches numerically → no phantom change.
    expect(changes.py).toBeUndefined();
  });

  it('fills plot coordinates on a row that has none', () => {
    const dbRow = makeDbRow();
    const csvRow = { px: '15.25', py: '30.125' } as unknown as FileRow;

    const changes = computeDiff(csvRow, dbRow);

    expect(changes.px).toEqual({ from: null, to: '15.25' });
    expect(changes.py).toEqual({ from: null, to: '30.125' });
  });

  it('treats blank px/py cells as "no change", never as a clear', () => {
    const dbRow = makeDbRow({ StemPlotX: 100.5, StemPlotY: 200.5 });
    const csvRow = { px: '', py: 'NULL' } as unknown as FileRow;

    const changes = computeDiff(csvRow, dbRow);

    expect(changes.px).toBeUndefined();
    expect(changes.py).toBeUndefined();
  });

  it('compares px numerically so trailing decimal zeros are not a change', () => {
    const dbRow = makeDbRow({ StemPlotX: 100.5 });
    const csvRow = { px: '100.500000' } as unknown as FileRow;

    expect(computeDiff(csvRow, dbRow).px).toBeUndefined();
  });
});
