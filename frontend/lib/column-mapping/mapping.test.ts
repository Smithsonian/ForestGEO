import { describe, expect, it } from 'vitest';
import { SourceFormat } from '@/config/macros/formdetails';
import { buildPapaTransformHeader, collapseMultiSourceRow, isColumnMappingShape, joinMultiSourceValues, seedMapping, validateMapping } from './mapping';
import { ArcgisSourceMetadata, CsvSourceMetadata } from './types';

const csvMeta = (headers: string[]): CsvSourceMetadata => ({ format: SourceFormat.csv, headers });

describe('seedMapping (csv)', () => {
  it('maps known aliases exactly and leaves unknown headers unmapped', () => {
    const m = seedMapping(csvMeta(['TreeNo', 'X_Coord', 'Y_Coord', 'Sp', 'Q20', 'POM', 'MeasDate']));
    const src = (f: string) => m.fields.find(x => x.canonicalField === f)?.sourceColumns ?? [];
    expect(src('lx')).toEqual(['X_Coord']);
    expect(src('ly')).toEqual(['Y_Coord']);
    expect(src('spcode')).toEqual(['Sp']);
    expect(src('quadrat')).toEqual([]); // Q20 is not an alias of quadrat
    expect(src('hom')).toEqual([]); // POM has no alias
    expect(src('tag')).toEqual([]); // TreeNo is not an alias of tag
  });

  it('never lets tag claim a stemtag column (no substring match)', () => {
    const m = seedMapping(csvMeta(['stemtag']));
    expect(m.fields.find(x => x.canonicalField === 'tag')?.sourceColumns).toEqual([]);
    expect(m.fields.find(x => x.canonicalField === 'stemtag')?.sourceColumns).toEqual(['stemtag']);
  });

  it('collects multiple source columns for codes', () => {
    const m = seedMapping(csvMeta(['Code1', 'Code2', 'codes']));
    // only exact-normalized alias members match; 'code1'/'code2' are NOT aliases, 'codes' is
    expect(m.fields.find(x => x.canonicalField === 'codes')?.sourceColumns).toEqual(['codes']);
  });
});

describe('validateMapping duplicate source columns', () => {
  it('flags the same source column mapped to two different fields', () => {
    const headers = ['X_Coord', 'tag', 'spcode', 'quadrat', 'date'];
    const m = seedMapping(csvMeta(headers));
    const withDuplicate = {
      ...m,
      fields: m.fields.map(f => (f.canonicalField === 'lx' || f.canonicalField === 'ly' ? { ...f, sourceColumns: ['X_Coord'] } : f))
    };
    const v = validateMapping(withDuplicate, csvMeta(headers));
    expect(v.duplicateSourceColumns).toContain('X_Coord');
    expect(v.valid).toBe(false);
  });

  it('flags the same column listed twice within one multi-source field', () => {
    const headers = ['Code1', 'tag', 'spcode', 'quadrat', 'lx', 'ly', 'date'];
    const m = seedMapping(csvMeta(headers));
    const withDuplicate = {
      ...m,
      fields: m.fields.map(f => (f.canonicalField === 'codes' ? { ...f, sourceColumns: ['Code1', 'Code1'] } : f))
    };
    const v = validateMapping(withDuplicate, csvMeta(headers));
    expect(v.duplicateSourceColumns).toContain('Code1');
    expect(v.valid).toBe(false);
  });
});

describe('validateMapping (csv)', () => {
  it('flags an unmapped required field as invalid', () => {
    const m = seedMapping(csvMeta(['X_Coord', 'Y_Coord', 'Sp', 'quadrat', 'date'])); // no tag
    const v = validateMapping(m, csvMeta(['X_Coord', 'Y_Coord', 'Sp', 'quadrat', 'date']));
    expect(v.missingRequired).toContain('tag');
    expect(v.valid).toBe(false);
  });

  it('flags a mapped source column absent from the file', () => {
    const m = seedMapping(csvMeta(['tag', 'spcode', 'quadrat', 'lx', 'ly', 'date']));
    const v = validateMapping(m, csvMeta(['tag', 'spcode', 'quadrat', 'lx', 'ly'])); // date column removed
    expect(v.missingSourceColumns).toContain('date');
  });

  it('reports ignored source columns', () => {
    const m = seedMapping(csvMeta(['tag', 'spcode', 'quadrat', 'lx', 'ly', 'date', 'DeviceID']));
    const v = validateMapping(m, csvMeta(['tag', 'spcode', 'quadrat', 'lx', 'ly', 'date', 'DeviceID']));
    expect(v.ignoredSourceColumns).toContain('DeviceID');
    expect(v.valid).toBe(true);
  });
});

