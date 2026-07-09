const DISPLAY_DATE = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

export const MISSING_DATE_PLACEHOLDER = '—';

// Caveat: a date-only string like '2008-02-02' parses as UTC midnight and renders the
// previous day in western timezones — pass Date objects or full datetimes instead.
export function formatDisplayDate(input: string | Date | null | undefined): string {
  if (input === null || input === undefined || input === '') return MISSING_DATE_PLACEHOLDER;
  const date = input instanceof Date ? input : new Date(input);
  return Number.isNaN(date.getTime()) ? MISSING_DATE_PLACEHOLDER : DISPLAY_DATE.format(date);
}
