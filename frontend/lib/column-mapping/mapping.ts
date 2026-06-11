import { SourceFormat } from '@/config/macros/formdetails';
import { aliasesFor, canonicalFieldsFor, fieldScopesFor, normalizeHeader } from './fields';
import { ARCGIS_RESOLVE_OPTIONS, CSV_RESOLVE_OPTIONS, resolveHeaders } from './resolution';
import { ColumnMapping, ColumnMappingField, MappingValidation, SourceMetadata } from './types';

export { joinMultiSourceValues } from './resolution';

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

/** Bump to invalidate every previously-computed signature (e.g. after a parser-behavior change). */
export const HEADER_SIGNATURE_VERSION = 3;

/**
 * Identity of an exact header SEQUENCE. Each position is emitted as `c<norm>` for a content header
 * or `b` for a blank position, so the content and blank token spaces are disjoint — a real header
 * that normalizes to any sentinel-like value cannot collide with a genuine blank marker.
 * Order- and duplicate-sensitive. Versioned so a parser change can invalidate stale signatures
 * wholesale. Compatibility is sequence identity, not "same normalized bag of headers".
 *
 * The '_' separator is safe because normalizeHeader strips underscores from every header, so no
 * normalized token can contain it — the token sequence stays unambiguously recoverable.
 */
export function headerSignature(headers: string[]): string {
  const body = headers
    .map(h => {
      const norm = normalizeHeader(h);
      return norm ? `c${norm}` : 'b';
    })
    .join('_');
  return `v${HEADER_SIGNATURE_VERSION}:${body}`;
}

export function mappingApplies(mapping: ColumnMapping, headers: string[]): boolean {
  return mapping.headerSignature !== undefined && mapping.headerSignature === headerSignature(headers);
}

/**
 * Whether `mapping` was built from the same source columns `seedMapping` would derive from this
 * metadata. Uses the identical column basis seedMapping signs (the de-duplicated union for ArcGIS),
 * so a freshly seeded mapping resubmitted against the same source is never spuriously stale.
 */
export function mappingMatchesSource(mapping: ColumnMapping, metadata: SourceMetadata): boolean {
  return mappingApplies(mapping, allSourceColumns(metadata));
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
    // An unrecognized scope would silently scope the field out of every role-resolved sheet
    // (fieldAppliesToSheet matches nothing), so reject it as malformed instead.
    if (f.scope !== undefined && f.scope !== 'file' && f.scope !== 'trees' && f.scope !== 'stems' && f.scope !== 'both') return false;
  }
  if (mapping.sheetRoles !== undefined) {
    if (typeof mapping.sheetRoles !== 'object' || mapping.sheetRoles === null || Array.isArray(mapping.sheetRoles)) return false;
    const roles = mapping.sheetRoles as Record<string, unknown>;
    if (roles.treesSheetName !== undefined && typeof roles.treesSheetName !== 'string') return false;
    if (roles.stemsSheetName !== undefined && typeof roles.stemsSheetName !== 'string') return false;
  }
  if (mapping.headerSignature !== undefined && typeof mapping.headerSignature !== 'string') return false;
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
  mapping.headerSignature = headerSignature(sources);
  return mapping;
}

export type CsvMappingRejectionCode = 'stale' | 'invalid';

export interface EffectiveCsvMapping {
  mapping: ColumnMapping;
  usedStored: boolean;
  /** Set only when the stored mapping was rejected; the UI composes the user-facing sentence. */
  reasonCode?: CsvMappingRejectionCode;
}

/**
 * Decide which mapping the upload should actually apply. A stored mapping is trusted only when it
 * both applies to these exact headers AND passes full validation; otherwise we seed and report why.
 */
export function chooseEffectiveCsvMapping(stored: ColumnMapping | undefined, headers: string[]): EffectiveCsvMapping {
  const metadata = { format: SourceFormat.csv as const, headers };
  if (stored && !mappingApplies(stored, headers)) {
    return { mapping: seedMapping(metadata), usedStored: false, reasonCode: 'stale' };
  }
  if (stored && !validateMapping(stored, metadata).valid) {
    return { mapping: seedMapping(metadata), usedStored: false, reasonCode: 'invalid' };
  }
  return stored ? { mapping: stored, usedStored: true } : { mapping: seedMapping(metadata), usedStored: false };
}

export function validateMapping(mapping: ColumnMapping, metadata: SourceMetadata): MappingValidation {
  const defs = canonicalFieldsFor(mapping.format);
  const knownFields = new Set(defs.map(d => d.canonicalField));
  const unknownFields = mapping.fields.map(f => f.canonicalField).filter(k => !knownFields.has(k));
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

  const arcgisScopes = fieldScopesFor(mapping.format);
  const csvPlan = metadata.format === SourceFormat.csv ? resolveHeaders(metadata.headers, mapping, aliasesFor(mapping.format), CSV_RESOLVE_OPTIONS) : null;
  const treesPlan = perSheet
    ? resolveHeaders(treesSheetColumns!, mapping, aliasesFor(mapping.format), { ...ARCGIS_RESOLVE_OPTIONS, sheetRole: 'trees', aliasFieldScopes: arcgisScopes })
    : null;
  const stemsPlan = perSheet
    ? resolveHeaders(stemsSheetColumns!, mapping, aliasesFor(mapping.format), { ...ARCGIS_RESOLVE_OPTIONS, sheetRole: 'stems', aliasFieldScopes: arcgisScopes })
    : null;

  for (const def of defs) {
    if (!def.required) continue;
    if (perSheet) {
      const sheetsToCheck =
        def.scope === 'trees'
          ? [{ role: 'trees', plan: treesPlan! }]
          : def.scope === 'stems'
            ? [{ role: 'stems', plan: stemsPlan! }]
            : [
                { role: 'trees', plan: treesPlan! },
                { role: 'stems', plan: stemsPlan! }
              ];
      for (const sheet of sheetsToCheck) {
        if (!sheet.plan.resolvedFields.has(def.canonicalField)) {
          missingRequired.push(`${def.canonicalField} (${sheet.role} sheet)`);
        }
      }
    } else if (csvPlan) {
      if (!csvPlan.resolvedFields.has(def.canonicalField)) missingRequired.push(def.canonicalField);
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
    unknownFields.length === 0 &&
    (missingSheetRoles?.length ?? 0) === 0 &&
    !sheetRoleConflict;

  return { valid, missingRequired, missingSourceColumns, duplicateSourceColumns, unknownFields, ignoredSourceColumns, missingSheetRoles, sheetRoleConflict };
}
