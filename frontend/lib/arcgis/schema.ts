export type ArcgisSheetScope = 'trees' | 'stems' | 'both';

export interface ArcgisFieldDef {
  /** canonical FileRow key, or identity field name */
  field: string;
  /** source column names; matched against headers after normalization (case/whitespace/`_`/`-` insensitive) */
  aliases: string[];
  scope: ArcgisSheetScope;
  required: boolean;
  /** help text for the UI; omit for identity-only fields you don't want shown */
  help?: string;
  category?: 'required' | 'optional';
}

export const STEM_SIGNATURE_COLUMN = 'ParentGlobalID';
export const TREE_GLOBAL_ID_COLUMN = 'GlobalID';
export const CODE_COLUMN_PREFIX = 'COD_';
export const NULL_CODE_TOKEN = 'NA';
export const CODE_JOIN_SEPARATOR = ';';

export const ARCGIS_SCHEMA: ArcgisFieldDef[] = [
  {
    field: 'GlobalID',
    aliases: ['GlobalID'],
    scope: 'both',
    required: true,
    help: 'ArcGIS global identifier for the tree (trees sheet) or stem (stems sheet).',
    category: 'required'
  },
  {
    field: 'ParentGlobalID',
    aliases: ['ParentGlobalID'],
    scope: 'stems',
    required: true,
    help: 'Stems sheet only: links a stem to its parent tree GlobalID.',
    category: 'optional'
  },
  {
    field: 'quadrat',
    aliases: ['quadrat'],
    scope: 'both',
    required: false,
    help: 'Quadrat label as recorded by the field crew (e.g. "A25"); matched by name downstream.',
    category: 'required'
  },
  {
    field: 'tag',
    aliases: ['tag'],
    scope: 'both',
    required: false,
    help: 'Tree tag; unique within a plot. Stems inherit their parent tree tag.',
    category: 'required'
  },
  { field: 'StemTag', aliases: ['StemTag'], scope: 'both', required: false, help: 'Stem tag for the row.', category: 'optional' },
  { field: 'spcode', aliases: ['spcode'], scope: 'both', required: false, help: 'Species code.', category: 'required' },
  {
    field: 'DBH_CURRENT',
    aliases: ['DBH_CURRENT'],
    scope: 'both',
    required: false,
    help: 'Current diameter at breast height (units passed through).',
    category: 'optional'
  },
  { field: 'HOM', aliases: ['HOM'], scope: 'both', required: false, help: 'Height of measurement (units passed through).', category: 'optional' },
  {
    field: 'lx',
    aliases: ['lx', 'LocalX'],
    scope: 'trees',
    required: true,
    help: 'Researcher-supplied quadrat-local X coordinate (read verbatim; trees sheet only).',
    category: 'required'
  },
  {
    field: 'ly',
    aliases: ['ly', 'LocalY'],
    scope: 'trees',
    required: true,
    help: 'Researcher-supplied quadrat-local Y coordinate (read verbatim; trees sheet only).',
    category: 'required'
  },
  {
    field: 'Date_measured',
    aliases: ['Date_measured'],
    scope: 'both',
    required: false,
    help: 'Measurement date as an Excel serial number.',
    category: 'required'
  },
  { field: 'notes', aliases: ['notes'], scope: 'both', required: false, help: 'Free-text comments for the row.', category: 'optional' },
  {
    field: 'COD_*',
    aliases: [],
    scope: 'both',
    required: false,
    help: 'One column per attribute code (COD_M, COD_P, …); non-"NA" values are joined with ";".',
    category: 'optional'
  }
];

function scopeMatches(entryScope: ArcgisSheetScope, wanted: 'trees' | 'stems'): boolean {
  return entryScope === 'both' || entryScope === wanted;
}

/** Folds case, surrounding whitespace, and `_`/`-`/space separators so header variants compare equal. */
export function normalizeHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[\s_-]/g, '');
}

/** Canonical schema field whose any alias normalizes-equal to the header; else null. */
export function canonicalFieldFor(header: string): string | null {
  const norm = normalizeHeader(header);
  for (const def of ARCGIS_SCHEMA) {
    if (def.aliases.some(alias => normalizeHeader(alias) === norm)) return def.field;
  }
  return null;
}

/**
 * Returns the cell value for `field` from a CANONICAL-keyed row (headers were canonicalized at read
 * time). Returns null if the field is absent, preserving the null-vs-undefined distinction.
 */
export function resolveColumn(row: Record<string, unknown>, field: string): unknown {
  return field in row ? row[field] : null;
}

/** Canonical field key of every required schema entry whose scope includes the trees sheet. */
export function requiredTreeColumns(): string[] {
  return ARCGIS_SCHEMA.filter(def => def.required && scopeMatches(def.scope, 'trees') && def.aliases.length > 0).map(def => def.field);
}

/** All aliases of a field, used for alias-aware presence checks against a sheet's headers. */
export function fieldAliases(field: string): string[] {
  return ARCGIS_SCHEMA.find(def => def.field === field)?.aliases ?? [];
}

export function arcgisHelpHeaders(): { label: string; explanation?: string; category?: 'required' | 'optional' }[] {
  return ARCGIS_SCHEMA.filter(def => def.help !== undefined).map(def => ({ label: def.field, explanation: def.help, category: def.category }));
}
