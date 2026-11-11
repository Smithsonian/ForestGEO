import Papa from 'papaparse';
import { describe, expect, it } from 'vitest';

import { isBlankMeasurementRow, isEffectivelyEmptyMeasurementInput, type MeasurementInputRow } from './blank-measurement-input';

/** Parses with the exact options the worker and sync upload route use (header:true, skipEmptyLines:true). */
function parseRows(csvText: string): MeasurementInputRow[] {
  return Papa.parse<MeasurementInputRow>(csvText, { header: true, skipEmptyLines: true }).data;
}

describe('isBlankMeasurementRow', () => {
  it('treats null/undefined as blank', () => {
    expect(isBlankMeasurementRow(null)).toBe(true);
    expect(isBlankMeasurementRow(undefined)).toBe(true);
  });

  it('treats a row with no keys as blank', () => {
    expect(isBlankMeasurementRow({})).toBe(true);
  });

  it('treats a row whose every cell is null, undefined, or whitespace as blank', () => {
    expect(isBlankMeasurementRow({ tag: '', spcode: null, quadrat: undefined, dbh: '   ' })).toBe(true);
  });

  it('is NOT blank when at least one cell has a real value', () => {
    expect(isBlankMeasurementRow({ tag: 'T0001', spcode: '', quadrat: '' })).toBe(false);
  });

  it('is NOT blank for a row that is merely missing one required field', () => {
    // This is the "zero VALID rows, nonempty file" case — must continue
    // through normal validation and be recorded as a failure, not swallowed
    // as "empty".
    expect(isBlankMeasurementRow({ tag: 'T0006', stemtag: '1', spcode: 'TILIAA', quadrat: '', lx: '1', ly: '2' })).toBe(false);
  });

  // --- Real Papa Parse output shapes (header:true) -------------------------
  // These are the actual row shapes the worker and stage-measurements see;
  // previously `value.trim is not a function` crashed on the __parsed_extra
  // array below because every cell was assumed to be string | null | undefined.

  it('treats a delimiter-only CSV data line as blank (Papa Parse produces empty-string cells, exact column count)', () => {
    const [row] = parseRows('tag,spcode\n,\n');
    expect(row).toEqual({ tag: '', spcode: '' });
    expect(isBlankMeasurementRow(row)).toBe(true);
  });

  it('treats a data line with MORE delimiters than header columns as blank when the overflow cells are also blank', () => {
    // "tag,spcode\n,,\n" has one extra comma: Papa Parse keys the first two
    // fields normally and collects the overflow into __parsed_extra: [''].
    const [row] = parseRows('tag,spcode\n,,\n');
    expect(row).toEqual({ tag: '', spcode: '', __parsed_extra: [''] });
    expect(isBlankMeasurementRow(row)).toBe(true);
  });

  it('is NOT blank when the __parsed_extra overflow column carries a real value', () => {
    // "tag,spcode\n,,unexpected\n" — same overflow shape, but the extra cell
    // is non-blank. This row must flow through to ordinary failure recording,
    // not be treated as structurally blank.
    const [row] = parseRows('tag,spcode\n,,unexpected\n');
    expect(row).toEqual({ tag: '', spcode: '', __parsed_extra: ['unexpected'] });
    expect(isBlankMeasurementRow(row)).toBe(false);
  });

  it('is NOT blank when the __parsed_extra overflow column has a blank AND a non-blank element', () => {
    const [row] = parseRows('tag,spcode\n,,,unexpected\n');
    expect(row).toEqual({ tag: '', spcode: '', __parsed_extra: ['', 'unexpected'] });
    expect(isBlankMeasurementRow(row)).toBe(false);
  });

  // --- Non-string cell types ------------------------------------------------
  // Papa Parse with header:true always produces strings, but the shared type
  // is `unknown`-valued so any future caller (or a dynamicTyping:true parse)
  // must not crash and must not misclassify numeric/boolean/Date data as blank.

  it('is NOT blank for a numeric cell, including 0', () => {
    expect(isBlankMeasurementRow({ tag: 'T0001', dbh: 0 })).toBe(false);
    expect(isBlankMeasurementRow({ tag: 'T0001', dbh: 12.5 })).toBe(false);
  });

  it('is NOT blank for a boolean cell, including false', () => {
    expect(isBlankMeasurementRow({ tag: 'T0001', flagged: false })).toBe(false);
    expect(isBlankMeasurementRow({ tag: 'T0001', flagged: true })).toBe(false);
  });

  it('is NOT blank for a Date or plain-object cell', () => {
    expect(isBlankMeasurementRow({ tag: 'T0001', date: new Date('2024-01-01') })).toBe(false);
    expect(isBlankMeasurementRow({ tag: 'T0001', meta: { note: 'x' } })).toBe(false);
  });

  it('does not throw for a row mixing strings, numbers, booleans, null, and an array cell', () => {
    expect(() =>
      isBlankMeasurementRow({
        tag: 'T0001',
        dbh: 0,
        flagged: false,
        spcode: null,
        __parsed_extra: ['', '']
      })
    ).not.toThrow();
  });
});

describe('isEffectivelyEmptyMeasurementInput', () => {
  it('is empty for null/undefined/empty array (header-only CSV after parsing)', () => {
    expect(isEffectivelyEmptyMeasurementInput(null)).toBe(true);
    expect(isEffectivelyEmptyMeasurementInput(undefined)).toBe(true);
    expect(isEffectivelyEmptyMeasurementInput([])).toBe(true);
  });

  it('is empty when every row is blank, even with multiple rows', () => {
    expect(isEffectivelyEmptyMeasurementInput([{ tag: '', spcode: '' }, { tag: '  ', spcode: null }, {}])).toBe(true);
  });

  it('is empty for a real header-only CSV parse (no data rows at all)', () => {
    const rows = parseRows('tag,spcode\n');
    expect(rows).toEqual([]);
    expect(isEffectivelyEmptyMeasurementInput(rows)).toBe(true);
  });

  it('is empty for a real CSV whose only body line is delimiter-only', () => {
    const rows = parseRows('tag,spcode,quadrat\n,,\n');
    expect(isEffectivelyEmptyMeasurementInput(rows)).toBe(true);
  });

  it('is NOT empty when at least one row has a real value', () => {
    expect(
      isEffectivelyEmptyMeasurementInput([
        { tag: '', spcode: '' },
        { tag: 'T0001', spcode: 'ACERRU' }
      ])
    ).toBe(false);
  });

  it('is NOT empty for a nonempty file whose rows all fail semantic validation', () => {
    // Every row here is missing the required `quadrat` field but still carries
    // real data — this must be treated as "zero valid rows", not "empty file".
    const allRejectedButNonblank = [
      { tag: 'T0001', spcode: 'ACERRU', quadrat: '' },
      { tag: 'T0002', spcode: 'QUERCO', quadrat: '' }
    ];
    expect(isEffectivelyEmptyMeasurementInput(allRejectedButNonblank)).toBe(false);
  });

  it('is NOT empty for a real CSV where an overflow column on one row carries a real value', () => {
    const rows = parseRows('tag,spcode\n,,\n,,unexpected\n');
    expect(isEffectivelyEmptyMeasurementInput(rows)).toBe(false);
  });
});
