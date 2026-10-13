import { describe, expect, it } from 'vitest';
import { computeDiff, ExistingMeasurementRow, readExplicitSpeciesCode } from './matchdiff';
import type { FileRow } from '@/config/macros/formdetails';
import { InvalidFieldValueError } from '@/config/editplan/fieldpolicy';

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

  it('compares the six-decimal canonical value so excess precision does not create a phantom change', () => {
    const dbRow = makeDbRow({ StemPlotX: 100.123456 });
    const csvRow = { px: '100.1234564' } as unknown as FileRow;

    expect(computeDiff(csvRow, dbRow).px).toBeUndefined();
  });

  it('rejects malformed numeric prefixes even when parseFloat would match the stored value', () => {
    const dbRow = makeDbRow({ StemPlotX: 100 });
    const csvRow = { px: '100abc' } as unknown as FileRow;

    expect(() => computeDiff(csvRow, dbRow)).toThrow(InvalidFieldValueError);
  });

  it('rejects plot coordinates outside DECIMAL(12,6)', () => {
    const dbRow = makeDbRow({ StemPlotX: 100 });
    const csvRow = { px: '1000000' } as unknown as FileRow;

    expect(() => computeDiff(csvRow, dbRow)).toThrow(InvalidFieldValueError);
  });

  it('does not invent a change when the stored value carries more precision than the field is compared at', () => {
    // MeasuredDBH/LocalX live in DECIMAL(12,6) but canonicalize to 2 places.
    // Rounding only the CSV side made these look different, so the review UI
    // showed a change whose `from` and `to` render identically — and applying
    // it silently rewrote 12.345 to 12.35.
    const dbRow = makeDbRow({ MeasuredDBH: 12.345, LocalX: 3.456 });
    const csvRow = { dbh: '12.345', lx: '3.456' } as unknown as FileRow;

    const changes = computeDiff(csvRow, dbRow);

    expect(changes.dbh).toBeUndefined();
    expect(changes.lx).toBeUndefined();
  });

  it('still flags a real dbh change at the compared precision', () => {
    const dbRow = makeDbRow({ MeasuredDBH: 12.345 });
    const csvRow = { dbh: '13.5' } as unknown as FileRow;

    expect(computeDiff(csvRow, dbRow).dbh).toEqual({ from: '12.345', to: '13.5' });
  });
});

describe('readExplicitSpeciesCode', () => {
  it('returns the trimmed original spelling, not canonicalized to the DB casing', () => {
    const csvRow = { spcode: 'quemar' } as unknown as FileRow;

    expect(readExplicitSpeciesCode(csvRow)).toBe('quemar');
  });

  it('trims surrounding whitespace without altering internal casing', () => {
    const csvRow = { spcode: '  QuemAR  ' } as unknown as FileRow;

    expect(readExplicitSpeciesCode(csvRow)).toBe('QuemAR');
  });

  it('returns null when spcode is missing from the row', () => {
    const csvRow = {} as unknown as FileRow;

    expect(readExplicitSpeciesCode(csvRow)).toBeNull();
  });

  it('returns null when spcode is undefined', () => {
    const csvRow = { spcode: undefined } as unknown as FileRow;

    expect(readExplicitSpeciesCode(csvRow)).toBeNull();
  });

  it('returns null when spcode is an empty string', () => {
    const csvRow = { spcode: '' } as unknown as FileRow;

    expect(readExplicitSpeciesCode(csvRow)).toBeNull();
  });

  it('returns null when spcode is whitespace-only', () => {
    const csvRow = { spcode: '   ' } as unknown as FileRow;

    expect(readExplicitSpeciesCode(csvRow)).toBeNull();
  });

  it('returns null for the literal "NULL" placeholder in upper case', () => {
    const csvRow = { spcode: 'NULL' } as unknown as FileRow;

    expect(readExplicitSpeciesCode(csvRow)).toBeNull();
  });

  it('returns null for the literal "NULL" placeholder in lower case', () => {
    const csvRow = { spcode: 'null' } as unknown as FileRow;

    expect(readExplicitSpeciesCode(csvRow)).toBeNull();
  });

  it('returns null for the "NULL" placeholder surrounded by whitespace and mixed case', () => {
    const csvRow = { spcode: '  Null  ' } as unknown as FileRow;

    expect(readExplicitSpeciesCode(csvRow)).toBeNull();
  });

  it('is still returned when computeDiff drops the same cell as an unchanged case-only match (the whole reason this function exists)', () => {
    // DB stores the species code upper-case; the CSV author retyped it
    // lower-case without actually changing species. computeDiff's spcode
    // comparison is case-insensitive, so it reports no change — but a
    // sibling batch row correcting this tree's species still needs to know
    // this row explicitly asked for 'quemar', not merely that it is unset.
    const dbRow = makeDbRow({ SpeciesCode: 'QUEMAR' });
    const csvRow = { spcode: 'quemar' } as unknown as FileRow;

    const changes = computeDiff(csvRow, dbRow);
    expect(changes.spcode).toBeUndefined();

    expect(readExplicitSpeciesCode(csvRow)).toBe('quemar');
  });
});
