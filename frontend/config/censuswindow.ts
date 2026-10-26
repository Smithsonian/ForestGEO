import { CalendarDay, calendarDayNumber, calendarMonthsBetween, compareCalendarDays, parseCalendarDay, todayCalendarDay } from '@/config/dateformats';

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
