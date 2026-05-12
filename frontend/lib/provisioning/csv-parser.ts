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

export function parseQuadratCsv(content: string): CsvParseResult {
  const lines = content.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) {
    return { rows: [], errors: [{ rowNumber: 0, message: 'CSV is empty or missing data rows' }] };
  }

  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
  for (const expected of REQUIRED_HEADERS) {
    if (!headers.includes(expected)) {
      return { rows: [], errors: [{ rowNumber: 1, message: `Missing required column: ${expected}` }] };
    }
  }

  const idx = Object.fromEntries(headers.map((h, i) => [h, i]));
  const rows: QuadratCsvRow[] = [];
  const errors: CsvParseError[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',').map(c => c.trim());
    const get = (k: string) => cells[idx[k]];
    const num = (k: string) => Number(get(k));
    const row: QuadratCsvRow = {
      quadratName: get('quadratname'),
      startX: num('startx'),
      startY: num('starty'),
      dimensionX: num('dimensionx'),
      dimensionY: num('dimensiony')
    };
    if (!row.quadratName) {
      errors.push({ rowNumber: i + 1, message: 'Missing quadratName' });
      continue;
    }
    if ([row.startX, row.startY, row.dimensionX, row.dimensionY].some(v => !Number.isFinite(v))) {
      errors.push({ rowNumber: i + 1, message: 'Non-numeric value in coordinate or dimension field' });
      continue;
    }
    if (row.dimensionX <= 0 || row.dimensionY <= 0) {
      errors.push({ rowNumber: i + 1, message: 'Dimension must be positive' });
      continue;
    }
    rows.push(row);
  }
  return { rows, errors };
}
