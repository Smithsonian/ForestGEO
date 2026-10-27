import { calendarToDbDate, dbDateToCalendar, pickerDateToDayString, toCalendarDayString } from '@/config/dateformats';

// MeasurementDate is a SQL DATE. Rows hold the database shape: a UTC-midnight Date, or its
// ISO / "YYYY-MM-DD" string. The MUI date editor holds a local-midnight "picker" Date. These
// helpers are the only crossing between the two, so a picked calendar day is the day that is
// shown, diffed against the original row, previewed and saved - in any browser zone.

/** Row value -> value the grid's date editor works with (local midnight of the same day). */
export function measurementDateValueGetter(value: unknown): Date | null {
  return dbDateToCalendar(value as string | Date | null | undefined);
}

/**
 * Editor value -> row value. Returns the database shape (UTC midnight of the picked day) so
 * the edit-plan diff and the server's toISOString().slice(0, 10) both see the picked day.
 * An invalid or cleared editor value is stored as null.
 */
export function measurementDateValueSetter<Row extends Record<string, unknown>>(value: unknown, row: Row): Row {
  const picked = value instanceof Date ? calendarToDbDate(value) : null;
  return { ...row, measurementDate: picked };
}

/**
 * Cell text. MUI passes the valueFormatter the value-getter output, i.e. a picker Date
 * (local midnight), which is read by local fields; a raw database string is read by its
 * encoded day. Neither goes through the browser zone conversion.
 */
export function formatMeasurementDateCell(value: unknown): string {
  if (value instanceof Date) return pickerDateToDayString(value) ?? '';
  return toCalendarDayString(value as string | null | undefined) ?? '';
}

/** CSV export cell for MeasurementDate: the stored calendar day, or NULL when missing/invalid. */
export function formatMeasurementDateForCsv(value: unknown): string {
  return toCalendarDayString(value as string | Date | null | undefined) ?? 'NULL';
}

/**
 * Value posted for a new row. Accepts either row shape (database string / UTC-midnight Date,
 * as produced by measurementDateValueSetter). Returns "YYYY-MM-DD" or undefined when missing.
 */
export function measurementDateToSaveString(value: unknown): string | undefined {
  return toCalendarDayString(value as string | Date | null | undefined) ?? undefined;
}
