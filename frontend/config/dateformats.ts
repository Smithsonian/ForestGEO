const DISPLAY_DATE = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

export const MISSING_DATE_PLACEHOLDER = '—';

const ISO_DATE_PREFIX = /^(\d{4})-(\d{2})-(\d{2})/;

function dateFromIsoDatePrefix(input: string): Date | undefined {
  const match = ISO_DATE_PREFIX.exec(input);
  if (!match) return undefined;

  const [, year, month, day] = match;
  const yearNumber = Number(year);
  const monthNumber = Number(month);
  const dayNumber = Number(day);
  const date = new Date(yearNumber, monthNumber - 1, dayNumber);

  if (Number.isNaN(date.getTime()) || date.getFullYear() !== yearNumber || date.getMonth() !== monthNumber - 1 || date.getDate() !== dayNumber) {
    return new Date(Number.NaN);
  }

  return date;
}

export function formatDisplayDate(input: string | Date | null | undefined): string {
  if (input === null || input === undefined || input === '') return MISSING_DATE_PLACEHOLDER;
  const date = input instanceof Date ? input : (dateFromIsoDatePrefix(input) ?? new Date(input));
  return Number.isNaN(date.getTime()) ? MISSING_DATE_PLACEHOLDER : DISPLAY_DATE.format(date);
}

// ---------------------------------------------------------------------------
// Calendar dates (SQL DATE) vs instants (DATETIME/TIMESTAMP)
//
// The mysql2 pool runs with timezone 'Z', so a SQL DATE column reaches the browser
// as "YYYY-MM-DD" or as an ISO string at UTC midnight ("2027-01-01T00:00:00.000Z").
// Converting that through the browser's zone (moment(x), new Date(x).getMonth())
// shifts it to the previous day for any zone west of UTC. A DATE has no zone, so the
// calendar day is read straight from the string; an instant keeps its zone and is
// converted to the viewer's zone exactly once, at display time.
//
// Two JS representations of a calendar day are used and must not be mixed:
//  - "picker" Date: local midnight of the day (what a date picker / MUI date editor
//    reads and writes), and
//  - "database" Date: UTC midnight of the day (what mysql2 decodes a DATE into).
// dbDateToCalendar / calendarToDbDate are the explicit boundary between the two.
// ---------------------------------------------------------------------------

export interface CalendarDay {
  year: number;
  month: number; // 1-12
  day: number;
}

export type CalendarDayInput = string | Date | CalendarDay | null | undefined;

function utcMidnight(year: number, month: number, day: number): Date {
  const date = new Date(Date.UTC(2000, month - 1, day));
  date.setUTCFullYear(year);
  return date;
}

