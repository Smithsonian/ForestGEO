import {
  CalendarDay,
  type CalendarDayInput,
  calendarDayNumber,
  calendarMonthsBetween,
  compareCalendarDays,
  parseCalendarDay,
  todayCalendarDay
} from '@/config/dateformats';

type DateInput = string | Date | null | undefined;

/**
 * The date fields the census list carries per census row. `startDate`/`endDate` are the
 * legacy fields: the census-list query fills them from the measurement span when the
 * census has data and from the census window otherwise, so on their own they cannot say
 * which one they are. `censusStartDate`/`censusEndDate` are the census window
 * (census.StartDate/EndDate) and `firstMeasurementDate`/`lastMeasurementDate` the
 * observed measurement span; both are null when absent.
 */
export interface CensusDateFields {
  startDate?: DateInput;
  endDate?: DateInput;
  censusStartDate?: DateInput;
  censusEndDate?: DateInput;
  firstMeasurementDate?: DateInput;
  lastMeasurementDate?: DateInput;
}

const NEW_FIELD_KEYS = ['censusStartDate', 'censusEndDate', 'firstMeasurementDate', 'lastMeasurementDate'] as const;

/** True when the row came from a list that distinguishes window from measurements. */
function hasExplicitFields(range: CensusDateFields): boolean {
  return NEW_FIELD_KEYS.some(key => range[key] !== undefined);
}

/**
 * The census window. Rows from an older payload (no explicit window/measurement
 * fields) fall back to startDate/endDate, which is all they carry.
 */
export function getCensusWindow(range: CensusDateFields): { start: DateInput; end: DateInput } {
  if (!hasExplicitFields(range)) return { start: range.startDate, end: range.endDate };
  return { start: range.censusStartDate, end: range.censusEndDate };
}

/**
 * The observed measurement span. A census with no measurements has no span; it never
 * borrows the census window. Rows from an older payload are assumed to carry the
 * measurement span in startDate/endDate (their historical meaning).
 */
export function getMeasurementSpan(range: CensusDateFields): { first: DateInput; last: DateInput } {
  if (!hasExplicitFields(range)) return { first: range.startDate, last: range.endDate };
  return { first: range.firstMeasurementDate, last: range.lastMeasurementDate };
}

function earliest(days: CalendarDay[]): CalendarDay | undefined {
  return days.length ? days.reduce((a, b) => (compareCalendarDays(a, b) <= 0 ? a : b)) : undefined;
}

function latest(days: CalendarDay[]): CalendarDay | undefined {
  return days.length ? days.reduce((a, b) => (compareCalendarDays(a, b) >= 0 ? a : b)) : undefined;
}

function definedDays(values: DateInput[]): CalendarDay[] {
  return values.map(v => parseCalendarDay(v)).filter((d): d is CalendarDay => d !== undefined);
}

/** Earliest window start / latest window end across all of a census' ranges (calendar days). */
export function getCensusWindowBounds(ranges: CensusDateFields[] | undefined): { start?: CalendarDay; end?: CalendarDay; endIsOpen: boolean } {
  const windows = (ranges ?? []).map(getCensusWindow);
  const start = earliest(definedDays(windows.map(w => w.start)));
  const endDays = definedDays(windows.map(w => w.end));
  // A range with a start but no end is still open, even if another range ended.
  const endIsOpen = windows.some(w => parseCalendarDay(w.start) !== undefined && parseCalendarDay(w.end) === undefined);
  // When any range is open the window has no end: a closed range's end must not stand in for it.
  return { start, end: endIsOpen ? undefined : latest(endDays), endIsOpen };
}

/** Earliest first / latest last measurement across a census' ranges (calendar days). */
export function getMeasurementBounds(ranges: CensusDateFields[] | undefined): { first?: CalendarDay; last?: CalendarDay } {
  const spans = (ranges ?? []).map(getMeasurementSpan);
  return { first: earliest(definedDays(spans.map(s => s.first))), last: latest(definedDays(spans.map(s => s.last))) };
}

export type CensusStatus = 'completed' | 'in-progress' | 'planned';

/**
 * Status from the census window only. Planned: no window start, or it is in the future.
 * Completed: every range has an end and the latest end day has passed (the end day
 * itself still counts as in progress). Otherwise in progress.
 */
export function getCensusStatus(ranges: CensusDateFields[] | undefined, today: CalendarDay = todayCalendarDay()): CensusStatus {
  const { start, end, endIsOpen } = getCensusWindowBounds(ranges);
  if (!start || compareCalendarDays(start, today) > 0) return 'planned';
  if (end && !endIsOpen && compareCalendarDays(end, today) < 0) return 'completed';
  return 'in-progress';
}

/** Duration of the census window, or null when it has not started or has no start. */
export function formatCensusWindowDuration(ranges: CensusDateFields[] | undefined, today: CalendarDay = todayCalendarDay()): string | null {
  const { start, end } = getCensusWindowBounds(ranges);
  if (!start || compareCalendarDays(start, today) > 0) return null;
  // An open window (end undefined) is measured up to today.
  const last = end ?? today;
  if (compareCalendarDays(last, start) < 0) return null;

  const months = calendarMonthsBetween(start, last);
  if (months < 1) {
    const days = calendarDayNumber(last) - calendarDayNumber(start);
    return `${days} day${days !== 1 ? 's' : ''}`;
  }
  if (months < 12) return `${months} month${months !== 1 ? 's' : ''}`;
  const years = Math.floor(months / 12);
  const remainingMonths = months % 12;
  return remainingMonths === 0 ? `${years} year${years !== 1 ? 's' : ''}` : `${years}y ${remainingMonths}m`;
}

/** A census window as the edit form and the PATCH payload carry it: calendar days, end optional. */
export interface CensusDates {
  startDate: string;
  endDate: string | null;
}

export const CENSUS_START_DATE_REQUIRED_MESSAGE = 'Start date is required.';
export const CENSUS_END_BEFORE_START_MESSAGE = 'End date cannot be before the start date.';
export const CENSUS_INVALID_DATE_MESSAGE = 'Census dates must be valid YYYY-MM-DD dates between years 1000 and 9999.';
export const CENSUS_DATES_SAVE_FAILURE_MESSAGE = 'Failed to save the census dates. Please try again.';
export const CENSUS_DATES_REFRESH_FAILURE_MESSAGE = 'Census dates saved, but refreshing the census list failed. Reload the page to see the new dates.';

/** True when both days are set and the end day falls before the start day. */
export function isCensusEndBeforeStart(start: CalendarDayInput, end: CalendarDayInput): boolean {
  const startDay = parseCalendarDay(start);
  const endDay = parseCalendarDay(end);
  return startDay !== undefined && endDay !== undefined && compareCalendarDays(endDay, startDay) < 0;
}

/** Accept canonical request strings or database DATE objects, never MySQL's permissive date coercions. */
function isValidCensusDate(value: unknown): value is string | Date {
  if (!(value instanceof Date) && (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))) return false;
  const day = parseCalendarDay(value);
  return day !== undefined && day.year >= 1000 && day.year <= 9999;
}

export function getCensusDatesError(start: unknown, end: unknown): string | null {
  if (start === null || start === undefined || start === '') return CENSUS_START_DATE_REQUIRED_MESSAGE;
  if (!isValidCensusDate(start) || (end !== null && end !== undefined && !isValidCensusDate(end))) return CENSUS_INVALID_DATE_MESSAGE;
  if (isCensusEndBeforeStart(start, end as CalendarDayInput)) return CENSUS_END_BEFORE_START_MESSAGE;
  return null;
}
