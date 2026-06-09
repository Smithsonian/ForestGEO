import { FileRow, SourceFormat } from '@/config/macros/formdetails';
import { CODE_JOIN_SEPARATOR, NULL_CODE_TOKEN } from '@/lib/arcgis/schema';
import { aliasesFor, canonicalFieldsFor, normalizeHeader } from './fields';
import { ColumnMapping, ColumnMappingField, MappingValidation, SourceMetadata } from './types';

function allSourceColumns(metadata: SourceMetadata): string[] {
  if (metadata.format === SourceFormat.csv) return metadata.headers;
  // ArcGIS: union of all sheet columns (sheet scoping handled at read time).
  const seen = new Set<string>();
  const cols: string[] = [];
  for (const sheet of metadata.sheets) {
    for (const c of sheet.columns) {
      if (!seen.has(c)) {
        seen.add(c);
        cols.push(c);
      }
    }
  }
  return cols;
}

/**
 * Structural guard for mappings arriving from the wire (JSON.parse output). Anything that fails
 * here would otherwise throw a TypeError deep inside header resolution.
 */
export function isColumnMappingShape(value: unknown): value is ColumnMapping {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const mapping = value as Record<string, unknown>;
  if (mapping.version !== 1) return false;
  if (mapping.format !== SourceFormat.csv && mapping.format !== SourceFormat.arcgis_xlsx) return false;
  if (!Array.isArray(mapping.fields)) return false;
  for (const field of mapping.fields) {
    if (typeof field !== 'object' || field === null) return false;
    const f = field as Record<string, unknown>;
    if (typeof f.canonicalField !== 'string') return false;
    if (!Array.isArray(f.sourceColumns) || !f.sourceColumns.every(c => typeof c === 'string')) return false;
  }
  if (mapping.sheetRoles !== undefined) {
    if (typeof mapping.sheetRoles !== 'object' || mapping.sheetRoles === null || Array.isArray(mapping.sheetRoles)) return false;
    const roles = mapping.sheetRoles as Record<string, unknown>;
    if (roles.treesSheetName !== undefined && typeof roles.treesSheetName !== 'string') return false;
    if (roles.stemsSheetName !== undefined && typeof roles.stemsSheetName !== 'string') return false;
  }
  return true;
}

export function seedMapping(metadata: SourceMetadata): ColumnMapping {
  const format = metadata.format;
  const defs = canonicalFieldsFor(format);
  const aliases = aliasesFor(format);
  const sources = allSourceColumns(metadata);
  const normalizedSources = sources.map(s => ({ raw: s, norm: normalizeHeader(s) }));

  const fields: ColumnMappingField[] = defs.map(def => {
    const aliasSet = new Set(aliases[def.canonicalField] ?? [normalizeHeader(def.canonicalField)]);
    const matches = normalizedSources.filter(s => aliasSet.has(s.norm)).map(s => s.raw);
    const sourceColumns = def.multiSource ? matches : matches.slice(0, 1);
    return { canonicalField: def.canonicalField, sourceColumns, scope: def.scope };
  });

  const mapping: ColumnMapping = {
    version: 1,
    format: format as ColumnMapping['format'],
    fields
  };

  if (metadata.format === SourceFormat.arcgis_xlsx && (metadata.detectedTreesSheet || metadata.detectedStemsSheet)) {
    mapping.sheetRoles = {
      treesSheetName: metadata.detectedTreesSheet,
      stemsSheetName: metadata.detectedStemsSheet
    };
  }
  return mapping;
}

/** Mirrors readArcgisWorkbook's per-header resolution: an explicit mapping wins, else alias detection. */
function fieldResolvedOnSheet(
  canonicalField: string,
  sheetColumns: string[],
  overrideByNorm: Map<string, string>,
  fieldByAliasNorm: Map<string, string>
): boolean {
  return sheetColumns.some(c => {
    const norm = normalizeHeader(c);
    const resolved = overrideByNorm.get(norm) ?? fieldByAliasNorm.get(norm);
    return resolved === canonicalField;
  });
}

