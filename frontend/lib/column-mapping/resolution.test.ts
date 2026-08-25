import { describe, expect, it } from 'vitest';
import { SourceFormat } from '@/config/macros/formdetails';
import { ARCGIS_RESOLVE_OPTIONS, CSV_RESOLVE_OPTIONS, collapseRowWithPlan, joinMultiSourceValues, resolveHeaders, transformHeaderFromPlan } from './resolution';
import { aliasesFor } from './fields';
import { ColumnMapping } from './types';

const csvMapping = (fields: ColumnMapping['fields']): ColumnMapping => ({ version: 1, format: SourceFormat.csv, fields });
const csvAliases = aliasesFor(SourceFormat.csv);

describe('resolveHeaders (csv, allowAliasFill: false)', () => {
  it('is total and index-aligned', () => {
    const m = csvMapping([{ canonicalField: 'lx', sourceColumns: ['MyX'], scope: 'file' }]);
    const plan = resolveHeaders(['MyX', 'DeviceID'], m, csvAliases, CSV_RESOLVE_OPTIONS);
    expect(plan.outputKeys).toEqual(['lx', 'deviceid']);
    expect(plan.resolutions.map(r => r.kind)).toEqual(['mapped', 'passthrough']);
  });

  it('mapped columns win regardless of order; the alias-named leftover is ignored', () => {
    const m = csvMapping([{ canonicalField: 'lx', sourceColumns: ['MyX'], scope: 'file' }]);
    const plan = resolveHeaders(['lx', 'MyX'], m, csvAliases, CSV_RESOLVE_OPTIONS);
    expect(plan.outputKeys[1]).toBe('lx');
    expect(plan.resolutions[0].kind).toBe('ignored');
    expect(plan.outputKeys[0]).not.toBe('lx');
  });

  it('never alias-fills for CSV: an unmapped alias-named column is ignored, not routed onto the field', () => {
    const m = csvMapping([
      { canonicalField: 'date', sourceColumns: [], scope: 'file' },
      { canonicalField: 'tag', sourceColumns: ['tag'], scope: 'file' }
    ]);
    const plan = resolveHeaders(['tag', 'Date'], m, csvAliases, CSV_RESOLVE_OPTIONS);
    expect(plan.resolutions[1].kind).toBe('ignored');
    expect(plan.outputKeys[1]).not.toBe('date');
  });

  it('emits temp keys for multi-source fields and records them in multiSourceTempKeys', () => {
    const m = csvMapping([{ canonicalField: 'codes', sourceColumns: ['Code1', 'Code2'], scope: 'file' }]);
    const plan = resolveHeaders(['Code1', 'Code2', 'tag'], m, csvAliases, CSV_RESOLVE_OPTIONS);
    expect(plan.outputKeys[0]).toBe('codes#0');
    expect(plan.outputKeys[1]).toBe('codes#1');
    expect(plan.multiSourceTempKeys.get('codes')).toEqual(['codes#0', 'codes#1']);
  });

  it('omits a multi-source field from multiSourceTempKeys when none of its sources are present', () => {
    const m = csvMapping([{ canonicalField: 'codes', sourceColumns: ['Code1', 'Code2'], scope: 'file' }]);
    const plan = resolveHeaders(['codes', 'tag'], m, csvAliases, CSV_RESOLVE_OPTIONS);
    expect(plan.multiSourceTempKeys.has('codes')).toBe(false);
    // the literal 'codes' header is NOT a mapping source; the mapping owns the 'codes' key → ignored
    expect(plan.resolutions[0].kind).toBe('ignored');
  });

  it('gives duplicate raw headers distinct resolutions (no last-wins)', () => {
    const m = csvMapping([{ canonicalField: 'date', sourceColumns: ['Date'], scope: 'file' }]);
    const plan = resolveHeaders(['Date', 'Date'], m, csvAliases, CSV_RESOLVE_OPTIONS);
    expect(plan.outputKeys[0]).toBe('date');
    expect(plan.resolutions[1].kind).toBe('ignored');
    expect(plan.outputKeys[1]).not.toBe('date');
  });
});

describe('resolveHeaders (arcgis, allowAliasFill: true)', () => {
  const arcgisAliases = aliasesFor(SourceFormat.arcgis_xlsx);
  const m: ColumnMapping = {
    version: 1,
    format: SourceFormat.arcgis_xlsx,
    fields: [{ canonicalField: 'tag', sourceColumns: ['TreeTag'], scope: 'both' }]
  };

  it('alias-fills keys the mapping did not claim on this header set', () => {
    // TreeTag absent here; the alias-named 'tag' column fills the unclaimed key
    const plan = resolveHeaders(['GlobalID', 'tag'], m, arcgisAliases, ARCGIS_RESOLVE_OPTIONS);
    expect(plan.outputKeys[1]).toBe('tag');
    expect(plan.resolutions[1].kind).toBe('alias');
  });

  it('alias never beats an explicit mapping present in the same header set', () => {
    const plan = resolveHeaders(['tag', 'TreeTag'], m, arcgisAliases, ARCGIS_RESOLVE_OPTIONS);
    expect(plan.outputKeys[1]).toBe('tag');
    expect(plan.resolutions[1].kind).toBe('mapped');
    expect(plan.resolutions[0].kind).toBe('ignored');
  });

  it('passes unknown headers through verbatim (trimmed) so COD_*/OBJECTID survive', () => {
    const plan = resolveHeaders([' COD_M ', 'OBJECTID'], m, arcgisAliases, ARCGIS_RESOLVE_OPTIONS);
    expect(plan.outputKeys).toEqual(['COD_M', 'OBJECTID']);
  });
});

