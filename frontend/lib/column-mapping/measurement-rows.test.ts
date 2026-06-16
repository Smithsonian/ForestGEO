import { describe, expect, it } from 'vitest';
import { FileRow, FormType, RequiredTableHeadersByFormType, SourceFormat } from '@/config/macros/formdetails';
import { ColumnMapping } from './types';
import { headerSignature } from './mapping';
import { resolveMeasurementChunk, transformMeasurementValue, validateMeasurementRow } from './measurement-rows';

const MEASUREMENTS_REQUIRED = [{ label: 'tag' }, { label: 'spcode' }, { label: 'quadrat' }];
const DEFAULT_DELIMITER = ',';

/**
 * A complete, valid scope-aware CSV mapping that sources canonical `lx` from a renamed source
 * column `MyX` (every required field is named, so chooseEffectiveCsvMapping trusts it). The literal
 * `lx` header in the file therefore has no field to claim and must be diverted to an inert ignored
 * key — never reaching validation as a real `lx` value.
 */
function lxRenamedMapping(csvHeaders: string[]): ColumnMapping {
  const field = (canonicalField: string, sourceColumns: string[]): ColumnMapping['fields'][number] => ({ canonicalField, sourceColumns, scope: 'file' });
  return {
    version: 1,
    format: SourceFormat.csv,
    fields: [
      field('tag', ['tag']),
      field('spcode', ['spcode']),
      field('quadrat', ['quadrat']),
      // The renamed source column carries lx; the literal 'lx' header is intentionally left unclaimed.
      field('lx', ['MyX']),
      field('ly', ['ly']),
      field('date', ['date'])
    ],
    // The mapping is trusted only when its signature matches these exact headers.
    headerSignature: headerSignature(csvHeaders)
  };
}

describe('transformMeasurementValue', () => {
  it('collapses the three nullish tokens to null', () => {
    expect(transformMeasurementValue('NA', 'dbh', FormType.measurements)).toBeNull();
    expect(transformMeasurementValue('NULL', 'dbh', FormType.measurements)).toBeNull();
    expect(transformMeasurementValue('', 'dbh', FormType.measurements)).toBeNull();
  });

  it('parses a recognized measurement date string into a Date', () => {
    const result = transformMeasurementValue('2023-05-17', 'date', FormType.measurements);
    expect(result).toBeInstanceOf(Date);
    const asDate = result as Date;
    expect(asDate.getFullYear()).toBe(2023);
    expect(asDate.getMonth()).toBe(4); // May is month index 4
    expect(asDate.getDate()).toBe(17);
  });

  it('parses an alternate-format measurement date (MM/DD/YYYY) into a Date', () => {
    const result = transformMeasurementValue('05/17/2023', 'date', FormType.measurements);
    expect(result).toBeInstanceOf(Date);
    expect((result as Date).getFullYear()).toBe(2023);
  });

  it('returns the original string when a measurement date cannot be parsed', () => {
    const garbage = 'not-a-date-at-all';
    expect(transformMeasurementValue(garbage, 'date', FormType.measurements)).toBe(garbage);
  });

  it('rounds lx coordinates to six decimal places', () => {
    expect(transformMeasurementValue('12.12345678', 'lx', FormType.measurements)).toBe(12.123457);
    expect(transformMeasurementValue('12.12345678', 'ly', FormType.measurements)).toBe(12.123457);
  });

  it('rounds dbh and hom to two decimal places', () => {
    expect(transformMeasurementValue('15.678', 'dbh', FormType.measurements)).toBe(15.68);
    expect(transformMeasurementValue('15.678', 'hom', FormType.measurements)).toBe(15.68);
  });

  it('leaves numeric values untouched (as strings) for a non-measurements form', () => {
    // The coordinate/dbh/date special-casing is gated on FormType.measurements; other forms pass through.
    expect(transformMeasurementValue('12.12345678', 'lx', FormType.species)).toBe('12.12345678');
    expect(transformMeasurementValue('2023-05-17', 'date', FormType.species)).toBe('2023-05-17');
    expect(transformMeasurementValue('15.678', 'dbh', FormType.quadrats)).toBe('15.678');
  });

  it('passes through an unrecognized measurement field unchanged', () => {
    expect(transformMeasurementValue('abc', 'spcode', FormType.measurements)).toBe('abc');
  });

  it('does NOT coerce a partially-numeric measurement value (strict parse)', () => {
    // Number.parseFloat('12.5abc') is 12.5 (lenient); strict parsing must NOT silently accept it.
    // The raw string is returned unchanged so validation can reject the row.
    expect(transformMeasurementValue('12.5abc', 'dbh', FormType.measurements)).toBe('12.5abc');
    expect(transformMeasurementValue('12.5abc', 'lx', FormType.measurements)).toBe('12.5abc');
  });
});

