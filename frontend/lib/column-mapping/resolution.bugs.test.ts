import { describe, expect, it } from 'vitest';
import { SourceFormat } from '@/config/macros/formdetails';
import { ARCGIS_RESOLVE_OPTIONS, CSV_RESOLVE_OPTIONS, collapseRowWithPlan, IGNORED_COLUMN_KEY_SUFFIX, resolveHeaders } from './resolution';
import { aliasesFor } from './fields';
import { ColumnMapping } from './types';

/**
 * Reproductions for two correctness gaps surfaced in review. Both are written to FAIL against the
 * current implementation and to pass once the gap is closed. They exercise the real exported
 * resolution functions — no logic is reimplemented here.
 */

// ---------------------------------------------------------------------------
// BUG #4 — alias auto-detection is scope-blind, so a trees-only field can be
// populated from an alias-named column on the STEMS sheet (cross-sheet bleed).
//
// In ARCGIS_SCHEMA, `lx`/`ly` are scope:'trees' (local coordinates only exist on
// the trees sheet). resolveHeaders filters EXPLICIT mapping overrides by scope
// (resolution.ts:74 via fieldAppliesToSheet) but the alias-fill pass
// (resolution.ts:109-115) matches against a scopeless alias dictionary, so it
// has no way to know `lx` must not resolve on a stems-role sheet.
// ---------------------------------------------------------------------------
describe('BUG #4: alias fill ignores field scope (cross-sheet data bleed)', () => {
  const arcgisAliases = aliasesFor(SourceFormat.arcgis_xlsx);

  // A realistic seeded mapping: roles assigned, lx present but unclaimed (no explicit source
  // column) and correctly scoped to trees. The author's stated intent is "lx is trees-only".
  const mappingWithTreesOnlyLx: ColumnMapping = {
    version: 1,
    format: SourceFormat.arcgis_xlsx,
    sheetRoles: { treesSheetName: 'Trees', stemsSheetName: 'Stems' },
    fields: [{ canonicalField: 'lx', sourceColumns: [], scope: 'trees' }]
  };

  it('does NOT resolve trees-only lx from a LocalX column on the stems sheet', () => {
    // 'LocalX' is an lx alias (schema.ts:66-69). On the stems sheet this column belongs to
    // whatever the researcher put there — it must never be siphoned into the trees-only lx field.
    const stemsHeaders = ['LocalX', 'ParentGlobalID'];
    const stemsPlan = resolveHeaders(stemsHeaders, mappingWithTreesOnlyLx, arcgisAliases, { ...ARCGIS_RESOLVE_OPTIONS, sheetRole: 'stems' });

    const lxResolution = stemsPlan.resolutions.find(r => r.canonicalField === 'lx');

    // EXPECTED (correct): trees-only lx is never resolved on a stems-role sheet.
    // ACTUAL   (bug):     alias fill resolves index 0 to { kind:'alias', canonicalField:'lx' }
    //                     because alias matching does not consult scope.
    expect(lxResolution).toBeUndefined();
  });

  it('control — the SAME LocalX column legitimately feeds lx on the trees sheet', () => {
    // Proves the fixture actually flips on role: the only difference from the failing case is
    // sheetRole, so a green here + red above isolates the defect to scope-blind alias fill.
    const treesHeaders = ['LocalX', 'GlobalID'];
    const treesPlan = resolveHeaders(treesHeaders, mappingWithTreesOnlyLx, arcgisAliases, { ...ARCGIS_RESOLVE_OPTIONS, sheetRole: 'trees' });

    const lxResolution = treesPlan.resolutions.find(r => r.canonicalField === 'lx');
    expect(lxResolution?.kind).toBe('alias');
    expect(lxResolution?.rawHeader).toBe('LocalX');
  });
});

// ---------------------------------------------------------------------------
// BUG #5 — on the CSV path, columns the plan diverts to an inert `__ignored#i`
// key are NOT stripped before the row reaches validation. The XLSX reader drops
// ignored columns entirely (workbook-reader.ts:54-55), but collapseRowWithPlan
// only removes multi-source temp keys, so the ignored key (and its raw value)
// survives into the row that validateRow scans.
//
// validateRow (uploadfiresql.tsx:954-962) range-checks EVERY non-tag entry:
//     for (const [key, value] of Object.entries(row)) {
//       if (value !== null && !['tag','stemtag'].includes(key)) {
//         const num = parseFloat(value);
//         if (!isNaN(num) && (num < 0 || num > 999999.999999)) { errors.push(...) }
//       }
//     }
// so a diverted column carrying an out-of-range number rejects an otherwise-valid row.
// ---------------------------------------------------------------------------
describe('BUG #5: ignored CSV columns survive into the row handed to validation', () => {
  const csvAliases = aliasesFor(SourceFormat.csv);

  // Task 2 (strip ignored keys in collapseRowWithPlan) converts this back to a passing it().
  it.fails('collapseRowWithPlan drops the inert __ignored key so it cannot reach validateRow', () => {
    // Headers ['lx','MyX'] with lx explicitly mapped to MyX: the literal 'lx' column collides
    // with the mapping-owned 'lx' key and is diverted to `lx__ignored#0` (resolution.ts:101-121).
    const mapping: ColumnMapping = { version: 1, format: SourceFormat.csv, fields: [{ canonicalField: 'lx', sourceColumns: ['MyX'], scope: 'file' }] };
    const plan = resolveHeaders(['lx', 'MyX'], mapping, csvAliases, CSV_RESOLVE_OPTIONS);

    const divertedKey = plan.outputKeys[0];
    expect(divertedKey).toContain(IGNORED_COLUMN_KEY_SUFFIX); // sanity: column 0 was diverted, not mapped

    // A Papa row keyed by the plan's outputKeys. The diverted column happens to carry an
    // out-of-range numeric the user never intended to import; the real lx value is valid.
    const parsedRow = { [divertedKey]: '-5', lx: '12.5' };
    const collapsed = collapseRowWithPlan(parsedRow, plan);

    const leakedIgnoredKeys = Object.keys(collapsed).filter(k => k.includes(IGNORED_COLUMN_KEY_SUFFIX));

    // EXPECTED (correct): inert columns never flow downstream; validateRow only sees canonical keys.
    // ACTUAL   (bug):     `lx__ignored#0` (value '-5') survives, and validateRow's range check
    //                     (num < 0) will reject this otherwise-valid row into failedmeasurements.
    expect(leakedIgnoredKeys).toEqual([]);
  });
});
