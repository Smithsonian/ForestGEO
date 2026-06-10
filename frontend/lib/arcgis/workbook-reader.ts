import ExcelJS from 'exceljs';
import { AmbiguousSheetError, MissingColumnError, MissingSheetError } from './errors';
import { STEM_SIGNATURE_COLUMN, requiredColumnsForSheet } from './schema';
import type { ArcgisCell, ArcgisRow, ArcgisWorkbook } from './types';
import type { ColumnMapping } from '@/lib/column-mapping/types';
import { ARCGIS_RESOLVE_OPTIONS, resolveHeaders } from '@/lib/column-mapping/resolution';
import { aliasesFor } from '@/lib/column-mapping/fields';
import { SourceFormat } from '@/config/macros/formdetails';

const ARCGIS_ALIASES = aliasesFor(SourceFormat.arcgis_xlsx);

interface ParsedSheet {
  name: string;
  columns: string[];
  rawColumns: string[];
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
 * Adapter over the shared resolution plan: ignored columns are not read at all (the column is
 * absent from keyByRawHeader), preserving the reader's historical drop semantics.
 */
function buildHeaderMap(rawHeaders: string[], mapping?: ColumnMapping): { keys: string[]; keyByRawHeader: Map<string, string> } {
  const plan = resolveHeaders(rawHeaders, mapping ?? null, ARCGIS_ALIASES, ARCGIS_RESOLVE_OPTIONS);
  const keys: string[] = [];
  const keyByRawHeader = new Map<string, string>();
  const seen = new Set<string>();
  for (const r of plan.resolutions) {
    if (r.kind === 'ignored') continue;
    if (seen.has(r.outputKey)) continue; // duplicate raw header strings share the map entry
    seen.add(r.outputKey);
    keys.push(r.outputKey);
    keyByRawHeader.set(r.rawHeader, r.outputKey);
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

  const rawColumns = rawHeaders.map(h => h.trim()).filter(h => h.length > 0);

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

  return { name: worksheet.name, columns: keys, rawColumns, rows };
}

function selectSheets(sheets: ParsedSheet[], sheetRoles?: ColumnMapping['sheetRoles']): { trees: ParsedSheet; stems: ParsedSheet } {
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

  return { trees: treesSheet, stems: stemsSheet };
}

export interface ArcgisWorkbookSheetInfo {
  name: string;
  columns: string[];
}

/**
 * Metadata-only scan: sheet names + raw header columns, with NO mapping applied. Used by the
 * preflight route to validate a client-supplied mapping against the workbook before reading it.
 */
export async function readArcgisSheetMetadata(buffer: ArrayBuffer): Promise<ArcgisWorkbookSheetInfo[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  return workbook.worksheets.map(worksheet => {
    const headerRow = worksheet.getRow(1);
    const columns: string[] = [];
    for (let column = 1; column <= worksheet.columnCount; column++) {
      const value = normalizeCellValue(headerRow.getCell(column).value);
      const header = value === null ? '' : String(value).trim();
      if (header.length > 0) columns.push(header);
    }
    return { name: worksheet.name, columns };
  });
}

export type ArcgisReadOutcome =
  | { ok: true; workbook: ArcgisWorkbook }
  | { ok: false; error: MissingSheetError | MissingColumnError | AmbiguousSheetError; sheets: ArcgisWorkbookSheetInfo[] };

export async function readArcgisWorkbookDetailed(buffer: ArrayBuffer, mapping?: ColumnMapping): Promise<ArcgisReadOutcome> {
  const workbook = new ExcelJS.Workbook();
  // exceljs ships an ambient `declare interface Buffer extends ArrayBuffer {}` that merges with and
  // diverges from @types/node's Buffer, so neither a node Buffer nor an ArrayBuffer is assignable to
  // its load() parameter at the type level. load() accepts the raw ArrayBuffer at runtime.
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  const sheets = workbook.worksheets.map(worksheet => parseSheet(worksheet, mapping));
  try {
    const { trees, stems } = selectSheets(sheets, mapping?.sheetRoles);
    return { ok: true, workbook: { trees: trees.rows, stems: stems.rows } };
  } catch (error: unknown) {
    if (error instanceof MissingSheetError || error instanceof MissingColumnError || error instanceof AmbiguousSheetError) {
      return { ok: false, error, sheets: sheets.map(s => ({ name: s.name, columns: s.rawColumns })) };
    }
    throw error;
  }
}

export async function readArcgisWorkbook(buffer: ArrayBuffer, mapping?: ColumnMapping): Promise<ArcgisWorkbook> {
  const outcome = await readArcgisWorkbookDetailed(buffer, mapping);
  if (!outcome.ok) throw outcome.error;
  return outcome.workbook;
}