describe('validateMapping (arcgis sheet roles)', () => {
  const meta: ArcgisSourceMetadata = {
    format: SourceFormat.arcgis_xlsx,
    sheets: [
      { name: 'Sheet1', columns: ['GlobalID', 'tag', 'StemTag', 'spcode', 'quadrat', 'lx', 'ly', 'Date_measured'] },
      { name: 'Sheet2', columns: ['GlobalID', 'ParentGlobalID', 'tag', 'StemTag', 'spcode', 'quadrat', 'Date_measured'] }
    ]
  };

  it('requires sheet roles when none detected', () => {
    const m = seedMapping(meta);
    const v = validateMapping(m, meta);
    expect(v.missingSheetRoles).toEqual(expect.arrayContaining(['trees', 'stems']));
    expect(v.valid).toBe(false);
  });

  it('is valid once sheet roles are set and required fields resolve', () => {
    const m = seedMapping({ ...meta, detectedTreesSheet: 'Sheet1', detectedStemsSheet: 'Sheet2' });
    const v = validateMapping(m, { ...meta, detectedTreesSheet: 'Sheet1', detectedStemsSheet: 'Sheet2' });
    expect(v.missingSheetRoles ?? []).toEqual([]);
    expect(v.valid).toBe(true);
  });

  it('rejects the same sheet assigned to both roles', () => {
    const detected = { ...meta, detectedTreesSheet: 'Sheet1', detectedStemsSheet: 'Sheet1' };
    const m = seedMapping(detected);
    const v = validateMapping(m, detected);
    expect(v.sheetRoleConflict).toBe(true);
    expect(v.valid).toBe(false);
  });
});

describe('validateMapping (arcgis per-sheet scope)', () => {
  // lx/ly are trees-scoped required fields in ARCGIS_SCHEMA; tag is required on both sheets.
  const sheets = [
    { name: 'TreesSheet', columns: ['GlobalID', 'tag', 'StemTag', 'spcode', 'quadrat', 'Date_measured'] },
    { name: 'StemsSheet', columns: ['GlobalID', 'ParentGlobalID', 'tag', 'StemTag', 'spcode', 'quadrat', 'Date_measured', 'PosX', 'PosY'] }
  ];
  const meta: ArcgisSourceMetadata = {
    format: SourceFormat.arcgis_xlsx,
    sheets,
    detectedTreesSheet: 'TreesSheet',
    detectedStemsSheet: 'StemsSheet'
  };

  it('rejects a trees-scoped required field mapped to a column that exists only on the stems sheet', () => {
    const m = seedMapping(meta);
    const withCrossSheet = {
      ...m,
      fields: m.fields.map(f =>
        f.canonicalField === 'lx' ? { ...f, sourceColumns: ['PosX'] } : f.canonicalField === 'ly' ? { ...f, sourceColumns: ['PosY'] } : f
      )
    };
    const v = validateMapping(withCrossSheet, meta);
    expect(v.missingRequired.some(entry => entry.includes('lx'))).toBe(true);
    expect(v.valid).toBe(false);
  });

  it('accepts a trees-scoped required field mapped to a column on the trees sheet', () => {
    const treesWithCoords = [{ name: 'TreesSheet', columns: [...sheets[0].columns, 'PosX', 'PosY'] }, sheets[1]];
    const metaWithCoords: ArcgisSourceMetadata = { ...meta, sheets: treesWithCoords };
    const m = seedMapping(metaWithCoords);
    const mapped = {
      ...m,
      fields: m.fields.map(f =>
        f.canonicalField === 'lx' ? { ...f, sourceColumns: ['PosX'] } : f.canonicalField === 'ly' ? { ...f, sourceColumns: ['PosY'] } : f
      )
    };
    const v = validateMapping(mapped, metaWithCoords);
    expect(v.missingRequired).toEqual([]);
    expect(v.valid).toBe(true);
  });

  it('treats both-scoped fields present on each sheet as satisfied, flagging only the truly missing trees fields', () => {
    // tag/spcode/quadrat/etc. exist on both sheets; only lx/ly (trees scope) are genuinely
    // unmappable here, so they must be the only complaints.
    const m = seedMapping(meta);
    const v = validateMapping(m, meta);
    expect(v.missingRequired.length).toBeGreaterThan(0);
    expect(v.missingRequired.every(entry => entry.startsWith('lx') || entry.startsWith('ly'))).toBe(true);
  });
});