function isValidCalendarDay(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  const probe = utcMidnight(year, month, day);
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

/**
 * Reads the calendar day out of a SQL DATE value. Strings use their leading
 * "YYYY-MM-DD" (so a UTC-midnight ISO string keeps the encoded day in every browser
 * zone). Date instances are treated as database dates (UTC midnight) and read with
 * UTC getters. Returns undefined for null, empty, or invalid input.
 */
export function parseCalendarDay(input: CalendarDayInput): CalendarDay | undefined {
  if (input === null || input === undefined || input === '') return undefined;
  if (typeof input === 'object' && !(input instanceof Date)) {
    return isValidCalendarDay(input.year, input.month, input.day) ? { year: input.year, month: input.month, day: input.day } : undefined;
  }
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return undefined;
    return { year: input.getUTCFullYear(), month: input.getUTCMonth() + 1, day: input.getUTCDate() };
  }
  const match = ISO_DATE_PREFIX.exec(String(input));
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return isValidCalendarDay(year, month, day) ? { year, month, day } : undefined;
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

/** "YYYY-MM-DD" for a SQL DATE value, or null when missing/invalid. */
export function toCalendarDayString(input: CalendarDayInput): string | null {
  const parts = parseCalendarDay(input);
  return parts ? `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}` : null;
}

/** "YYYY-MM-DD" from the LOCAL fields of a picker Date, or null when invalid. */
export function pickerDateToDayString(date: Date | null | undefined): string | null {
  if (!date || Number.isNaN(date.getTime())) return null;
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Database DATE value -> picker Date (local midnight of the same calendar day). */
export function dbDateToCalendar(input: CalendarDayInput): Date | null {
  const parts = parseCalendarDay(input);
  if (!parts) return null;
  const date = new Date(2000, parts.month - 1, parts.day);
  date.setFullYear(parts.year);
  return date;
}

/** Picker Date (local fields) -> database Date (UTC midnight of the same calendar day). */
export function calendarToDbDate(date: Date | null | undefined): Date | null {
  if (!date || Number.isNaN(date.getTime())) return null;
  return utcMidnight(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

/** Whole calendar days since 1970-01-01 (zone independent). */
export function calendarDayNumber(parts: CalendarDay): number {
  return Math.round(utcMidnight(parts.year, parts.month, parts.day).getTime() / 86_400_000);
}

/** Compares two calendar days: negative when a is earlier, 0 when equal, positive when later. */
export function compareCalendarDays(a: CalendarDay, b: CalendarDay): number {
  return calendarDayNumber(a) - calendarDayNumber(b);
}

/** The current calendar day in the viewer's zone (or an explicit IANA zone). */
export function todayCalendarDay(now: Date = new Date(), timeZone?: string): CalendarDay {
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' });
  const parts = formatter.formatToParts(now);
  const pick = (type: string) => Number(parts.find(p => p.type === type)?.value);
  return { year: pick('year'), month: pick('month'), day: pick('day') };
}

/** Whole months between two calendar days (floor, like moment().diff(..., 'months')). */
export function calendarMonthsBetween(from: CalendarDay, to: CalendarDay): number {
  const months = (to.year - from.year) * 12 + (to.month - from.month);
  return to.day < from.day ? months - 1 : months;
}

const MONTH_YEAR_UTC = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', timeZone: 'UTC' });

/** "Jan 2027" for a SQL DATE value; placeholder when missing/invalid. */
export function formatCalendarMonthYear(input: CalendarDayInput): string {
  const parts = parseCalendarDay(input);
  if (!parts) return MISSING_DATE_PLACEHOLDER;
  return MONTH_YEAR_UTC.format(utcMidnight(parts.year, parts.month, 1));
}

/** "Feb 15, 2027" for a SQL DATE value (calendar day, never zone shifted). */
export function formatCalendarDate(input: CalendarDayInput): string {
  const parts = parseCalendarDay(input);
  if (!parts) return MISSING_DATE_PLACEHOLDER;
  return DISPLAY_DATE_UTC.format(utcMidnight(parts.year, parts.month, parts.day));
}

const DISPLAY_DATE_UTC = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });

const NAIVE_SQL_DATETIME = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?$/;

/**
 * Parses an instant. Zoned ISO strings ("...Z", "...+02:00") and Date instances are
 * taken as-is. A zone-less "YYYY-MM-DD HH:mm:ss" string (how MySQL DATETIME text and
 * older rows look) is UTC by convention - the pool is UTC and writers use UTC - so it
 * is read as UTC rather than the browser zone. Returns undefined for invalid input.
 */
export function parseInstant(input: string | Date | null | undefined): Date | undefined {
  if (input === null || input === undefined || input === '') return undefined;
  if (input instanceof Date) return Number.isNaN(input.getTime()) ? undefined : input;
  const text = String(input).trim();
  const naive = NAIVE_SQL_DATETIME.exec(text);
  let date: Date;
  if (naive) {
    const [, y, mo, d, h, mi, s, frac] = naive;
    const millis = frac ? Math.round(Number(`0.${frac}`) * 1000) : 0;
    date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? 0), millis));
  } else {
    date = new Date(text);
  }
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** "Oct 20, 2026, 3:45 PM" in the viewer's zone (or an explicit IANA zone); null if invalid. */
export function formatInstant(input: string | Date | null | undefined, timeZone?: string): string | null {
  const date = parseInstant(input);
  if (!date) return null;
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(date);
  // Newer ICU versions use a narrow no-break space before AM/PM.
  return formatted.replace(/[  ]/g, ' ');
}

/** UTC wall-clock "YYYY-MM-DD HH:mm:ss" for writing an instant to a DATETIME column. */
export function toSqlUtcDateTime(date: Date = new Date()): string {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}
