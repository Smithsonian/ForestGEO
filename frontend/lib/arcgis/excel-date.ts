import { UnparseableDateError } from './errors';

// Excel's day-0 is 1899-12-30. Census dates are modern, so the 1900 leap-year bug
// (which only affects serials < 60) is out of scope.
const EXCEL_EPOCH_UTC_MS = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function toISODate(date: Date): string {
  if (!Number.isFinite(date.getTime())) {
    throw new UnparseableDateError(`Date_measured is not a valid date: ${JSON.stringify(date)}`);
  }
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function excelNumericToISODate(numeric: number, original: unknown): string {
  if (!Number.isFinite(numeric)) {
    throw new UnparseableDateError(`Date_measured is not a finite Excel serial number: ${JSON.stringify(original)}`);
  }

  const wholeDays = Math.floor(numeric);
  const utcMs = EXCEL_EPOCH_UTC_MS + wholeDays * MS_PER_DAY;
  return toISODate(new Date(utcMs));
}

export function excelSerialToISODate(serial: unknown): string {
  const isBlank = serial === null || serial === undefined || (typeof serial === 'string' && serial.trim() === '');
  if (isBlank) {
    throw new UnparseableDateError(`Date_measured is not an Excel serial number or date: ${JSON.stringify(serial)}`);
  }

  if (serial instanceof Date) {
    return toISODate(serial);
  }

  if (typeof serial === 'number') {
    return excelNumericToISODate(serial, serial);
  }

  if (typeof serial === 'string') {
    const trimmed = serial.trim();
    const numeric = Number(trimmed);
    if (trimmed !== '' && Number.isFinite(numeric)) {
      return excelNumericToISODate(numeric, serial);
    }

    const isoDate = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
    if (isoDate) {
      return `${isoDate[1]}-${isoDate[2]}-${isoDate[3]}`;
    }

    const parsed = Date.parse(trimmed);
    if (Number.isFinite(parsed)) {
      return toISODate(new Date(parsed));
    }
  }

  throw new UnparseableDateError(`Date_measured is not an Excel serial number or date: ${JSON.stringify(serial)}`);
}
