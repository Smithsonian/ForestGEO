import ExcelJS from 'exceljs';
import { AmbiguousSheetError, MissingColumnError, MissingSheetError } from './errors';
import { STEM_SIGNATURE_COLUMN, canonicalFieldFor, normalizeHeader, requiredColumnsForSheet } from './schema';
import type { ArcgisCell, ArcgisRow, ArcgisWorkbook } from './types';
import type { ColumnMapping } from '@/lib/column-mapping/types';

interface ParsedSheet {
  name: string;
  columns: string[];
  rows: ArcgisRow[];
}

// exceljs cell values are a union: primitive | Date | {formula,result} | {richText} | {text,hyperlink} | {error}.
// Collapse each to the same ArcgisCell shape the xlsx reader produced (string | number | Date | null).
function normalizeCellValue(value: ExcelJS.CellValue): ArcgisCell {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'object') {
    if ('error' in value) return null;
    if ('richText' in value) return value.richText.map(part => part.text).join('');
    if ('hyperlink' in value) return value.text ?? null;
    if ('formula' in value || 'sharedFormula' in value) return normalizeCellValue(value.result ?? null);
  }
  return null;
}

/**
 * Maps each raw header to its CANONICAL schema field (when one matches a normalized alias) or to its
 * own trimmed text otherwise, so `COD_*`/OBJECTID/etc. survive. Resolution is two-pass so a
 * user-confirmed mapping's source columns ALWAYS claim their canonical keys, regardless of column
 * order; alias detection then only fills keys the mapping left unclaimed (a column the user mapped
 * to another field can never alias-claim). If two headers resolve to the same key within a pass,
 * the FIRST wins and later ones are ignored (no overwrite).
 */
