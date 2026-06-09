import { describe, it, expect } from 'vitest';
import { excelSerialToISODate } from './excel-date';
import { UnparseableDateError } from './errors';

describe('excelSerialToISODate', () => {
  it('maps the Excel epoch boundary (serial 2 -> 1900-01-01)', () => {
    expect(excelSerialToISODate(2)).toBe('1900-01-01');
  });

  it('converts a modern census serial to its calendar date', () => {
    expect(excelSerialToISODate(46036)).toBe('2026-01-14');
  });

  it('truncates fractional time-of-day to the date', () => {
    expect(excelSerialToISODate(46036.86)).toBe('2026-01-14');
  });

  it('accepts numeric strings', () => {
    expect(excelSerialToISODate('46036')).toBe('2026-01-14');
  });

  it('accepts Date objects', () => {
    expect(excelSerialToISODate(new Date(Date.UTC(2026, 0, 14, 18, 30)))).toBe('2026-01-14');
  });

  it('accepts ISO date strings', () => {
    expect(excelSerialToISODate('2026-01-14T18:30:00.000Z')).toBe('2026-01-14');
  });

  it.each([null, undefined, '', 'NA', 'not-a-number', Number.POSITIVE_INFINITY])('throws UnparseableDateError on %p', input => {
    expect(() => excelSerialToISODate(input as unknown)).toThrow(UnparseableDateError);
  });

  it('rejects bare-year numeric text instead of reading it as a 1900s serial', () => {
    expect(() => excelSerialToISODate('2026')).toThrow(UnparseableDateError);
  });

  it('rejects a small bare-number string below the plausible serial floor', () => {
    expect(() => excelSerialToISODate('100')).toThrow(UnparseableDateError);
  });

  it('still accepts a real census serial supplied as numeric text', () => {
    expect(excelSerialToISODate('46036')).toBe('2026-01-14');
  });

  it('rejects decimal-year text below the plausible serial floor', () => {
    expect(() => excelSerialToISODate('2026.5')).toThrow(UnparseableDateError);
  });

  it('rejects negative-number text below the plausible serial floor', () => {
    expect(() => excelSerialToISODate('-50')).toThrow(UnparseableDateError);
  });
});
