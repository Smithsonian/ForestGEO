import { UnparseableDateError } from './errors';

// Excel's day-0 is 1899-12-30. Census dates are modern, so the 1900 leap-year bug
// (which only affects serials < 60) is out of scope.
const EXCEL_EPOCH_UTC_MS = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function excelSerialToISODate(serial: unknown): string {
  const isBlank = serial === null || serial === undefined || (typeof serial === 'string' && serial.trim() === '');

  if (isBlank) {
    throw new UnparseableDateError(`Date_measured is not an Excel serial number: ${JSON.stringify(serial)}`);
  }

  const numeric = typeof serial === 'number' ? serial : Number(serial);

  if (Number.isNaN(numeric)) {
    throw new UnparseableDateError(`Date_measured is not an Excel serial number: ${JSON.stringify(serial)}`);
  }

  const wholeDays = Math.floor(numeric);
  const utcMs = EXCEL_EPOCH_UTC_MS + wholeDays * MS_PER_DAY;
  const date = new Date(utcMs);

  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
