import { FileRow } from '@/config/macros/formdetails';
import { CODE_JOIN_SEPARATOR, NULL_CODE_TOKEN } from '@/lib/arcgis/schema';
import { normalizeHeader } from './fields';
import { ColumnMapping, MappingScope, SheetRole } from './types';

export const MULTI_SOURCE_SEP = '#';
export const IGNORED_COLUMN_KEY_SUFFIX = '__ignored';

export type HeaderResolutionKind = 'mapped' | 'alias' | 'passthrough' | 'ignored';

export interface HeaderResolution {
  index: number;
  rawHeader: string;
  outputKey: string;
  kind: HeaderResolutionKind;
  /** Canonical field this header feeds (mapped/alias only). */
  canonicalField?: string;
}

export interface HeaderResolutionPlan {
  resolutions: HeaderResolution[];
  /** Output key per header position; index-aligned with the rawHeaders input. */
  outputKeys: string[];
  /** Canonical field -> temp keys actually emitted for THIS header set (multi-source fields only). */
  multiSourceTempKeys: Map<string, string[]>;
  /** Canonical fields that resolved (mapped or alias) in this header set. */
  resolvedFields: Set<string>;
}

export interface ResolveOptions {
  /** Fill canonical keys the mapping left unclaimed from alias matches (XLSX sheets); CSV uses false. */
  allowAliasFill: boolean;
  /** Key emitted for headers no field claims. */
  passthroughKey: (raw: string) => string;
  /** When set, only mapping fields whose scope applies to this sheet contribute explicit overrides. */
  sheetRole?: SheetRole;
  /** Canonical field -> scope. When set, alias fill skips fields whose scope excludes sheetRole. */
  aliasFieldScopes?: Record<string, MappingScope>;
}

export const CSV_RESOLVE_OPTIONS: ResolveOptions = {
  allowAliasFill: false,
  passthroughKey: normalizeHeader
};

export const ARCGIS_RESOLVE_OPTIONS: ResolveOptions = {
  allowAliasFill: true,
  passthroughKey: raw => raw.trim()
};

// An undefined scope (wire mappings predating scope validation) applies everywhere rather than
// silently dropping the field's explicit overrides.
function fieldAppliesToSheet(scope: MappingScope | undefined, sheetRole?: SheetRole): boolean {
  if (!sheetRole || scope === undefined) return true;
  return scope === 'both' || scope === 'file' || scope === sheetRole;
}

/**
 * Resolve every raw header to exactly one output key. Precedence: an explicit mapping source
 * claims its key first (regardless of column order); alias detection then fills unclaimed keys
 * (when allowed); everything else passes through — unless its key would collide with a key the
 * mapping owns or one already claimed, in which case the header is diverted to a unique inert
 * `…__ignored#<index>` key so it can never overwrite resolved data.
 */
