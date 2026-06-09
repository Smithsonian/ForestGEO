import { describe, expect, it } from 'vitest';
import { SourceFormat } from '@/config/macros/formdetails';
import { joinMultiSourceValues, seedMapping, validateMapping } from './mapping';
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
});

describe('joinMultiSourceValues', () => {
  it('joins non-empty, non-NA values with ";"', () => {
    expect(joinMultiSourceValues(['LI', null, 'NA', 'DS'])).toBe('LI;DS');
    expect(joinMultiSourceValues([null, 'NA', ''])).toBeNull();
  });
});