describe('validateMeasurementRow', () => {
  it('accepts a complete in-range row', () => {
    const row = { tag: 'T1', spcode: 'abc', quadrat: 'q1', dbh: '12.5' };
    const result = validateMeasurementRow(row, MEASUREMENTS_REQUIRED, DEFAULT_DELIMITER, FormType.measurements);
    expect(result.valid).toBe(true);
    expect(result.failureReason).toBeUndefined();
    expect(result.hasExtraColumns).toBe(false);
  });

  it('flags a missing required field', () => {
    const row = { tag: 'T1', spcode: null, quadrat: 'q1' };
    const result = validateMeasurementRow(row, MEASUREMENTS_REQUIRED, DEFAULT_DELIMITER, FormType.measurements);
    expect(result.valid).toBe(false);
    expect(result.failureReason).toContain('Missing required fields');
    expect(result.failureReason).toContain('spcode');
  });

  it('treats NA / NULL / empty / undefined as missing for required fields', () => {
    for (const sentinel of ['NA', 'NULL', '', null, undefined] as (string | null | undefined)[]) {
      const row: Record<string, string | null> = { tag: 'T1', quadrat: 'q1' };
      if (sentinel !== undefined) row.spcode = sentinel;
      const result = validateMeasurementRow(row, MEASUREMENTS_REQUIRED, DEFAULT_DELIMITER, FormType.measurements);
      expect(result.valid).toBe(false);
      expect(result.failureReason).toContain('spcode');
    }
  });

  it('flags an out-of-range decimal on a real column', () => {
    const negative = { tag: 'T1', spcode: 'abc', quadrat: 'q1', dbh: '-5' };
    const negResult = validateMeasurementRow(negative, MEASUREMENTS_REQUIRED, DEFAULT_DELIMITER, FormType.measurements);
    expect(negResult.valid).toBe(false);
    expect(negResult.failureReason).toContain('Decimal value for dbh is out of range');

    const tooBig = { tag: 'T1', spcode: 'abc', quadrat: 'q1', dbh: '1000000' };
    const bigResult = validateMeasurementRow(tooBig, MEASUREMENTS_REQUIRED, DEFAULT_DELIMITER, FormType.measurements);
    expect(bigResult.valid).toBe(false);
    expect(bigResult.failureReason).toContain('Decimal value for dbh is out of range');
  });

  it('never range-rejects tag or stemtag even when numeric', () => {
    const row = { tag: '-5', stemtag: '1000000', spcode: 'abc', quadrat: 'q1' };
    const result = validateMeasurementRow(row, MEASUREMENTS_REQUIRED, DEFAULT_DELIMITER, FormType.measurements);
    // tag/stemtag are excluded from the decimal-range check; both present and short with no delimiter.
    expect(result.failureReason ?? '').not.toContain('out of range');
  });

  it('does NOT flag a long tag unless BOTH tag and stemtag are present', () => {
    const longTag = 'X'.repeat(80);
    const onlyTag = { tag: longTag, spcode: 'abc', quadrat: 'q1' };
    const result = validateMeasurementRow(onlyTag, MEASUREMENTS_REQUIRED, DEFAULT_DELIMITER, FormType.measurements);
    // stemtag absent -> the tag/stemtag sanity block is skipped entirely.
    expect(result.failureReason ?? '').not.toContain('long tag');
    expect(result.failureReason ?? '').not.toContain('Unusually long');
  });

  it('flags long values only when both tag AND stemtag are present', () => {
    const longTag = 'X'.repeat(80);
    const row = { tag: longTag, stemtag: 'S1', spcode: 'abc', quadrat: 'q1' };
    const result = validateMeasurementRow(row, MEASUREMENTS_REQUIRED, DEFAULT_DELIMITER, FormType.measurements);
    expect(result.valid).toBe(false);
    expect(result.failureReason).toContain('Unusually long tag values');
  });

  it('flags delimiter contamination only when both tag and stemtag are present', () => {
    const row = { tag: 'A,B', stemtag: 'S1', spcode: 'abc', quadrat: 'q1' };
    const result = validateMeasurementRow(row, MEASUREMENTS_REQUIRED, ',', FormType.measurements);
    expect(result.valid).toBe(false);
    expect(result.failureReason).toContain('contain delimiter character');
  });

  it('reports __parsed_extra via hasExtraColumns without treating it as a decimal', () => {
    const row = { tag: 'T1', spcode: 'abc', quadrat: 'q1', __parsed_extra: 'leftover' as unknown as string };
    const result = validateMeasurementRow(row, MEASUREMENTS_REQUIRED, DEFAULT_DELIMITER, FormType.measurements);
    expect(result.hasExtraColumns).toBe(true);
    expect(result.valid).toBe(true);
  });

  it('rejects a row whose __parsed_extra leading cell is an out-of-range number (parity with legacy validateRow)', () => {
    // papaparse stores leftover cells as an array under __parsed_extra. The legacy inline validateRow
    // did NOT exclude __parsed_extra from the decimal-range loop: Number.parseFloat(String(['-5','junk']))
    // is -5 -> out of range -> the whole row was rejected. The shared validator must match that exactly.
    const row = { tag: 'T1', stemtag: 'S1', spcode: 'abc', quadrat: 'q1', __parsed_extra: ['-5', 'junk'] } as unknown as FileRow;
    const verdict = validateMeasurementRow(row, [{ label: 'tag' }, { label: 'spcode' }, { label: 'quadrat' }], ',', FormType.measurements);
    expect(verdict.valid).toBe(false);
    expect(verdict.failureReason).toContain('__parsed_extra');
  });

  it('does NOT range-reject a non-numeric __parsed_extra array (parseFloat of a non-numeric leading cell is NaN)', () => {
    // Same code path as above, but the leading cell parses to NaN, so no range error is produced.
    const row = { tag: 'T1', stemtag: 'S1', spcode: 'abc', quadrat: 'q1', __parsed_extra: ['foo', 'bar'] } as unknown as FileRow;
    const verdict = validateMeasurementRow(row, [{ label: 'tag' }, { label: 'spcode' }, { label: 'quadrat' }], ',', FormType.measurements);
    expect(verdict.valid).toBe(true);
    expect(verdict.failureReason ?? '').not.toContain('out of range');
    expect(verdict.hasExtraColumns).toBe(true);
  });

  it('does not range-reject a key that is simply absent from the row', () => {
    // Only keys actually present are inspected; an absent dbh cannot cause a range error.
    const row = { tag: 'T1', spcode: 'abc', quadrat: 'q1' };
    const result = validateMeasurementRow(row, MEASUREMENTS_REQUIRED, DEFAULT_DELIMITER, FormType.measurements);
    expect(result.valid).toBe(true);
  });

  describe('numeric and date field rejection (M1/M2)', () => {
    // dbh/hom are OPTIONAL, so nulling a bad value would silently accept it. A non-numeric value
    // present in any measurement numeric field must REJECT the row, not coerce or drop it.
    it('rejects a non-numeric value in the optional dbh field', () => {
      const row = { tag: 'T1', spcode: 'abc', quadrat: 'q1', dbh: 'oops' };
      const result = validateMeasurementRow(row, MEASUREMENTS_REQUIRED, DEFAULT_DELIMITER, FormType.measurements);
      expect(result.valid).toBe(false);
      expect(result.failureReason).toContain('Non-numeric value for dbh');
    });

    it('rejects a partially-numeric value like "12.5abc" in a numeric field (strict)', () => {
      const row = { tag: 'T1', spcode: 'abc', quadrat: 'q1', lx: '12.5abc' };
      const result = validateMeasurementRow(row, MEASUREMENTS_REQUIRED, DEFAULT_DELIMITER, FormType.measurements);
      expect(result.valid).toBe(false);
      expect(result.failureReason).toContain('Non-numeric value for lx');
    });

    it('accepts clean numeric values whether passed as a string or a number', () => {
      const asString = { tag: 'T1', spcode: 'abc', quadrat: 'q1', dbh: '12.5', hom: '1.3' };
      expect(validateMeasurementRow(asString, MEASUREMENTS_REQUIRED, DEFAULT_DELIMITER, FormType.measurements).valid).toBe(true);
      const asNumber = { tag: 'T1', spcode: 'abc', quadrat: 'q1', dbh: 12.5 as unknown as string };
      expect(validateMeasurementRow(asNumber, MEASUREMENTS_REQUIRED, DEFAULT_DELIMITER, FormType.measurements).valid).toBe(true);
    });

    it('treats a null/NA numeric value as absent, not as a non-numeric error', () => {
      const row = { tag: 'T1', spcode: 'abc', quadrat: 'q1', dbh: null };
      expect(validateMeasurementRow(row, MEASUREMENTS_REQUIRED, DEFAULT_DELIMITER, FormType.measurements).valid).toBe(true);
    });

    it('rejects a date field that stayed an unparseable string after transform', () => {
      // After transformMeasurementValue, a valid date is a Date and an unparseable one stays a string.
      const row = { tag: 'T1', spcode: 'abc', quadrat: 'q1', date: 'not-a-date' as unknown as string };
      const result = validateMeasurementRow(row, MEASUREMENTS_REQUIRED, DEFAULT_DELIMITER, FormType.measurements);
      expect(result.valid).toBe(false);
      expect(result.failureReason).toContain('Unparseable date');
    });

    it('accepts a Date-valued date field', () => {
      const row = { tag: 'T1', spcode: 'abc', quadrat: 'q1', date: new Date('2023-05-17') as unknown as string };
      expect(validateMeasurementRow(row, MEASUREMENTS_REQUIRED, DEFAULT_DELIMITER, FormType.measurements).valid).toBe(true);
    });
  });
});

