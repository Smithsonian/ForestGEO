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
  px: ['px', 'plotx'],
  py: ['py', 'ploty'],
  dbh: ['dbh', 'diameter'],
  hom: ['hom', 'height', 'heightofmeasurement'],
  date: ['date', 'measurementdate', 'dateof'],
  codes: ['codes', 'code', 'attributes', 'attributecodes'],
  comments: ['comments', 'comment', 'description', 'notes'],
  // `publishedstemid` is the Smithsonian/SI-assigned stem identifier. Only unambiguous headers are
  // aliased. A bare `StemID`/`stemid` header is deliberately NOT aliased: ForestGEO labels its own
  // internal `StemGUID` as `stemID` in the measurements grid and its CSV/form exports, so a re-uploaded
  // app export would otherwise feed internal StemGUID values into PublishedStemID. A genuine SI file
  // headed `StemID` can still be mapped by hand in the column-mapping UI. ArcGIS `GlobalID` is also
  // intentionally NOT mapped here.
  publishedstemid: ['publishedstemid', 'si_stemid', 'ctfs_stemid']
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

/**
 * Builds the papaparse `transformHeader` for the legacy (non column-mapping) upload path, scoped to
 * the form being uploaded. CSV_ALIASES is a MEASUREMENTS alias set: it aliases `species`/`sp` to
 * `spcode`, which is right when a measurements file names its species-code column "species" but wrong
 * for the species-definition form, where `species` is the epithet (a distinct required field) and
 * would be hijacked into `spcode` — colliding with the real `spcode` column and dropping SpeciesName.
 * Non-measurements forms (species, quadrats, personnel, attributes) already ship CSV headers equal to
 * their canonical fields, so they get identity normalization. Measurements revisions still alias.
 */
export function makeLegacyCsvHeaderKey(formType: FormType): (header: string) => string {
  return formType === FormType.measurements ? legacyCsvHeaderKey : normalizeHeader;
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