export function resolveHeaders(
  rawHeaders: string[],
  mapping: ColumnMapping | null,
  aliases: Record<string, string[]>,
  options: ResolveOptions
): HeaderResolutionPlan {
  const overrideByNorm = new Map<string, { field: string; slot: number }>();
  const reservedKeys = new Set<string>();
  // Effective scope per canonical field for alias-fill gating: the schema defaults (aliasFieldScopes)
  // are overlaid by any scope the mapping itself declares on that field, so a field the author scoped
  // to one role (e.g. trees-only lx) is never alias-filled on the other sheet even when the caller
  // passed no aliasFieldScopes.
  const aliasFieldScopes: Record<string, MappingScope> = { ...(options.aliasFieldScopes ?? {}) };
  for (const field of mapping?.fields ?? []) {
    if (field.scope !== undefined) aliasFieldScopes[field.canonicalField] = field.scope;
    // Scoped-out fields contribute no overrides AND no reserved keys here; safe because reservedKeys
    // is only consulted on the !allowAliasFill (CSV) path, and CSV never sets sheetRole.
    if (!fieldAppliesToSheet(field.scope, options.sheetRole)) continue;
    reservedKeys.add(field.canonicalField);
    const multi = field.sourceColumns.length > 1;
    field.sourceColumns.forEach((src, i) => {
      overrideByNorm.set(normalizeHeader(src), { field: field.canonicalField, slot: multi ? i : -1 });
      if (multi) reservedKeys.add(`${field.canonicalField}${MULTI_SOURCE_SEP}${i}`);
    });
  }
  const fieldByAliasNorm = new Map<string, string>();
  for (const [canonicalField, aliasList] of Object.entries(aliases)) {
    for (const alias of aliasList) fieldByAliasNorm.set(normalizeHeader(alias), canonicalField);
  }

  const resolutions: (HeaderResolution | undefined)[] = new Array(rawHeaders.length);
  const claimed = new Set<string>();
  const ignoredKey = (norm: string, index: number) => `${norm}${IGNORED_COLUMN_KEY_SUFFIX}${MULTI_SOURCE_SEP}${index}`;

  // Pass 1: explicit mapping claims its keys.
  rawHeaders.forEach((raw, index) => {
    const override = overrideByNorm.get(normalizeHeader(raw.trim()));
    if (!override) return;
    const outputKey = override.slot >= 0 ? `${override.field}${MULTI_SOURCE_SEP}${override.slot}` : override.field;
    if (claimed.has(outputKey)) return; // duplicate occurrence; diverted in pass 2
    claimed.add(outputKey);
    resolutions[index] = { index, rawHeader: raw, outputKey, kind: 'mapped', canonicalField: override.field };
  });

  // Pass 2: alias fill (when allowed), then passthrough or ignore.
  rawHeaders.forEach((raw, index) => {
    if (resolutions[index]) return;
    const norm = normalizeHeader(raw.trim());
    if (overrideByNorm.has(norm)) {
      resolutions[index] = { index, rawHeader: raw, outputKey: ignoredKey(norm, index), kind: 'ignored' };
      return;
    }
    if (options.allowAliasFill) {
      const field = fieldByAliasNorm.get(norm);
      if (field !== undefined && !claimed.has(field) && fieldAppliesToSheet(aliasFieldScopes[field], options.sheetRole)) {
        claimed.add(field);
        resolutions[index] = { index, rawHeader: raw, outputKey: field, kind: 'alias', canonicalField: field };
        return;
      }
    }
    const key = options.passthroughKey(raw);
    if (claimed.has(key) || (!options.allowAliasFill && reservedKeys.has(key))) {
      resolutions[index] = { index, rawHeader: raw, outputKey: ignoredKey(norm, index), kind: 'ignored' };
      return;
    }
    claimed.add(key);
    resolutions[index] = { index, rawHeader: raw, outputKey: key, kind: 'passthrough' };
  });

  const finalized = resolutions as HeaderResolution[];
  const multiSourceTempKeys = new Map<string, string[]>();
  const resolvedFields = new Set<string>();
  for (const r of finalized) {
    if (r.canonicalField === undefined) continue;
    resolvedFields.add(r.canonicalField);
    if (r.outputKey.includes(MULTI_SOURCE_SEP)) {
      const keys = multiSourceTempKeys.get(r.canonicalField) ?? [];
      keys.push(r.outputKey);
      multiSourceTempKeys.set(r.canonicalField, keys);
    }
  }
  return { resolutions: finalized, outputKeys: finalized.map(r => r.outputKey), multiSourceTempKeys, resolvedFields };
}

/** papaparse transformHeader callback: positional lookup into the plan. */
export function transformHeaderFromPlan(plan: HeaderResolutionPlan): (header: string, index: number) => string {
  return (header: string, index: number) => plan.outputKeys[index] ?? normalizeHeader(header);
}

/**
 * The plan is applied to parsed rows by header POSITION (see transformHeaderFromPlan), so it is only
 * safe when the parser produced exactly as many columns as the plan was built from. The upload
 * executor calls this on the first chunk and aborts when it returns false, rather than mis-keying.
 */
export function planColumnCountMatches(plan: HeaderResolutionPlan, parsedColumnCount: number): boolean {
  return plan.outputKeys.length === parsedColumnCount;
}

export function joinMultiSourceValues(values: (string | null | undefined)[]): string | null {
  const kept = values.map(v => (v ?? '').trim()).filter(v => v.length > 0 && v.toUpperCase() !== NULL_CODE_TOKEN && v.toUpperCase() !== 'NULL');
  return kept.length > 0 ? kept.join(CODE_JOIN_SEPARATOR) : null;
}

/** Collapse the temp keys the plan ACTUALLY emitted into their canonical joined fields. */
export function collapseRowWithPlan(row: FileRow, plan: HeaderResolutionPlan): FileRow {
  if (plan.multiSourceTempKeys.size === 0) return row;
  const out: FileRow = { ...row };
  for (const [canonicalField, tempKeys] of plan.multiSourceTempKeys) {
    const parts: (string | null)[] = [];
    for (const key of tempKeys) {
      parts.push(out[key] ?? null);
      delete out[key];
    }
    out[canonicalField] = joinMultiSourceValues(parts);
  }
  return out;
}
