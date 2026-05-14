import Papa from 'papaparse';
import type { QuadratCsvRow } from './types';

export interface CsvParseError {
  rowNumber: number;
  message: string;
}

export interface CsvParseResult {
  rows: QuadratCsvRow[];
  errors: CsvParseError[];
}

const REQUIRED_HEADERS = ['quadratname', 'startx', 'starty', 'dimensionx', 'dimensiony'] as const;
const UTF8_BOM = '﻿';

export function parseQuadratCsv(content: string): CsvParseResult {
  const stripped = content.startsWith(UTF8_BOM) ? content.slice(1) : content;
  if (!stripped.trim()) {
    return { rows: [], errors: [{ rowNumber: 1, message: 'CSV is empty or missing data rows' }] };
  }

  const parsed = Papa.parse<Record<string, string>>(stripped, {
    header: true,
    skipEmptyLines: true,
    transformHeader: h => h.trim().toLowerCase()
  });

  for (const expected of REQUIRED_HEADERS) {
    if (!parsed.meta.fields?.includes(expected)) {
      return { rows: [], errors: [{ rowNumber: 1, message: `Missing required column: ${expected}` }] };
    }
  }

  if (!parsed.data.length) {
    return { rows: [], errors: [{ rowNumber: 1, message: 'CSV is empty or missing data rows' }] };
  }

  const rows: QuadratCsvRow[] = [];
  const errors: CsvParseError[] = [];

  for (const parseErr of parsed.errors) {
    const rowNumber = (parseErr.row ?? 0) + 2;
    errors.push({ rowNumber, message: parseErr.message });
  }

  parsed.data.forEach((rec, i) => {
    const rowNumber = i + 2;
    const row: QuadratCsvRow = {
      quadratName: (rec.quadratname ?? '').trim(),
      startX: Number(String(rec.startx ?? '').trim()),
      startY: Number(String(rec.starty ?? '').trim()),
      dimensionX: Number(String(rec.dimensionx ?? '').trim()),
      dimensionY: Number(String(rec.dimensiony ?? '').trim())
    };
    if (!row.quadratName) {
      errors.push({ rowNumber, message: 'Missing quadratName' });
      return;
    }
    if ([row.startX, row.startY, row.dimensionX, row.dimensionY].some(v => !Number.isFinite(v))) {
      errors.push({ rowNumber, message: 'Non-numeric value in coordinate or dimension field' });
      return;
    }
    if (row.dimensionX <= 0 || row.dimensionY <= 0) {
      errors.push({ rowNumber, message: 'Dimension must be positive' });
      return;
    }
    rows.push(row);
  });

  return { rows, errors };
}
