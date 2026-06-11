import { FormType, SourceFormat, TableHeadersByFormType } from '@/config/macros/formdetails';
import { ARCGIS_SCHEMA, CODE_COLUMN_PREFIX, normalizeHeader } from '@/lib/arcgis/schema';
import { CanonicalFieldDef, MappingScope } from './types';

export { normalizeHeader };

const MEASUREMENTS_EXPORT_ONLY_FIELDS = new Set(['measurementID', 'errors']);
const MULTI_SOURCE_CSV_FIELDS = new Set(['codes']);

// Derived from the canonical measurements registry so requiredness/explanations cannot drift.
const CSV_FIELDS: CanonicalFieldDef[] = TableHeadersByFormType[FormType.measurements]
  .filter(header => !MEASUREMENTS_EXPORT_ONLY_FIELDS.has(header.label))
  .map(header => ({
    canonicalField: header.label,
    required: header.category === 'required',
    scope: 'file' as MappingScope,
    multiSource: MULTI_SOURCE_CSV_FIELDS.has(header.label),
    explanation: header.explanation
  }));

// CSV alias dictionary, ported verbatim from uploadfiresql.tsx:transformHeader (normalized keys).
const CSV_ALIASES: Record<string, string[]> = {
  tag: ['tag', 'treetag'],
  stemtag: ['stemtag', 'stem'],
  spcode: ['spcode', 'species', 'speciescode', 'sp'],
  quadrat: ['quadrat', 'quad', 'quadratname'],
  lx: ['lx', 'localx', 'x', 'xcoord'],
  ly: ['ly', 'localy', 'y', 'ycoord'],
  dbh: ['dbh', 'diameter'],
  hom: ['hom', 'height', 'heightofmeasurement'],
  date: ['date', 'measurementdate', 'dateof'],
  codes: ['codes', 'code', 'attributes', 'attributecodes'],
  comments: ['comments', 'comment', 'description', 'notes']
};

const CODE_AGGREGATE_FIELD = `${CODE_COLUMN_PREFIX}*`;

// Reverse index (normalized alias -> canonical field), built once from CSV_ALIASES so the legacy
// header lookup shares the same alias truth as the resolution plan. Used by the revision and
// non-measurements upload flows, which bypass the column-mapping flow and need a plain header rename.
const LEGACY_CSV_FIELD_BY_ALIAS: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const [canonicalField, aliases] of Object.entries(CSV_ALIASES)) {
    for (const alias of aliases) out[normalizeHeader(alias)] = canonicalField;
  }
  return out;
})();

/**
 * Renames a CSV header to its canonical field using the single CSV_ALIASES source. Unknown headers
 * pass through normalized (lowercase, no whitespace/`_`/`-`), matching the legacy inline transform.
 */
export function legacyCsvHeaderKey(header: string): string {
  const norm = normalizeHeader(header);
  return LEGACY_CSV_FIELD_BY_ALIAS[norm] ?? norm;
}

function arcgisFields(): CanonicalFieldDef[] {
  return ARCGIS_SCHEMA.filter(def => def.field !== CODE_AGGREGATE_FIELD).map(def => ({
    canonicalField: def.field,
    required: def.required,
    scope: def.scope as MappingScope,
    multiSource: false,
    explanation: def.help
  }));
}

function arcgisAliases(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const def of ARCGIS_SCHEMA) {
    if (def.field === CODE_AGGREGATE_FIELD) continue;
    out[def.field] = def.aliases.map(normalizeHeader);
  }
  return out;
}

export function canonicalFieldsFor(format: SourceFormat): CanonicalFieldDef[] {
  return format === SourceFormat.arcgis_xlsx ? arcgisFields() : CSV_FIELDS;
}

export function aliasesFor(format: SourceFormat): Record<string, string[]> {
  return format === SourceFormat.arcgis_xlsx ? arcgisAliases() : CSV_ALIASES;
}

/** Canonical field -> declared scope, for scope-aware alias resolution. */
export function fieldScopesFor(format: SourceFormat): Record<string, MappingScope> {
  const out: Record<string, MappingScope> = {};
  for (const def of canonicalFieldsFor(format)) out[def.canonicalField] = def.scope;
  return out;
}
