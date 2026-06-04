import * as XLSX from 'xlsx';
import { MissingColumnError, MissingSheetError } from './errors';
import { STEM_SIGNATURE_COLUMN, fieldAliases, requiredTreeColumns } from './schema';
import type { ArcgisRow, ArcgisWorkbook } from './types';

interface ParsedSheet {
  name: string;
  columns: string[];
  rows: ArcgisRow[];
}

function parseSheet(sheet: XLSX.WorkSheet, name: string): ParsedSheet {
  const headerMatrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false });
  const columns = ((headerMatrix[0] as unknown[]) ?? []).map(cell => String(cell ?? '').trim());
  const rawRows = XLSX.utils.sheet_to_json<ArcgisRow>(sheet, { defval: null, raw: true });
  const rows = rawRows.map(row => {
    const normalized: ArcgisRow = {};
    for (const col of columns) {
      const value = row[col];
      normalized[col] = value === undefined || value === '' ? null : value;
    }
    return normalized;
  });
  return { name, columns, rows };
}

function sheetHasField(sheet: ParsedSheet, field: string): boolean {
  return fieldAliases(field).some(alias => sheet.columns.includes(alias));
}

export function readArcgisWorkbook(buffer: ArrayBuffer): ArcgisWorkbook {
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheets = workbook.SheetNames.map(name => parseSheet(workbook.Sheets[name], name));

  const stemsSheet = sheets.find(s => s.columns.includes(STEM_SIGNATURE_COLUMN));
  if (!stemsSheet) {
    throw new MissingSheetError(
      `No stems sheet found: expected a sheet containing the "${STEM_SIGNATURE_COLUMN}" column. Sheets seen: ${sheets.map(s => s.name).join(', ')}`
    );
  }

  const treesSheet = sheets.find(s => s !== stemsSheet);
  if (!treesSheet) {
    throw new MissingSheetError('No trees sheet found: the workbook must contain a separate trees sheet alongside the stems sheet.');
  }

  const required = requiredTreeColumns();
  const missing = required.filter(field => !sheetHasField(treesSheet, field));
  if (missing.length > 0) {
    throw new MissingColumnError(
      `Trees sheet "${treesSheet.name}" is missing required column(s): ${missing.join(', ')}. Add researcher-supplied "lx"/"ly" columns before upload.`
    );
  }

  return { trees: treesSheet.rows, stems: stemsSheet.rows };
}
