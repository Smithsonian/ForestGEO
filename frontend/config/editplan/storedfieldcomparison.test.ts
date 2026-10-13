import { describe, it, expect } from 'vitest';
import { fieldChanged, fieldChangedAtStoredPrecision } from './storedfieldcomparison';

// F31 regression coverage: MeasuredDBH/MeasuredHOM/StemLocalX/StemLocalY are
// DECIMAL(12,6) columns, but PER_COLUMN_DECIMAL_PRECISION rounds them to 2
// for every existing `fieldChanged` caller (analyzer, UI edit detection,
// planhash, revert). `fieldChangedAtStoredPrecision` must diverge from that
// ONLY by comparing numeric fields at the full stored scale — default
// `fieldChanged`/`normalizeForDiff` behavior must stay byte-for-byte
// unchanged for every existing caller.
describe('fieldChanged (default, UI precision) — unchanged by the stored-precision addition', () => {
  it('still treats a sixth-decimal MeasuredDBH difference as UNCHANGED (UI precision is 2, not 6)', () => {
    expect(fieldChanged('MeasuredDBH', 10.0, 10.000001)).toBe(false);
  });
});

describe('fieldChangedAtStoredPrecision', () => {
  it('reports a sixth-decimal MeasuredDBH difference as CHANGED', () => {
    expect(fieldChangedAtStoredPrecision('MeasuredDBH', 10.0, 10.000001)).toBe(true);
  });

  it('treats the mysql2 DECIMAL-string shape ("10.000000") as equal to the plan number 10', () => {
    expect(fieldChangedAtStoredPrecision('MeasuredDBH', 10, '10.000000')).toBe(false);
  });

  it('treats "3.500000" as equal to 3.5', () => {
    expect(fieldChangedAtStoredPrecision('MeasuredDBH', '3.500000', 3.5)).toBe(false);
  });

  it('passes null/undefined through verbatim without numeric coercion', () => {
    expect(fieldChangedAtStoredPrecision('MeasuredDBH', null, null)).toBe(false);
    expect(fieldChangedAtStoredPrecision('MeasuredDBH', undefined, undefined)).toBe(false);
    expect(fieldChangedAtStoredPrecision('MeasuredDBH', null, 10)).toBe(true);
  });

  it('does not numerically coerce a field absent from PER_COLUMN_DECIMAL_PRECISION — exact raw-string semantics', () => {
    expect(fieldChangedAtStoredPrecision('Description', 'NULL', 'null')).toBe(true);
    expect(fieldChangedAtStoredPrecision('Description', 'same', 'same')).toBe(false);
  });

  it('normalizes a date field identically to the default fieldChanged path', () => {
    const fromDate = new Date('2026-01-02T00:00:00.000Z');
    expect(fieldChangedAtStoredPrecision('MeasurementDate', fromDate, '2026-01-02')).toBe(false);
    expect(fieldChangedAtStoredPrecision('MeasurementDate', fromDate, '2026-01-03')).toBe(true);
  });
});