export function validateMapping(mapping: ColumnMapping, metadata: SourceMetadata): MappingValidation {
  const defs = canonicalFieldsFor(mapping.format);
  const available = new Set(allSourceColumns(metadata).map(normalizeHeader));
  const fieldByKey = new Map(mapping.fields.map(f => [f.canonicalField, f]));

  const missingRequired: string[] = [];
  const missingSourceColumns: string[] = [];
  const duplicateSourceColumns: string[] = [];
  const usedNormalized = new Set<string>();
  const firstRawByNorm = new Map<string, string>();

  for (const field of mapping.fields) {
    for (const c of field.sourceColumns) {
      const norm = normalizeHeader(c);
      if (usedNormalized.has(norm)) {
        if (!duplicateSourceColumns.includes(firstRawByNorm.get(norm) ?? c)) duplicateSourceColumns.push(firstRawByNorm.get(norm) ?? c);
      } else {
        usedNormalized.add(norm);
        firstRawByNorm.set(norm, c);
      }
      if (!available.has(norm)) missingSourceColumns.push(c);
    }
  }

  let missingSheetRoles: string[] | undefined;
  let sheetRoleConflict: boolean | undefined;
  let treesSheetColumns: string[] | undefined;
  let stemsSheetColumns: string[] | undefined;
  if (mapping.format === SourceFormat.arcgis_xlsx) {
    missingSheetRoles = [];
    const treesSheetName = mapping.sheetRoles?.treesSheetName;
    const stemsSheetName = mapping.sheetRoles?.stemsSheetName;
    if (!treesSheetName) missingSheetRoles.push('trees');
    if (!stemsSheetName) missingSheetRoles.push('stems');
    sheetRoleConflict = Boolean(treesSheetName && stemsSheetName && treesSheetName === stemsSheetName);
    if (metadata.format === SourceFormat.arcgis_xlsx && !sheetRoleConflict) {
      treesSheetColumns = metadata.sheets.find(s => s.name === treesSheetName)?.columns;
      stemsSheetColumns = metadata.sheets.find(s => s.name === stemsSheetName)?.columns;
    }
  }

  // Required fields are checked per sheet when both roles resolve (matching the reader's per-sheet
  // enforcement); otherwise against the union of all columns.
  const perSheet = treesSheetColumns !== undefined && stemsSheetColumns !== undefined;
  const overrideByNorm = new Map<string, string>();
  const fieldByAliasNorm = new Map<string, string>();
  if (perSheet) {
    for (const field of mapping.fields) {
      for (const src of field.sourceColumns) overrideByNorm.set(normalizeHeader(src), field.canonicalField);
    }
    const aliases = aliasesFor(mapping.format);
    for (const [canonicalField, aliasList] of Object.entries(aliases)) {
      for (const alias of aliasList) fieldByAliasNorm.set(normalizeHeader(alias), canonicalField);
    }
  }

  for (const def of defs) {
    if (!def.required) continue;
    if (perSheet) {
      const sheetsToCheck: { role: string; columns: string[] }[] =
        def.scope === 'trees'
          ? [{ role: 'trees', columns: treesSheetColumns! }]
          : def.scope === 'stems'
            ? [{ role: 'stems', columns: stemsSheetColumns! }]
            : [
                { role: 'trees', columns: treesSheetColumns! },
                { role: 'stems', columns: stemsSheetColumns! }
              ];
      for (const sheet of sheetsToCheck) {
        if (!fieldResolvedOnSheet(def.canonicalField, sheet.columns, overrideByNorm, fieldByAliasNorm)) {
          missingRequired.push(`${def.canonicalField} (${sheet.role} sheet)`);
        }
      }
    } else {
      const sourceColumns = fieldByKey.get(def.canonicalField)?.sourceColumns ?? [];
      const present = sourceColumns.filter(c => available.has(normalizeHeader(c)));
      if (present.length === 0) missingRequired.push(def.canonicalField);
    }
  }

  const ignoredSourceColumns = allSourceColumns(metadata).filter(c => !usedNormalized.has(normalizeHeader(c)));

  const valid =
    missingRequired.length === 0 &&
    missingSourceColumns.length === 0 &&
    duplicateSourceColumns.length === 0 &&
    (missingSheetRoles?.length ?? 0) === 0 &&
    !sheetRoleConflict;

  return { valid, missingRequired, missingSourceColumns, duplicateSourceColumns, ignoredSourceColumns, missingSheetRoles, sheetRoleConflict };
}

export function joinMultiSourceValues(values: (string | null | undefined)[]): string | null {
  const kept = values.map(v => (v ?? '').trim()).filter(v => v.length > 0 && v.toUpperCase() !== NULL_CODE_TOKEN && v.toUpperCase() !== 'NULL');
  return kept.length > 0 ? kept.join(CODE_JOIN_SEPARATOR) : null;
}

const MULTI_SOURCE_SEP = '#';

/** Appended to an unmapped column's key when it would otherwise collide with a key the mapping owns. */
export const IGNORED_COLUMN_KEY_SUFFIX = '__ignored';

/**
 * Build the Papa Parse `transformHeader` callback for a confirmed CSV mapping. The mapping is the
 * sole authority for its canonical fields: an unmapped column whose normalized name matches a field
 * key (or a multi-source temp key) is diverted to an inert `…__ignored` key so it can never
 * overwrite mapped data via papaparse's last-column-wins object building.
 */
export function buildPapaTransformHeader(mapping: ColumnMapping): (header: string) => string {
  // normalizedSourceHeader -> emitted key
  const emit = new Map<string, string>();
  const reservedKeys = new Set<string>(mapping.fields.map(f => f.canonicalField));
  for (const field of mapping.fields) {
    if (field.sourceColumns.length === 0) continue;
    if (field.sourceColumns.length === 1) {
      emit.set(normalizeHeader(field.sourceColumns[0]), field.canonicalField);
    } else {
      field.sourceColumns.forEach((col, i) => {
        const tempKey = `${field.canonicalField}${MULTI_SOURCE_SEP}${i}`;
        emit.set(normalizeHeader(col), tempKey);
        reservedKeys.add(tempKey);
      });
    }
  }
  return (header: string) => {
    const norm = normalizeHeader(header);
    const mapped = emit.get(norm);
    if (mapped !== undefined) return mapped;
    return reservedKeys.has(norm) ? `${norm}${IGNORED_COLUMN_KEY_SUFFIX}` : norm;
  };
}

/**
 * Collapse multi-source temp keys (`codes#0`, `codes#1`, …) into the canonical joined field.
 * Rows that produced none of a field's temp keys (e.g. a file whose column was already canonical)
 * are left untouched so an inapplicable mapping can never erase real data.
 */
export function collapseMultiSourceRow(row: FileRow, mapping: ColumnMapping): FileRow {
  const multi = mapping.fields.filter(f => f.sourceColumns.length > 1);
  if (multi.length === 0) return row;

  const out: FileRow = { ...row };
  for (const field of multi) {
    const tempKeys = field.sourceColumns.map((_col, i) => `${field.canonicalField}${MULTI_SOURCE_SEP}${i}`);
    if (!tempKeys.some(key => Object.hasOwn(row, key))) continue;
    const parts: (string | null)[] = [];
    for (const key of tempKeys) {
      parts.push(out[key] ?? null);
      delete out[key];
    }
    out[field.canonicalField] = joinMultiSourceValues(parts);
  }
  return out;
}
