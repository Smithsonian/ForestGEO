import { describe, expect, it } from 'vitest';
import { compareSourceRows, computeDiff, ExistingMeasurementRow, readExplicitSpeciesCode } from './matchdiff';
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

// mysql2 runs with timezone 'Z', so a stored DATE arrives as a Date at UTC midnight.
// Reading it with local getters shifts it to the previous day in every zone west of
// UTC, which is how a local PDT run saw a phantom `date` change on an unchanged row.
// Run this file under TZ=America/Los_Angeles to exercise that zone.
const STORED_MEASUREMENT_DAY = '2026-04-01';
const STORED_MEASUREMENT_DATE_FROM_DRIVER = new Date(`${STORED_MEASUREMENT_DAY}T00:00:00.000Z`);

describe('computeDiff measurement date', () => {
  it(`reports no change when the CSV repeats the stored date (process TZ=${process.env.TZ ?? 'unset'})`, () => {
    const dbRow = makeDbRow({ MeasurementDate: STORED_MEASUREMENT_DATE_FROM_DRIVER });
    const csvRow = { date: STORED_MEASUREMENT_DAY } as unknown as FileRow;

    const changes = computeDiff(csvRow, dbRow);

    expect(changes, `unexpected changes: ${JSON.stringify(changes)}`).toEqual({});
  });

  it('reports the stored calendar day as `from` when the CSV moves the date', () => {
    const dbRow = makeDbRow({ MeasurementDate: STORED_MEASUREMENT_DATE_FROM_DRIVER });
    const csvRow = { date: '2026-04-02' } as unknown as FileRow;

    const changes = computeDiff(csvRow, dbRow);

    expect(changes.date).toEqual({ from: STORED_MEASUREMENT_DAY, to: '2026-04-02' });
  });
});

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

