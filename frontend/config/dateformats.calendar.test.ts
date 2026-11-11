import { describe, expect, it } from 'vitest';
import {
  calendarDayNumber,
  calendarMonthsBetween,
  calendarToDbDate,
  compareCalendarDays,
  dbDateToCalendar,
  formatCalendarDate,
  formatCalendarMonthYear,
  formatInstant,
  MISSING_DATE_PLACEHOLDER,
  parseCalendarDay,
  parseInstant,
  pickerDateToDayString,
  toCalendarDayString,
  todayCalendarDay,
  toSqlUtcDateTime
} from './dateformats';

// These tests assert behaviour that must hold in every browser zone. The zone itself is
// chosen by the process (run the file under TZ=UTC, TZ=America/Los_Angeles and
// TZ=Pacific/Auckland); nothing here mutates process.env.TZ, so no state leaks across files.
const ZONES = ['UTC', 'America/Los_Angeles', 'Pacific/Auckland'] as const;

describe('calendar-day parsing and formatting (SQL DATE)', () => {
  it('keeps 2027-01-01 in January for a UTC-midnight ISO string', () => {
    expect(formatCalendarMonthYear('2027-01-01T00:00:00.000Z')).toBe('Jan 2027');
    expect(toCalendarDayString('2027-01-01T00:00:00.000Z')).toBe('2027-01-01');
  });

  it('keeps 2027-02-15 as Feb 15 for ISO and date-only strings and database Dates', () => {
    expect(formatCalendarDate('2027-02-15T00:00:00.000Z')).toBe('Feb 15, 2027');
    expect(formatCalendarDate('2027-02-15')).toBe('Feb 15, 2027');
    expect(formatCalendarDate(new Date(Date.UTC(2027, 1, 15)))).toBe('Feb 15, 2027');
    expect(toCalendarDayString(new Date(Date.UTC(2027, 1, 15)))).toBe('2027-02-15');
  });

  it('reads the encoded day even when the ISO string carries an offset', () => {
    expect(toCalendarDayString('2027-02-15T00:00:00-08:00')).toBe('2027-02-15');
  });

  it('returns the placeholder / null for null, undefined, empty and invalid input', () => {
    for (const bad of [null, undefined, '', 'not a date', '2027-02-30', '2027-13-01', new Date(Number.NaN)]) {
      expect(parseCalendarDay(bad as any)).toBeUndefined();
      expect(toCalendarDayString(bad as any)).toBeNull();
      expect(formatCalendarDate(bad as any)).toBe(MISSING_DATE_PLACEHOLDER);
      expect(formatCalendarMonthYear(bad as any)).toBe(MISSING_DATE_PLACEHOLDER);
      expect(dbDateToCalendar(bad as any)).toBeNull();
    }
  });

  it('accepts leap days only in leap years', () => {
    expect(toCalendarDayString('2028-02-29')).toBe('2028-02-29');
    expect(toCalendarDayString('2027-02-29')).toBeNull();
  });
});

describe('picker <-> database boundary', () => {
  it('turns a database DATE into a local-midnight picker date with the same calendar day', () => {
    const picker = dbDateToCalendar('2027-02-15T00:00:00.000Z')!;
    expect([picker.getFullYear(), picker.getMonth(), picker.getDate(), picker.getHours()]).toEqual([2027, 1, 15, 0]);
  });

  it('turns a picker date into UTC midnight of the same calendar day', () => {
    const db = calendarToDbDate(new Date(2027, 1, 15))!;
    expect(db.toISOString()).toBe('2027-02-15T00:00:00.000Z');
  });

  it('round-trips a picker selection to the same calendar day (including DST-boundary days)', () => {
    // 2027-03-14 is the US spring-forward day; 2027-09-26 is the NZ spring-forward day.
    for (const day of ['2027-01-01', '2027-02-15', '2027-03-14', '2027-03-28', '2027-09-26', '2027-11-07', '2028-02-29']) {
      const picker = dbDateToCalendar(day)!;
      expect(pickerDateToDayString(picker)).toBe(day);
      const db = calendarToDbDate(picker)!;
      expect(db.toISOString().slice(0, 10)).toBe(day);
      expect(toCalendarDayString(db)).toBe(day);
    }
  });

  it('returns null for missing picker input', () => {
    expect(calendarToDbDate(null)).toBeNull();
    expect(calendarToDbDate(new Date(Number.NaN))).toBeNull();
    expect(pickerDateToDayString(null)).toBeNull();
    expect(pickerDateToDayString(new Date(Number.NaN))).toBeNull();
  });
});

