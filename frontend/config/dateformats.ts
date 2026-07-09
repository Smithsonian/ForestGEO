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