describe('buildPapaTransformHeader', () => {
  it('renames single-source headers to canonical and gives multi-source temp keys', () => {
    const m = seedMapping(csvMeta(['X_Coord', 'Y_Coord', 'tag', 'spcode', 'quadrat', 'date']));
    const t = buildPapaTransformHeader(m);
    expect(t('X_Coord')).toBe('lx');
    expect(t('Y_Coord')).toBe('ly');
    expect(t('DeviceID')).toBe('deviceid'); // unmapped -> normalized fallback
  });

  it('never lets an unmapped column emit a canonical key claimed by the mapping', () => {
    // User explicitly mapped MeasDate -> date; the file also has a raw 'Date' column the
    // dialog reports as ignored. Its fallback key must NOT collide with 'date', or papaparse
    // last-column-wins silently replaces the mapped value.
    const m: ReturnType<typeof seedMapping> = {
      version: 1,
      format: SourceFormat.csv,
      fields: [{ canonicalField: 'date', sourceColumns: ['MeasDate'], scope: 'file' }]
    };
    const t = buildPapaTransformHeader(m);
    expect(t('MeasDate')).toBe('date');
    expect(t('Date')).not.toBe('date');
  });

  it('never lets an unmapped column emit a canonical key the user deliberately left unmapped', () => {
    // The mapping is the authority: if the user unmapped 'date', a stray 'Date' column must
    // not silently feed it.
    const m: ReturnType<typeof seedMapping> = {
      version: 1,
      format: SourceFormat.csv,
      fields: [
        { canonicalField: 'date', sourceColumns: [], scope: 'file' },
        { canonicalField: 'tag', sourceColumns: ['tag'], scope: 'file' }
      ]
    };
    const t = buildPapaTransformHeader(m);
    expect(t('Date')).not.toBe('date');
  });

  it('emits distinct temp keys for multi-source codes', () => {
    const m: ReturnType<typeof seedMapping> = {
      version: 1,
      format: SourceFormat.csv,
      fields: [{ canonicalField: 'codes', sourceColumns: ['Code1', 'Code2'], scope: 'file' }]
    };
    const t = buildPapaTransformHeader(m);
    expect(t('Code1')).toBe('codes#0');
    expect(t('Code2')).toBe('codes#1');
  });
});

describe('collapseMultiSourceRow', () => {
  it('joins temp keys into the canonical codes field and removes temps', () => {
    const m = {
      version: 1 as const,
      format: SourceFormat.csv,
      fields: [{ canonicalField: 'codes', sourceColumns: ['Code1', 'Code2'], scope: 'file' as const }]
    };
    const row = { 'codes#0': 'LI', 'codes#1': 'DS', tag: '100001' };
    expect(collapseMultiSourceRow(row, m)).toEqual({ codes: 'LI;DS', tag: '100001' });
  });

  it('leaves a row untouched when none of the multi-source temp keys are present', () => {
    // A file whose 'codes' column is already canonical never produced codes#0/codes#1 temp
    // keys; collapsing must not overwrite its real value with null.
    const m = {
      version: 1 as const,
      format: SourceFormat.csv,
      fields: [{ canonicalField: 'codes', sourceColumns: ['Code1', 'Code2'], scope: 'file' as const }]
    };
    const row = { codes: 'LI;DS', tag: '100001' };
    expect(collapseMultiSourceRow(row, m)).toEqual({ codes: 'LI;DS', tag: '100001' });
  });

  it('collapses to null when temp keys are present but empty', () => {
    const m = {
      version: 1 as const,
      format: SourceFormat.csv,
      fields: [{ canonicalField: 'codes', sourceColumns: ['Code1', 'Code2'], scope: 'file' as const }]
    };
    const row = { 'codes#0': null, 'codes#1': '', tag: '100001' };
    expect(collapseMultiSourceRow(row, m)).toEqual({ codes: null, tag: '100001' });
  });

  it('is a no-op when there are no multi-source fields', () => {
    const m = { version: 1 as const, format: SourceFormat.csv, fields: [{ canonicalField: 'lx', sourceColumns: ['X'], scope: 'file' as const }] };
    const row = { lx: '202', ly: '104.5' };
    expect(collapseMultiSourceRow(row, m)).toEqual({ lx: '202', ly: '104.5' });
  });
});

describe('isColumnMappingShape', () => {
  it('accepts a structurally valid mapping', () => {
    const m = seedMapping(csvMeta(['tag', 'spcode', 'quadrat', 'lx', 'ly', 'date']));
    expect(isColumnMappingShape(m)).toBe(true);
    expect(isColumnMappingShape(JSON.parse(JSON.stringify(m)))).toBe(true);
  });

  it('rejects non-objects, wrong field containers, and fields missing sourceColumns', () => {
    expect(isColumnMappingShape(null)).toBe(false);
    expect(isColumnMappingShape('csv')).toBe(false);
    expect(isColumnMappingShape([1, 2])).toBe(false);
    expect(isColumnMappingShape({ version: 1, format: SourceFormat.csv, fields: {} })).toBe(false);
    expect(isColumnMappingShape({ version: 1, format: SourceFormat.csv, fields: [{ canonicalField: 'lx' }] })).toBe(false);
    expect(isColumnMappingShape({ version: 1, format: SourceFormat.csv, fields: [{ canonicalField: 'lx', sourceColumns: [42] }] })).toBe(false);
    expect(isColumnMappingShape({ version: 1, format: 'parquet', fields: [] })).toBe(false);
    expect(isColumnMappingShape({ version: 1, format: SourceFormat.arcgis_xlsx, fields: [], sheetRoles: 'Sheet1' })).toBe(false);
  });
});

describe('joinMultiSourceValues', () => {
  it('joins non-empty, non-NA values with ";"', () => {
    expect(joinMultiSourceValues(['LI', null, 'NA', 'DS'])).toBe('LI;DS');
    expect(joinMultiSourceValues([null, 'NA', ''])).toBeNull();
  });
});