describe('compareSourceRows numeric precision classification', () => {
  it('classifies equal parsed numbers with different text as identical, never precision-equivalent', () => {
    // '1' and '1.0' parse to the exact same number — the same stored value
    // written two different ways, not export-tool noise beyond DECIMAL(12,6)
    // precision. A later identical row is a genuine duplicate, not a collapse.
    const a = { dbh: '1' } as unknown as FileRow;
    const b = { dbh: '1.0' } as unknown as FileRow;

    expect(compareSourceRows(a, b)).toBe('identical');
  });

  it('does NOT collapse a pair that rounds to different stored DECIMAL(12,6) values at the 7th decimal (MySQL half-up proof pair)', () => {
    // CAST('1.2345665' AS DECIMAL(12,6)) = 1.234567 but
    // CAST('1.2345664' AS DECIMAL(12,6)) = 1.234566 — two different stored
    // values, so this pair is a genuine duplicate, never a collapse.
    const a = { dbh: '1.2345665' } as unknown as FileRow;
    const b = { dbh: '1.2345664' } as unknown as FileRow;

    expect(compareSourceRows(a, b)).toBe('different');
  });

  it('collapses a pair that rounds half-up to the SAME stored DECIMAL(12,6) value at the 7th decimal', () => {
    // Both round half-up to 44.123456 — the same stored row written twice
    // with export-tool float noise past the stored precision.
    const a = { dbh: '44.1234561' } as unknown as FileRow;
    const b = { dbh: '44.1234564' } as unknown as FileRow;

    expect(compareSourceRows(a, b)).toBe('precision-equivalent');
  });

  it('still classifies a real DBH change beyond stored precision as different', () => {
    const a = { dbh: '12.345' } as unknown as FileRow;
    const b = { dbh: '13.5' } as unknown as FileRow;

    expect(compareSourceRows(a, b)).toBe('different');
  });

  it('expands exponent-notation text exactly rather than collapsing through a lossy double (regression: toFixed cannot be substituted for the half-up proof pair)', () => {
    // '1.2345665e0' and '1.2345664e0' are the exact same half-up proof pair
    // used above, just written in exponent notation. Number('1.2345665e0')
    // and Number('1.2345664e0') both round through toFixed(6) to the same
    // double-precision value, which would wrongly collapse this into
    // 'precision-equivalent' instead of 'different'.
    const a = { dbh: '1.2345665e0' } as unknown as FileRow;
    const b = { dbh: '1.2345664e0' } as unknown as FileRow;

    expect(compareSourceRows(a, b)).toBe('different');
  });

  it('collapses a precision-equivalent pair even when one side is exponent-notation text', () => {
    // 4.41234561e1 === 44.1234561, the same precision-equivalent pair as
    // above (both round half-up to 44.123456).
    const a = { dbh: '4.41234561e1' } as unknown as FileRow;
    const b = { dbh: '44.1234564' } as unknown as FileRow;

    expect(compareSourceRows(a, b)).toBe('precision-equivalent');
  });

  it('collapses a precision-equivalent pair whose integer part differs only by a zero-padded export (regression: a stray leading zero must not turn an equivalent pair into "different")', () => {
    // '003.1234561' and '3.1234564' both round half-up to the same stored
    // DECIMAL(12,6) value (3.123456) — a zero-padded integer part from an
    // export tool must not itself make the rounded text strings disagree.
    const a = { dbh: '003.1234561' } as unknown as FileRow;
    const b = { dbh: '3.1234564' } as unknown as FileRow;

    expect(compareSourceRows(a, b)).toBe('precision-equivalent');
  });

  it('does NOT treat a pair as identical just because they parse to the same double, when their exact decimal text rounds to DIFFERENT stored DECIMAL(12,6) values (#505 review round 2: parsedA===parsedB bypassed the exact-scale comparison)', () => {
    // These two decimal texts differ starting at the 16th significant digit —
    // close enough that Number() rounds BOTH to the exact same double, so a
    // parsedA===parsedB shortcut would wrongly call this "identical". But
    // MySQL's half-up CAST(... AS DECIMAL(12,6)) rounds the 7th fraction
    // digit ('4' vs '5') differently: 1.234566 vs 1.234567 — two different
    // stored values, so this must be 'different', never 'identical' or
    // 'precision-equivalent'.
    const a = { dbh: '1.234566499999999999' } as unknown as FileRow;
    const b = { dbh: '1.234566500000000001' } as unknown as FileRow;

    expect(Number(a.dbh)).toBe(Number(b.dbh));
    expect(compareSourceRows(a, b)).toBe('different');
  });

  it('applies the same exact-stored-scale comparison to exponent-notation text as to plain decimal text (regression for both forms)', () => {
    // Same double-collision pair as above, written in exponent notation.
    const a = { dbh: '1.234566499999999999e0' } as unknown as FileRow;
    const b = { dbh: '1.234566500000000001e0' } as unknown as FileRow;

    expect(compareSourceRows(a, b)).toBe('different');
  });

  it('refuses to collapse (returns "different") rather than crash or allocate unboundedly on an exponent magnitude no legitimate DECIMAL(12,6) value could ever need (#505 review round 2: expandExponentNotation unbounded String.repeat)', () => {
    // A 24-digit negative exponent used to drive expandExponentNotation's
    // padding to a magnitude that either threw RangeError (count exceeds
    // String.repeat's max length) or allocated megabytes of zero-padding.
    const a = { dbh: '1e-999999999999999999999999' } as unknown as FileRow;
    const b = { dbh: '1' } as unknown as FileRow;

    expect(() => compareSourceRows(a, b)).not.toThrow();
    expect(compareSourceRows(a, b)).toBe('different');
  });

  it('also refuses to collapse a merely large (not RangeError-sized) exponent magnitude, so no megabyte-scale zero-padding is ever allocated', () => {
    const a = { dbh: '1e300' } as unknown as FileRow;
    const b = { dbh: '1' } as unknown as FileRow;

    expect(() => compareSourceRows(a, b)).not.toThrow();
    expect(compareSourceRows(a, b)).toBe('different');
  });
});
