import { describe, it, expect } from 'vitest';
import { formatDisplayDate, MISSING_DATE_PLACEHOLDER } from './dateformats';

describe('formatDisplayDate', () => {
  it('formats a Date instance as "MMM D, YYYY"', () => {
    // Local-time constructor keeps this timezone-stable across CI runners.
    expect(formatDisplayDate(new Date(2008, 1, 2))).toBe('Feb 2, 2008');
  });

  it('formats a date-only ISO string as a calendar date without timezone rollover', () => {
    expect(formatDisplayDate('2008-02-02')).toBe('Feb 2, 2008');
  });

  it('formats a midnight-UTC ISO string as the encoded calendar date', () => {
    expect(formatDisplayDate('2008-02-02T00:00:00.000Z')).toBe('Feb 2, 2008');
  });

  it('formats an ISO date string with an explicit local time as "MMM D, YYYY"', () => {
    expect(formatDisplayDate('2008-02-02T12:00:00')).toBe('Feb 2, 2008');
  });

  it('returns the missing-date placeholder for null', () => {
    expect(formatDisplayDate(null)).toBe(MISSING_DATE_PLACEHOLDER);
  });

  it('returns the missing-date placeholder for undefined', () => {
    expect(formatDisplayDate(undefined)).toBe(MISSING_DATE_PLACEHOLDER);
  });

  it('returns the missing-date placeholder for an empty string', () => {
    expect(formatDisplayDate('')).toBe(MISSING_DATE_PLACEHOLDER);
  });

  it('returns the missing-date placeholder for an unparseable string', () => {
    expect(formatDisplayDate('not-a-date')).toBe(MISSING_DATE_PLACEHOLDER);
  });

  it('returns the missing-date placeholder for an impossible ISO calendar date', () => {
    expect(formatDisplayDate('2025-02-31')).toBe(MISSING_DATE_PLACEHOLDER);
  });

  it('returns the missing-date placeholder for an invalid Date instance', () => {
    expect(formatDisplayDate(new Date('garbage'))).toBe(MISSING_DATE_PLACEHOLDER);
  });

  it('exposes an em-dash as the missing-date placeholder', () => {
    expect(MISSING_DATE_PLACEHOLDER).toBe('—');
  });
});
