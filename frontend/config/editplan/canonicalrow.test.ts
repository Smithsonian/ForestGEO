import { describe, it, expect } from 'vitest';
import { canonicalizeRowForHash } from './canonicalrow';

describe('canonicalizeRowForHash', () => {
  describe('revision-update mode', () => {
    it('keeps only updatable fields and drops identity keys', () => {
      const out = canonicalizeRowForHash(
        { dbh: '10', tag: 'T1', spcode: 'ABC', codes: 'M' },
        'revision-update'
      );
      expect(out).toEqual({ MeasuredDBH: 10, Attributes: 'M' });
      expect(out).not.toHaveProperty('TreeTag');
      expect(out).not.toHaveProperty('SpeciesCode');
    });
    it('accepts canonical keys as input', () => {
      const out = canonicalizeRowForHash({ MeasuredDBH: 10, Attributes: 'M' }, 'revision-update');
      expect(out).toEqual({ MeasuredDBH: 10, Attributes: 'M' });
    });
  });

  describe('revision-insert mode', () => {
    it('keeps updatable + identity fields', () => {
      const out = canonicalizeRowForHash(
        { tag: 'T1', stemtag: 'S1', spcode: 'abc', quadrat: 'Q1', lx: '1.23456', ly: '2', dbh: '10', date: '2026-04-22' },
        'revision-insert'
      );
      expect(out.TreeTag).toBe('T1');
      expect(out.StemTag).toBe('S1');
      expect(out.SpeciesCode).toBe('abc');
      expect(out.QuadratName).toBe('Q1');
      expect(out.StemLocalX).toBe(1.23); // precision-2 rounds 1.23456 → 1.23
      expect(out.StemLocalY).toBe(2);
      expect(out.MeasuredDBH).toBe(10);
      expect(out.MeasurementDate).toBe('2026-04-22');
    });

    it('excludes identity fields when only update-surface fields are supplied', () => {
      const out = canonicalizeRowForHash({ dbh: '5', hom: '1.3' }, 'revision-insert');
      expect(out).toEqual({ MeasuredDBH: 5, MeasuredHOM: 1.3 });
      expect(out).not.toHaveProperty('TreeTag');
    });
  });

  describe('normalization', () => {
    it('trims strings', () => {
      const out = canonicalizeRowForHash({ comments: '  hello  ' }, 'revision-update');
      expect(out.Description).toBe('hello');
    });

    it('collapses empty string to null', () => {
      const out = canonicalizeRowForHash({ comments: '' }, 'revision-update');
      expect(out.Description).toBeNull();
    });

    it("collapses 'NULL' placeholder (case-insensitive) to null", () => {
      const upper = canonicalizeRowForHash({ comments: 'NULL' }, 'revision-update');
      const lower = canonicalizeRowForHash({ comments: 'null' }, 'revision-update');
      const mixed = canonicalizeRowForHash({ comments: 'Null' }, 'revision-update');
      expect(upper.Description).toBeNull();
      expect(lower.Description).toBeNull();
      expect(mixed.Description).toBeNull();
    });

    it('coerces ISO datetime strings to YYYY-MM-DD', () => {
      const out = canonicalizeRowForHash({ date: '2026-04-22T00:00:00.000Z' }, 'revision-update');
      expect(out.MeasurementDate).toBe('2026-04-22');
    });

    it('passes through already-normalized YYYY-MM-DD dates unchanged', () => {
      const out = canonicalizeRowForHash({ date: '2026-04-22' }, 'revision-update');
      expect(out.MeasurementDate).toBe('2026-04-22');
    });

    it('rounds decimals per PER_COLUMN_DECIMAL_PRECISION', () => {
      const out = canonicalizeRowForHash({ dbh: '1.23456789' }, 'revision-update');
      expect(typeof out.MeasuredDBH).toBe('number');
      expect(Number.isFinite(out.MeasuredDBH as number)).toBe(true);
      // PER_COLUMN_DECIMAL_PRECISION for MeasuredDBH is 2
      expect(out.MeasuredDBH).toBe(1.23);
    });

    it('rounds StemLocalX and StemLocalY to their precision', () => {
      const out = canonicalizeRowForHash({ lx: '3.14159', ly: '2.71828' }, 'revision-insert');
      expect(out.StemLocalX).toBe(3.14);
      expect(out.StemLocalY).toBe(2.72);
    });

    it('drops unknown keys', () => {
      const out = canonicalizeRowForHash({ dbh: '10', bogus: 'x', RowNumber: '99' }, 'revision-update');
      expect(out).not.toHaveProperty('bogus');
      expect(out).not.toHaveProperty('RowNumber');
    });

    it('is idempotent', () => {
      const first = canonicalizeRowForHash({ dbh: '10', comments: '  note ' }, 'revision-update');
      const second = canonicalizeRowForHash(first, 'revision-update');
      expect(second).toEqual(first);
    });

    it('is idempotent for revision-insert mode', () => {
      const first = canonicalizeRowForHash(
        { tag: 'T1', stemtag: 'S1', spcode: 'abc', lx: '1.23456', dbh: '9.9999', date: '2026-04-22T00:00:00Z' },
        'revision-insert'
      );
      const second = canonicalizeRowForHash(first, 'revision-insert');
      expect(second).toEqual(first);
    });

    it('produces null for date that is NULL placeholder', () => {
      const out = canonicalizeRowForHash({ date: 'NULL' }, 'revision-update');
      expect(out.MeasurementDate).toBeNull();
    });

    it('passes unparseable date strings through unchanged', () => {
      // Intentional hash-parity with the apply-path write (normalizeDateForSQL in
      // apply/route.ts), which also falls through to the raw string for NaN dates
      // rather than coercing to null. Changing this to null would silently break
      // hash comparison between the plan and the applied record.
      const out = canonicalizeRowForHash({ date: 'not-a-date' }, 'revision-update');
      expect(out.MeasurementDate).toBe('not-a-date');
    });

    it('accepts numeric values directly without string conversion', () => {
      const out = canonicalizeRowForHash({ MeasuredDBH: 12.5 }, 'revision-update');
      expect(out.MeasuredDBH).toBe(12.5);
    });
  });
});
