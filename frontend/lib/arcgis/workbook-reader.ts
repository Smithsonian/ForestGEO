import * as XLSX from 'xlsx';
import { AmbiguousSheetError, MissingColumnError, MissingSheetError } from './errors';
import { STEM_SIGNATURE_COLUMN, canonicalFieldFor, requiredColumnsForSheet } from './schema';
import type { ArcgisRow, ArcgisWorkbook } from './types';

interface ParsedSheet {
  name: string;
  columns: string[];
  rows: ArcgisRow[];
}

/**
 * Maps each raw header to its CANONICAL schema field (when one matches a normalized alias) or to its
 * own trimmed text otherwise, so `COD_*`/OBJECTID/etc. survive. If two headers resolve to the same
 * canonical field, the FIRST wins and later ones are ignored (no overwrite).
 */
function buildHeaderMap(rawHeaders: string[]): { keys: string[]; keyByRawHeader: Map<string, string> } {
  const keys: string[] = [];
  const keyByRawHeader = new Map<string, string>();
  const claimed = new Set<string>();
  for (const raw of rawHeaders) {
    const trimmed = raw.trim();
    const key = canonicalFieldFor(trimmed) ?? trimmed;
    if (claimed.has(key)) continue;
    claimed.add(key);
    keys.push(key);
    keyByRawHeader.set(raw, key);
  }
  return { keys, keyByRawHeader };
}

function parseSheet(sheet: XLSX.WorkSheet, name: string): ParsedSheet {
  const headerMatrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false });
  const rawHeaders = ((headerMatrix[0] as unknown[]) ?? []).map(cell => String(cell ?? ''));
  const { keys, keyByRawHeader } = buildHeaderMap(rawHeaders);
  const rawRows = XLSX.utils.sheet_to_json<ArcgisRow>(sheet, { defval: null, raw: true });
  const rows = rawRows.map(row => {
    const normalized: ArcgisRow = {};
    for (const raw of rawHeaders) {
      const key = keyByRawHeader.get(raw);
      if (key === undefined || key in normalized) continue;
      const value = row[raw];
      normalized[key] = value === undefined || value === '' ? null : value;
    }
    return normalized;
  });
  return { name, columns: keys, rows };
}

export function readArcgisWorkbook(buffer: ArrayBuffer): ArcgisWorkbook {
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheets = workbook.SheetNames.map(name => parseSheet(workbook.Sheets[name], name));

  const stemsCandidates = sheets.filter(s => s.columns.includes(STEM_SIGNATURE_COLUMN));
  if (stemsCandidates.length === 0) {
    throw new MissingSheetError(
      `No stems sheet found: expected a sheet containing the "${STEM_SIGNATURE_COLUMN}" column. Sheets seen: ${sheets.map(s => s.name).join(', ')}`
    );
  }
  if (stemsCandidates.length > 1) {
    throw new AmbiguousSheetError(`Multiple stems sheet candidates found: ${stemsCandidates.map(s => `"${s.name}"`).join(', ')}.`);
  }
  const stemsSheet = stemsCandidates[0];

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

  const treesSheet = treeCandidates[0];
  return { trees: treesSheet.rows, stems: stemsSheet.rows };
}