describe('resolveMeasurementChunk', () => {
  it('#5 end-to-end pin: a diverted out-of-range literal column never reaches validation', () => {
    // 'lx' is sourced from 'MyX'; the literal 'lx' header is unclaimed and must be diverted to an
    // inert ignored key. ly/date columns satisfy the remaining required CSV fields so the mapping is
    // trusted (chooseEffectiveCsvMapping rejects any incomplete mapping).
    const csvHeaders = ['lx', 'MyX', 'tag', 'spcode', 'quadrat', 'ly', 'date'];
    const rawRow = { lx: '-5', MyX: '12.5', tag: 'T1', spcode: 'abc', quadrat: 'q1', ly: '3.0', date: '2023-05-17' };

    const result = resolveMeasurementChunk([rawRow], csvHeaders.length, {
      formType: FormType.measurements,
      uploadMode: 'other',
      delimiter: DEFAULT_DELIMITER,
      requiredHeaders: MEASUREMENTS_REQUIRED,
      csvHeaders,
      storedMapping: lxRenamedMapping(csvHeaders)
    });

    expect(result.columnCountMismatch).toBe(false);
    expect(result.invalidRows).toHaveLength(0);
    expect(result.validRows).toHaveLength(1);

    const validRow = result.validRows[0];
    // The renamed source column carries the real lx value, rounded by the transform.
    expect(validRow.lx).toBe(12.5);
    // The literal 'lx' header had no field to claim and must be diverted to an inert ignored key,
    // then stripped on collapse -> no surviving key may contain the ignored suffix.
    for (const key of Object.keys(validRow)) {
      expect(key).not.toContain('__ignored');
    }
    // And the diverted '-5' must NOT have produced a range error.
    expect(validRow.failureReason).toBeUndefined();
  });

  it('rejects the whole chunk when parsedFieldCount does not match the plan width', () => {
    const csvHeaders = ['tag', 'spcode', 'quadrat', 'dbh'];
    const rawRow = { tag: 'T1', spcode: 'abc', quadrat: 'q1', dbh: '12.5' };

    const result = resolveMeasurementChunk([rawRow], csvHeaders.length + 1, {
      formType: FormType.measurements,
      uploadMode: 'other',
      delimiter: DEFAULT_DELIMITER,
      requiredHeaders: MEASUREMENTS_REQUIRED,
      csvHeaders
    });

    expect(result.columnCountMismatch).toBe(true);
    expect(result.validRows).toHaveLength(0);
    expect(result.invalidRows).toHaveLength(0);
    expect(result.plan).not.toBeNull();
  });

  it('builds a non-null plan and validates rows when the column count matches', () => {
    const csvHeaders = ['tag', 'spcode', 'quadrat', 'dbh'];
    const rawRow = { tag: 'T1', spcode: 'abc', quadrat: 'q1', dbh: '12.5' };

    const result = resolveMeasurementChunk([rawRow], csvHeaders.length, {
      formType: FormType.measurements,
      uploadMode: 'other',
      delimiter: DEFAULT_DELIMITER,
      requiredHeaders: MEASUREMENTS_REQUIRED,
      csvHeaders
    });

    expect(result.columnCountMismatch).toBe(false);
    expect(result.plan).not.toBeNull();
    expect(result.validRows).toHaveLength(1);
    expect(result.validRows[0].dbh).toBe(12.5);
  });

  it('passes rows through with raw keys and a null plan in revisions mode', () => {
    const csvHeaders = ['tag', 'spcode', 'quadrat', 'dbh'];
    const rawRow = { tag: 'T1', spcode: 'abc', quadrat: 'q1', dbh: '12.5' };

    const result = resolveMeasurementChunk([rawRow], csvHeaders.length, {
      formType: FormType.measurements,
      uploadMode: 'revisions',
      delimiter: DEFAULT_DELIMITER,
      requiredHeaders: MEASUREMENTS_REQUIRED,
      csvHeaders
    });

    // No mapping flow in revisions mode: no plan, no column-count gate.
    expect(result.plan).toBeNull();
    expect(result.columnCountMismatch).toBe(false);
    expect(result.validRows).toHaveLength(1);
    // Raw keys survive; the transform still applies dbh rounding.
    expect(result.validRows[0].dbh).toBe(12.5);
  });

  it('captures invalid-date values in diagnostics', () => {
    const csvHeaders = ['tag', 'spcode', 'quadrat', 'date'];
    const rawRow = { tag: 'T1', spcode: 'abc', quadrat: 'q1', date: 'definitely-not-a-date' };

    const result = resolveMeasurementChunk([rawRow], csvHeaders.length, {
      formType: FormType.measurements,
      uploadMode: 'other',
      delimiter: DEFAULT_DELIMITER,
      requiredHeaders: MEASUREMENTS_REQUIRED,
      csvHeaders
    });

    expect(result.diagnostics.invalidDateValues).toContain('definitely-not-a-date');
  });

  it('counts rows carrying extra columns in diagnostics', () => {
    const csvHeaders = ['tag', 'spcode', 'quadrat'];
    const rawRow = { tag: 'T1', spcode: 'abc', quadrat: 'q1', __parsed_extra: 'leftover' };

    const result = resolveMeasurementChunk([rawRow as Record<string, string>], csvHeaders.length, {
      formType: FormType.measurements,
      uploadMode: 'revisions', // plan-less path keeps __parsed_extra intact for the count
      delimiter: DEFAULT_DELIMITER,
      requiredHeaders: MEASUREMENTS_REQUIRED,
      csvHeaders
    });

    expect(result.diagnostics.extraColumnRows).toBe(1);
  });

  describe('ragged-row rejection on the server mapping path (C1/C3)', () => {
    // On the server-authoritative rawRows path the plan keys parsed rows BY POSITION. papaparse
    // (header:true) breaks positional alignment two ways that the old chunk resolver let through:
    //   - too-many fields  -> a trailing `__parsed_extra` array the plan has no slot for;
    //   - too-few fields   -> the row object simply omits the missing trailing header keys.
    // Both indicate a malformed line and MUST be rejected, never silently keyed/ingested.
    const MAPPING_HEADERS = ['tag', 'spcode', 'quadrat', 'dbh'];

    function resolveOnMappingPath(rawRows: Record<string, unknown>[]) {
      return resolveMeasurementChunk(rawRows as Record<string, string>[], MAPPING_HEADERS.length, {
        formType: FormType.measurements,
        uploadMode: 'other',
        delimiter: DEFAULT_DELIMITER,
        requiredHeaders: MEASUREMENTS_REQUIRED,
        csvHeaders: MAPPING_HEADERS
      });
    }

    it('rejects a too-many-fields row carrying __parsed_extra instead of ingesting a phantom column', () => {
      // papaparse emits the leftover cell as `__parsed_extra: ['leftover']`. The plan has 4 slots;
      // the 5th entry has no output key and previously fell through to normalizeHeader('__parsed_extra')
      // === 'parsedextra', silently injecting an unmapped column into the upload.
      const ragged = { tag: 'T1', spcode: 'abc', quadrat: 'q1', dbh: '12.5', __parsed_extra: ['leftover'] };

      const result = resolveOnMappingPath([ragged]);

      expect(result.validRows).toHaveLength(0);
      expect(result.invalidRows).toHaveLength(1);
      expect(result.invalidRows[0].failureReason).toMatch(/extra|too many columns/i);
      // The phantom column must never survive under ANY key (literal or normalized).
      for (const row of [...result.validRows, ...result.invalidRows]) {
        expect(Object.keys(row)).not.toContain('__parsed_extra');
        expect(Object.keys(row)).not.toContain('parsedextra');
      }
    });

    it('rejects a too-few-fields row whose trailing header keys papaparse omitted', () => {
      // A line with fewer delimited values than headers yields an object missing the trailing keys
      // (a trailing EMPTY value still produces the key, so absent keys reliably mean a malformed line).
      // The omitted column here is the OPTIONAL `dbh`: all required fields are present, so this row
      // would pass validation today — it can only be rejected by genuine too-few-column detection,
      // not by the pre-existing missing-required-field check.
      const tooFew = { tag: 'T1', spcode: 'abc', quadrat: 'q1' };

      const result = resolveOnMappingPath([tooFew]);

      expect(result.validRows).toHaveLength(0);
      expect(result.invalidRows).toHaveLength(1);
      expect(result.invalidRows[0].failureReason).toMatch(/too few columns/i);
    });

    it('rejects only the ragged rows in a mixed chunk and keeps the well-formed one', () => {
      const good = { tag: 'T2', spcode: 'def', quadrat: 'q2', dbh: '8.25' };
      const tooMany = { tag: 'T1', spcode: 'abc', quadrat: 'q1', dbh: '12.5', __parsed_extra: ['junk'] };
      const tooFew = { tag: 'T3', spcode: 'ghi' };

      const result = resolveOnMappingPath([good, tooMany, tooFew]);

      expect(result.validRows).toHaveLength(1);
      expect(result.validRows[0].tag).toBe('T2');
      expect(result.validRows[0].dbh).toBe(8.25);
      expect(result.invalidRows).toHaveLength(2);
      // The well-formed row must not carry any extra-column residue.
      expect(Object.keys(result.validRows[0])).not.toContain('parsedextra');
    });
  });

  describe('ignored/dropped-column diagnostics (M4)', () => {
    it('reports the count of columns the plan dropped (so a mis-mapped column is not silent)', () => {
      // 'lx' is sourced from 'MyX'; the literal 'lx' header is unclaimed and diverted to an inert
      // ignored key, then stripped on collapse. That dropped column must be surfaced as a count.
      const csvHeaders = ['lx', 'MyX', 'tag', 'spcode', 'quadrat', 'ly', 'date'];
      const rawRow = { lx: '9.9', MyX: '12.5', tag: 'T1', spcode: 'abc', quadrat: 'q1', ly: '3.0', date: '2023-05-17' };

      const result = resolveMeasurementChunk([rawRow], csvHeaders.length, {
        formType: FormType.measurements,
        uploadMode: 'other',
        delimiter: DEFAULT_DELIMITER,
        requiredHeaders: MEASUREMENTS_REQUIRED,
        csvHeaders,
        storedMapping: lxRenamedMapping(csvHeaders)
      });

      expect(result.diagnostics.ignoredColumnCount).toBe(1);
    });

    it('reports zero ignored columns when every header resolves cleanly', () => {
      const csvHeaders = ['tag', 'spcode', 'quadrat', 'dbh'];
      const rawRow = { tag: 'T1', spcode: 'abc', quadrat: 'q1', dbh: '12.5' };

      const result = resolveMeasurementChunk([rawRow], csvHeaders.length, {
        formType: FormType.measurements,
        uploadMode: 'other',
        delimiter: DEFAULT_DELIMITER,
        requiredHeaders: MEASUREMENTS_REQUIRED,
        csvHeaders
      });

      expect(result.diagnostics.ignoredColumnCount).toBe(0);
    });
  });

  describe('bad-input rejection through the server path (M1/M2)', () => {
    const HEADERS = ['tag', 'spcode', 'quadrat', 'dbh', 'date'];

    function resolveOnMappingPath(rawRow: Record<string, string>) {
      return resolveMeasurementChunk([rawRow], HEADERS.length, {
        formType: FormType.measurements,
        uploadMode: 'other',
        delimiter: DEFAULT_DELIMITER,
        requiredHeaders: MEASUREMENTS_REQUIRED,
        csvHeaders: HEADERS
      });
    }

    it('rejects a non-numeric dbh instead of ingesting it verbatim', () => {
      const result = resolveOnMappingPath({ tag: 'T1', spcode: 'abc', quadrat: 'q1', dbh: 'oops', date: '2023-05-17' });
      expect(result.validRows).toHaveLength(0);
      expect(result.invalidRows).toHaveLength(1);
      expect(result.invalidRows[0].failureReason).toContain('Non-numeric value for dbh');
    });

    it('rejects an unparseable date instead of inserting the raw string', () => {
      const result = resolveOnMappingPath({ tag: 'T1', spcode: 'abc', quadrat: 'q1', dbh: '12.5', date: 'definitely-not-a-date' });
      expect(result.validRows).toHaveLength(0);
      expect(result.invalidRows).toHaveLength(1);
      expect(result.invalidRows[0].failureReason).toContain('Unparseable date');
      // The diagnostic is still recorded for logging.
      expect(result.diagnostics.invalidDateValues).toContain('definitely-not-a-date');
    });

    it('still accepts a clean row through the same path', () => {
      const result = resolveOnMappingPath({ tag: 'T1', spcode: 'abc', quadrat: 'q1', dbh: '12.5', date: '2023-05-17' });
      expect(result.invalidRows).toHaveLength(0);
      expect(result.validRows).toHaveLength(1);
      expect(result.validRows[0].dbh).toBe(12.5);
      expect(result.validRows[0].date).toBeInstanceOf(Date);
    });
  });

  it('uses RequiredTableHeadersByFormType[measurements] to drive validation', () => {
    const required = RequiredTableHeadersByFormType[FormType.measurements];
    expect(required.length).toBeGreaterThan(0);
    const csvHeaders = required.map(h => h.label);
    const rawRow: Record<string, string> = {};
    // Give each required field a type-valid value: numeric fields need a number, date a real date,
    // everything else a plain token. (A complete, VALID row must be accepted.)
    const valueForField = (label: string): string =>
      ['dbh', 'hom', 'lx', 'ly'].includes(label) ? '1' : label === 'date' ? '2023-05-17' : 'x';
    csvHeaders.forEach(label => (rawRow[label] = valueForField(label)));

    const result = resolveMeasurementChunk([rawRow], csvHeaders.length, {
      formType: FormType.measurements,
      uploadMode: 'revisions',
      delimiter: DEFAULT_DELIMITER,
      requiredHeaders: required,
      csvHeaders
    });

    expect(result.validRows).toHaveLength(1);
  });
});
