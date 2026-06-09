import { SourceFormat } from '@/config/macros/formdetails';
import { ARCGIS_SCHEMA, CODE_COLUMN_PREFIX, normalizeHeader } from '@/lib/arcgis/schema';
import { CanonicalFieldDef, MappingScope } from './types';

export { normalizeHeader };

// CSV measurement import fields. Deliberately a curated subset of
// TableHeadersByFormType[measurements] — excludes export-only fields
// (measurementID, errors). Requiredness mirrors RequiredTableHeadersByFormType.
const CSV_FIELDS: CanonicalFieldDef[] = [
  { canonicalField: 'tag', required: true, scope: 'file', multiSource: false, explanation: 'Tree tag, unique within plot' },
  { canonicalField: 'spcode', required: true, scope: 'file', multiSource: false, explanation: 'Species code' },
  { canonicalField: 'quadrat', required: true, scope: 'file', multiSource: false, explanation: 'Quadrat name' },
  { canonicalField: 'lx', required: true, scope: 'file', multiSource: false, explanation: 'X-coordinate of stem' },
  { canonicalField: 'ly', required: true, scope: 'file', multiSource: false, explanation: 'Y-coordinate of stem' },
  { canonicalField: 'date', required: true, scope: 'file', multiSource: false, explanation: 'Measurement date' },
  { canonicalField: 'stemtag', required: false, scope: 'file', multiSource: false, explanation: 'Stem tag for multi-stemmed trees' },
  { canonicalField: 'dbh', required: false, scope: 'file', multiSource: false, explanation: 'Diameter at breast height' },
  { canonicalField: 'hom', required: false, scope: 'file', multiSource: false, explanation: 'Height of measurement' },
  { canonicalField: 'codes', required: false, scope: 'file', multiSource: true, explanation: 'Attribute codes; multiple columns joined with ";"' },
  { canonicalField: 'comments', required: false, scope: 'file', multiSource: false, explanation: 'Free-text comments' }
];

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