describe('resolveHeaders (sheet-scoped explicit mappings)', () => {
  const arcgisAliases = aliasesFor(SourceFormat.arcgis_xlsx);

  it('a trees-scoped explicit mapping does not claim a same-named column on the stems sheet', () => {
    const mapping: ColumnMapping = {
      version: 1,
      format: SourceFormat.arcgis_xlsx,
      fields: [{ canonicalField: 'tag', sourceColumns: ['SharedLabel'], scope: 'trees' }]
    };
    const stemsPlan = resolveHeaders(['SharedLabel', 'GlobalID'], mapping, arcgisAliases, { ...ARCGIS_RESOLVE_OPTIONS, sheetRole: 'stems' });
    const claimed = stemsPlan.resolutions.find(r => r.canonicalField === 'tag' && r.kind === 'mapped');
    expect(claimed).toBeUndefined();
  });

  it('a trees-scoped explicit mapping STILL claims its column on the trees sheet', () => {
    const mapping: ColumnMapping = {
      version: 1,
      format: SourceFormat.arcgis_xlsx,
      fields: [{ canonicalField: 'tag', sourceColumns: ['SharedLabel'], scope: 'trees' }]
    };
    const treesPlan = resolveHeaders(['SharedLabel', 'GlobalID'], mapping, arcgisAliases, { ...ARCGIS_RESOLVE_OPTIONS, sheetRole: 'trees' });
    const claimed = treesPlan.resolutions.find(r => r.canonicalField === 'tag' && r.kind === 'mapped');
    expect(claimed?.rawHeader).toBe('SharedLabel');
  });

  it('a both-scoped explicit mapping claims on either sheet', () => {
    const mapping: ColumnMapping = {
      version: 1,
      format: SourceFormat.arcgis_xlsx,
      fields: [{ canonicalField: 'spcode', sourceColumns: ['Sp'], scope: 'both' }]
    };
    for (const role of ['trees', 'stems'] as const) {
      const plan = resolveHeaders(['Sp', 'GlobalID'], mapping, arcgisAliases, { ...ARCGIS_RESOLVE_OPTIONS, sheetRole: role });
      expect(plan.resolutions.find(r => r.canonicalField === 'spcode' && r.kind === 'mapped')?.rawHeader).toBe('Sp');
    }
  });

  it('no sheetRole means no filtering: every field scope contributes overrides (current behavior preserved)', () => {
    const mapping: ColumnMapping = {
      version: 1,
      format: SourceFormat.arcgis_xlsx,
      fields: [{ canonicalField: 'tag', sourceColumns: ['SharedLabel'], scope: 'trees' }]
    };
    const plan = resolveHeaders(['SharedLabel', 'GlobalID'], mapping, arcgisAliases, ARCGIS_RESOLVE_OPTIONS);
    expect(plan.resolutions.find(r => r.canonicalField === 'tag' && r.kind === 'mapped')?.rawHeader).toBe('SharedLabel');
  });
});

describe('transformHeaderFromPlan', () => {
  it('looks keys up by papaparse index', () => {
    const m = csvMapping([{ canonicalField: 'lx', sourceColumns: ['MyX'], scope: 'file' }]);
    const plan = resolveHeaders(['MyX', 'DeviceID'], m, csvAliases, CSV_RESOLVE_OPTIONS);
    const t = transformHeaderFromPlan(plan);
    expect(t('MyX', 0)).toBe('lx');
    expect(t('DeviceID', 1)).toBe('deviceid');
    expect(t('Surprise', 99)).toBe('surprise'); // out-of-plan fallback normalizes
  });
});

describe('collapseRowWithPlan', () => {
  const m = csvMapping([{ canonicalField: 'codes', sourceColumns: ['Code1', 'Code2'], scope: 'file' }]);

  it('joins emitted temp keys into the canonical field and deletes the temps', () => {
    const plan = resolveHeaders(['Code1', 'Code2', 'tag'], m, csvAliases, CSV_RESOLVE_OPTIONS);
    expect(collapseRowWithPlan({ 'codes#0': 'LI', 'codes#1': 'DS', tag: '1' }, plan)).toEqual({ codes: 'LI;DS', tag: '1' });
  });

  it('leaves rows untouched when the plan emitted no temp keys for the field', () => {
    const plan = resolveHeaders(['codes', 'tag'], m, csvAliases, CSV_RESOLVE_OPTIONS);
    expect(collapseRowWithPlan({ codes: 'LI;DS', tag: '1' }, plan)).toEqual({ codes: 'LI;DS', tag: '1' });
  });
});

describe('joinMultiSourceValues', () => {
  it('drops empties, NA, and the NULL literal; null when nothing survives', () => {
    expect(joinMultiSourceValues(['LI', null, 'NA', 'null', 'DS'])).toBe('LI;DS');
    expect(joinMultiSourceValues([null, 'NA', ''])).toBeNull();
  });
});

describe('resolveHeaders (degenerate / null mapping)', () => {
  it('degenerates to pure alias/passthrough resolution when mapping is null', () => {
    const plan = resolveHeaders(['lx', 'DeviceID'], null, csvAliases, { ...CSV_RESOLVE_OPTIONS, allowAliasFill: true });
    expect(plan.outputKeys).toEqual(['lx', 'deviceid']);
    expect(plan.resolutions[0].kind).toBe('alias');
  });
});
