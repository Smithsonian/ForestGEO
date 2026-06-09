import { SourceFormat } from '@/config/macros/formdetails';
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

export function validateMapping(mapping: ColumnMapping, metadata: SourceMetadata): MappingValidation {
  const defs = canonicalFieldsFor(mapping.format);
  const requiredByField = new Map(defs.map(d => [d.canonicalField, d.required]));
  const available = new Set(allSourceColumns(metadata).map(normalizeHeader));

  const missingRequired: string[] = [];
  const missingSourceColumns: string[] = [];
  const usedNormalized = new Set<string>();

  for (const field of mapping.fields) {
    const required = requiredByField.get(field.canonicalField) ?? false;
    const present = field.sourceColumns.filter(c => available.has(normalizeHeader(c)));
    field.sourceColumns.forEach(c => usedNormalized.add(normalizeHeader(c)));
    if (required && present.length === 0) missingRequired.push(field.canonicalField);
    for (const c of field.sourceColumns) {
      if (!available.has(normalizeHeader(c))) missingSourceColumns.push(c);
    }
  }

  const ignoredSourceColumns = allSourceColumns(metadata).filter(c => !usedNormalized.has(normalizeHeader(c)));

  let missingSheetRoles: string[] | undefined;
  if (mapping.format === SourceFormat.arcgis_xlsx) {
    missingSheetRoles = [];
    if (!mapping.sheetRoles?.treesSheetName) missingSheetRoles.push('trees');
    if (!mapping.sheetRoles?.stemsSheetName) missingSheetRoles.push('stems');
  }

  const valid = missingRequired.length === 0 && missingSourceColumns.length === 0 && (missingSheetRoles?.length ?? 0) === 0;

  return { valid, missingRequired, missingSourceColumns, ignoredSourceColumns, missingSheetRoles };
}

export function joinMultiSourceValues(values: (string | null | undefined)[]): string | null {
  const kept = values.map(v => (v ?? '').trim()).filter(v => v.length > 0 && v.toUpperCase() !== NULL_CODE_TOKEN && v.toUpperCase() !== 'NULL');
  return kept.length > 0 ? kept.join(CODE_JOIN_SEPARATOR) : null;
}