function buildHeaderMap(rawHeaders: string[], mapping?: ColumnMapping): { keys: string[]; keyByRawHeader: Map<string, string> } {
  const overrideByNorm = new Map<string, string>();
  for (const field of mapping?.fields ?? []) {
    for (const src of field.sourceColumns) overrideByNorm.set(normalizeHeader(src), field.canonicalField);
  }
  const keyByRawHeader = new Map<string, string>();
  const claimed = new Set<string>();

  for (const raw of rawHeaders) {
    const key = overrideByNorm.get(normalizeHeader(raw.trim()));
    if (key === undefined || claimed.has(key)) continue;
    claimed.add(key);
    keyByRawHeader.set(raw, key);
  }

  for (const raw of rawHeaders) {
    if (keyByRawHeader.has(raw)) continue;
    const trimmed = raw.trim();
    // A header the mapping assigns elsewhere never falls back to alias/verbatim resolution.
    if (overrideByNorm.has(normalizeHeader(trimmed))) continue;
    const key = canonicalFieldFor(trimmed) ?? trimmed;
    if (claimed.has(key)) continue;
    claimed.add(key);
    keyByRawHeader.set(raw, key);
  }

  const keys: string[] = [];
  const seen = new Set<string>();
  for (const raw of rawHeaders) {
    const key = keyByRawHeader.get(raw);
    if (key === undefined || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return { keys, keyByRawHeader };
}

function parseSheet(worksheet: ExcelJS.Worksheet, mapping?: ColumnMapping): ParsedSheet {
  const columnCount = worksheet.columnCount;
  const headerRow = worksheet.getRow(1);
  const rawHeaders: string[] = [];
  for (let column = 1; column <= columnCount; column++) {
    const value = normalizeCellValue(headerRow.getCell(column).value);
    rawHeaders.push(value === null ? '' : String(value));
  }

  const { keys, keyByRawHeader } = buildHeaderMap(rawHeaders, mapping);

  const rows: ArcgisRow[] = [];
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber++) {
    const sheetRow = worksheet.getRow(rowNumber);
    // Build with a null prototype: header keys come from an attacker-controllable .xlsx, and a header
    // literally named `__proto__` would otherwise fire the Object.prototype `__proto__` setter on the
    // assignment below, replacing this row's prototype and corrupting later `key in row`/Object.entries
    // consumers. With no prototype the setter doesn't exist, so `__proto__` becomes an ordinary own key.
    // All consumers (parseSheet `in`, transform.ts Object.entries, schema.ts resolveColumn) use only
    // own-key operations, so dropping the prototype is safe and preserves normal parsing unchanged.
    const normalized: ArcgisRow = Object.create(null) as ArcgisRow;
    let hasValue = false;
    for (let column = 1; column <= columnCount; column++) {
      const key = keyByRawHeader.get(rawHeaders[column - 1]);
      if (key === undefined || key in normalized) continue;
      const value = normalizeCellValue(sheetRow.getCell(column).value);
      if (value !== null && value !== '') hasValue = true;
      normalized[key] = value === undefined || value === '' ? null : value;
    }
    // Intentionally drop rows whose every mapped cell is null/empty-string. This is STRICTER than the
    // old xlsx sheet_to_json({defval:null, raw:true}) object-mode, which kept a row of explicit
    // empty-string cells and emitted it as an all-null row; we drop that too so it never becomes a
    // spurious all-null failure row downstream.
    if (hasValue) rows.push(normalized);
  }

  return { name: worksheet.name, columns: keys, rows };
}

export async function readArcgisWorkbook(buffer: ArrayBuffer, mapping?: ColumnMapping): Promise<ArcgisWorkbook> {
  const workbook = new ExcelJS.Workbook();
  // exceljs ships an ambient `declare interface Buffer extends ArrayBuffer {}` that merges with and
  // diverges from @types/node's Buffer, so neither a node Buffer nor an ArrayBuffer is assignable to
  // its load() parameter at the type level. load() accepts the raw ArrayBuffer at runtime.
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  const sheets = workbook.worksheets.map(worksheet => parseSheet(worksheet, mapping));
  const sheetRoles = mapping?.sheetRoles;

  let stemsSheet: ParsedSheet;
  if (sheetRoles?.stemsSheetName) {
    const named = sheets.find(s => s.name === sheetRoles.stemsSheetName);
    if (!named) {
      throw new MissingSheetError(`Stems sheet "${sheetRoles.stemsSheetName}" not found in workbook. Sheets seen: ${sheets.map(s => s.name).join(', ')}`);
    }
    stemsSheet = named;
  } else {
    const stemsCandidates = sheets.filter(s => s.columns.includes(STEM_SIGNATURE_COLUMN));
    if (stemsCandidates.length === 0) {
      throw new MissingSheetError(
        `No stems sheet found: expected a sheet containing the "${STEM_SIGNATURE_COLUMN}" column. Sheets seen: ${sheets.map(s => s.name).join(', ')}`
      );
    }
    if (stemsCandidates.length > 1) {
      throw new AmbiguousSheetError(`Multiple stems sheet candidates found: ${stemsCandidates.map(s => `"${s.name}"`).join(', ')}.`);
    }
    stemsSheet = stemsCandidates[0];
  }

  const requiredStems = requiredColumnsForSheet('stems');
  const missingStems = requiredStems.filter(field => !stemsSheet.columns.includes(field));
  if (missingStems.length > 0) {
    throw new MissingColumnError(`Stems sheet "${stemsSheet.name}" is missing required column(s): ${missingStems.join(', ')}.`);
  }

  const required = requiredColumnsForSheet('trees');
  const candidates = sheets.filter(s => s !== stemsSheet);
  if (candidates.length === 0) {
    throw new MissingSheetError('No trees sheet found: the workbook must contain a separate trees sheet alongside the stems sheet.');
  }

  let treesSheet: ParsedSheet;
  if (sheetRoles?.treesSheetName) {
    const named = candidates.find(s => s.name === sheetRoles.treesSheetName);
    if (!named) {
      throw new MissingSheetError(`Trees sheet "${sheetRoles.treesSheetName}" not found in workbook. Sheets seen: ${sheets.map(s => s.name).join(', ')}`);
    }
    const missing = required.filter(field => !named.columns.includes(field));
    if (missing.length > 0) {
      throw new MissingColumnError(`Trees sheet "${named.name}" is missing required column(s): ${missing.join(', ')}.`);
    }
    treesSheet = named;
  } else {
    // Trees sheet is detected by SIGNATURE — the sheet (in any position, ignoring extra/junk sheets)
    // whose canonical columns include every required tree field.
    const treeCandidates = candidates.filter(s => required.every(field => s.columns.includes(field)));
    if (treeCandidates.length === 0) {
      const best = candidates.reduce((a, b) => {
        const aMissing = required.filter(f => !a.columns.includes(f)).length;
        const bMissing = required.filter(f => !b.columns.includes(f)).length;
        return bMissing < aMissing ? b : a;
      });
      const missing = required.filter(field => !best.columns.includes(field));
      throw new MissingColumnError(
        `No trees sheet found: the closest candidate "${best.name}" is missing required column(s): ${missing.join(', ')}. ` +
          `Add researcher-supplied "lx"/"ly" columns before upload.`
      );
    }
    if (treeCandidates.length > 1) {
      throw new AmbiguousSheetError(`Multiple trees sheet candidates found: ${treeCandidates.map(s => `"${s.name}"`).join(', ')}.`);
    }
    treesSheet = treeCandidates[0];
  }

  return { trees: treesSheet.rows, stems: stemsSheet.rows };
}

/** Enumerate worksheet names and their raw (trimmed) first-row headers without canonicalizing or validating. */
export async function describeArcgisWorkbook(buffer: ArrayBuffer): Promise<{ sheets: { name: string; columns: string[] }[] }> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  const sheets = workbook.worksheets.map(worksheet => {
    const headerRow = worksheet.getRow(1);
    const columns: string[] = [];
    headerRow.eachCell({ includeEmpty: false }, cell => {
      const text = String(normalizeCellValue(cell.value) ?? '').trim();
      if (text.length > 0) columns.push(text);
    });
    return { name: worksheet.name, columns };
  });
  return { sheets };
}