describe('calendar arithmetic', () => {
  it('counts calendar days across DST changes without drift', () => {
    const a = parseCalendarDay('2027-03-13')!;
    const b = parseCalendarDay('2027-03-15')!;
    expect(calendarDayNumber(b) - calendarDayNumber(a)).toBe(2);
    expect(compareCalendarDays(a, b)).toBeLessThan(0);
    expect(compareCalendarDays(b, b)).toBe(0);
  });

  it('counts whole months like moment diff', () => {
    expect(calendarMonthsBetween(parseCalendarDay('2027-01-31')!, parseCalendarDay('2027-02-28')!)).toBe(0);
    expect(calendarMonthsBetween(parseCalendarDay('2027-01-01')!, parseCalendarDay('2027-12-31')!)).toBe(11);
    expect(calendarMonthsBetween(parseCalendarDay('2026-01-01')!, parseCalendarDay('2028-01-01')!)).toBe(24);
  });

  it('derives "today" in an explicit zone', () => {
    // 2027-01-01T03:00Z is still Dec 31 in Los Angeles and already Jan 1 in Auckland and UTC.
    const instant = new Date('2027-01-01T03:00:00Z');
    expect(todayCalendarDay(instant, 'America/Los_Angeles')).toEqual({ year: 2026, month: 12, day: 31 });
    expect(todayCalendarDay(instant, 'UTC')).toEqual({ year: 2027, month: 1, day: 1 });
    expect(todayCalendarDay(instant, 'Pacific/Auckland')).toEqual({ year: 2027, month: 1, day: 1 });
  });
});

describe('instants (DATETIME / TIMESTAMP)', () => {
  it('reads a zone-less SQL datetime as UTC, not browser-local', () => {
    expect(parseInstant('2026-10-20 15:30:00')!.toISOString()).toBe('2026-10-20T15:30:00.000Z');
    expect(parseInstant('2026-10-20T15:30:00')!.toISOString()).toBe('2026-10-20T15:30:00.000Z');
    expect(parseInstant('2026-10-20 15:30:00.250')!.toISOString()).toBe('2026-10-20T15:30:00.250Z');
  });

  it('does not shift an already-zoned ISO string (Z or numeric offset)', () => {
    expect(parseInstant('2026-10-20T15:30:00.000Z')!.toISOString()).toBe('2026-10-20T15:30:00.000Z');
    expect(parseInstant('2026-10-20T08:30:00-07:00')!.toISOString()).toBe('2026-10-20T15:30:00.000Z');
    expect(parseInstant('2026-10-21T03:30:00+12:00')!.toISOString()).toBe('2026-10-20T15:30:00.000Z');
  });

  it('formats the same instant once per viewer zone', () => {
    const iso = '2026-10-20T15:30:00.000Z';
    expect(formatInstant(iso, 'UTC')).toBe('Oct 20, 2026, 3:30 PM');
    expect(formatInstant(iso, 'America/Los_Angeles')).toBe('Oct 20, 2026, 8:30 AM');
    expect(formatInstant(iso, 'Pacific/Auckland')).toBe('Oct 21, 2026, 4:30 AM');
    // The naive DB text is the same instant, so it renders identically.
    expect(formatInstant('2026-10-20 15:30:00', 'America/Los_Angeles')).toBe('Oct 20, 2026, 8:30 AM');
  });

  it('applies the zone offset in effect on that date across a DST boundary', () => {
    // LA moved from PDT (-7) to PST (-8) on 2026-11-01.
    expect(formatInstant('2026-10-31T20:00:00Z', 'America/Los_Angeles')).toBe('Oct 31, 2026, 1:00 PM');
    expect(formatInstant('2026-11-01T20:00:00Z', 'America/Los_Angeles')).toBe('Nov 1, 2026, 12:00 PM');
  });

  it('returns null for null, undefined, empty and invalid input', () => {
    for (const bad of [null, undefined, '', 'garbage', new Date(Number.NaN)]) {
      expect(parseInstant(bad as any)).toBeUndefined();
      expect(formatInstant(bad as any, 'UTC')).toBeNull();
    }
  });

  it('writes UTC wall-clock text regardless of the process zone', () => {
    expect(toSqlUtcDateTime(new Date('2025-01-02T03:04:05.678Z'))).toBe('2025-01-02 03:04:05');
  });
});

describe('zone matrix', () => {
  it.each(ZONES)('formats one calendar day and one instant independently of the viewer zone (%s)', zone => {
    expect(formatCalendarDate('2027-02-15T00:00:00.000Z')).toBe('Feb 15, 2027');
    expect(formatInstant('2027-02-15T00:00:00.000Z', zone)).not.toBeNull();
  });
});
