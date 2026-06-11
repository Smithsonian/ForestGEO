import { describe, expect, it } from 'vitest';
import { SourceFormat } from '@/config/macros/formdetails';
import {
  chooseEffectiveCsvMapping,
  HEADER_SIGNATURE_VERSION,
  headerSignature,
  isColumnMappingShape,
  joinMultiSourceValues,
  mappingApplies,
  mappingMatchesSource,
  seedMapping,
  validateMapping
} from './mapping';
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

  it('flags a canonical field that does not exist in the format schema', () => {
    const headers = ['tag', 'spcode', 'quadrat', 'lx', 'ly', 'date'];
    const m = seedMapping(csvMeta(headers));
    expect(validateMapping(m, csvMeta(headers)).valid).toBe(true); // baseline: only the bogus field below invalidates
    const withBogusField = {
      ...m,
      fields: [...m.fields, { canonicalField: 'not_a_real_field', sourceColumns: [] as string[], scope: 'file' as const }]
    };
    const v = validateMapping(withBogusField, csvMeta(headers));
    expect(v.unknownFields).toContain('not_a_real_field');
    expect(v.valid).toBe(false);
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

describe('validateMapping (scope-aware resolution matches the reader)', () => {
  // Same-name-per-sheet collision: on the stems sheet the column literally named 'GlobalID' is the
  // PARENT link (the stem's own id lives in 'ObjectID'), while on the trees sheet 'GlobalID' is the
  // tree's own id. Scoping ParentGlobalID's explicit source to the stems sheet is exactly what
  // keeps that override from claiming the trees sheet's 'GlobalID' header. Without sheetRole
  // threading in validateMapping, the override cross-claims and 'GlobalID (trees sheet)' is
  // falsely reported missing.
  const meta: ArcgisSourceMetadata = {
    format: SourceFormat.arcgis_xlsx,
    sheets: [
      { name: 'TreesSheet', columns: ['GlobalID', 'tag', 'StemTag', 'spcode', 'quadrat', 'lx', 'ly', 'Date_measured'] },
      { name: 'StemsSheet', columns: ['ObjectID', 'GlobalID', 'tag', 'StemTag', 'spcode', 'quadrat', 'Date_measured'] }
    ],
    detectedTreesSheet: 'TreesSheet',
    detectedStemsSheet: 'StemsSheet'
  };

  it('a stems-scoped override on a column name shared with the trees sheet does not break trees validation', () => {
    const m = seedMapping(meta);
    const withScopedParentLink = {
      ...m,
      fields: m.fields.map(f =>
        f.canonicalField === 'ParentGlobalID'
          ? { ...f, sourceColumns: ['GlobalID'] }
          : f.canonicalField === 'GlobalID'
            ? { ...f, sourceColumns: ['ObjectID'] }
            : f
      )
    };
    const v = validateMapping(withScopedParentLink, meta);
    expect(v.missingRequired).toEqual([]);
    expect(v.valid).toBe(true);
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

  it('rejects a field carrying an unrecognized scope (which would otherwise silently scope it out of every role-resolved sheet) but accepts valid and omitted scopes', () => {
    const withScope = (scope: unknown) => ({
      version: 1,
      format: SourceFormat.arcgis_xlsx,
      fields: [{ canonicalField: 'lx', sourceColumns: ['MyX'], scope }]
    });
    expect(isColumnMappingShape(withScope('TREES'))).toBe(false);
    expect(isColumnMappingShape(withScope('tree'))).toBe(false);
    expect(isColumnMappingShape(withScope(3))).toBe(false);
    expect(isColumnMappingShape(withScope('trees'))).toBe(true);
    expect(isColumnMappingShape(withScope('both'))).toBe(true);
    expect(isColumnMappingShape(withScope(undefined))).toBe(true);
    expect(isColumnMappingShape({ version: 1, format: SourceFormat.arcgis_xlsx, fields: [{ canonicalField: 'lx', sourceColumns: ['MyX'] }] })).toBe(true);
  });
});

describe('joinMultiSourceValues re-export', () => {
  it('is re-exported from resolution for existing consumers', () => {
    expect(joinMultiSourceValues(['LI', 'NA'])).toBe('LI');
  });
});

describe('mapping identity', () => {
  it('seedMapping stamps the header signature of its source metadata', () => {
    const m = seedMapping(csvMeta(['Tag', 'X_Coord']));
    expect(m.headerSignature).toBe(headerSignature(['Tag', 'X_Coord']));
    expect(m.headerSignature).toBe(headerSignature(['TAG', 'x_coord'])); // case/separator-insensitive
    expect(m.headerSignature).not.toBe(headerSignature(['x_coord', 'TAG'])); // but order-sensitive
  });

  it('mappingApplies rejects a mapping built from different headers', () => {
    const m = seedMapping(csvMeta(['TreeNo', 'X_Coord']));
    expect(mappingApplies(m, ['TreeNo', 'X_Coord'])).toBe(true);
    expect(mappingApplies(m, ['tag', 'TreeNo', 'X_Coord'])).toBe(false);
  });

  it('isColumnMappingShape accepts an optional string headerSignature and rejects non-strings', () => {
    const base = seedMapping(csvMeta(['tag']));
    expect(isColumnMappingShape(JSON.parse(JSON.stringify(base)))).toBe(true);
    expect(isColumnMappingShape({ ...base, headerSignature: 42 })).toBe(false);
  });
});

describe('mappingMatchesSource (seed round-trip)', () => {
  it('a freshly seeded ArcGIS mapping matches its own source (shared cross-sheet columns)', () => {
    const metadata = {
      format: SourceFormat.arcgis_xlsx as const,
      sheets: [
        { name: 'Trees', columns: ['GlobalID', 'TreeTag', 'StemTag', 'Sp', 'Q', 'lx', 'ly', 'When'] },
        { name: 'Stems', columns: ['GlobalID', 'ParentGlobalID', 'TreeTag', 'StemTag', 'Sp', 'Q', 'When'] }
      ]
    };
    const seeded = seedMapping(metadata);
    expect(mappingMatchesSource(seeded, metadata)).toBe(true);
  });

  it('a freshly seeded CSV mapping matches its own source', () => {
    const metadata = { format: SourceFormat.csv as const, headers: ['tag', 'spcode', 'quadrat', 'lx', 'ly', 'date'] };
    const seeded = seedMapping(metadata);
    expect(mappingMatchesSource(seeded, metadata)).toBe(true);
  });

  it('does not match when the source columns differ', () => {
    const metadata = { format: SourceFormat.csv as const, headers: ['tag', 'spcode'] };
    const seeded = seedMapping(metadata);
    expect(mappingMatchesSource(seeded, { format: SourceFormat.csv as const, headers: ['tag', 'spcode', 'extra'] })).toBe(false);
  });
});

describe('headerSignature (positional identity)', () => {
  it('distinguishes duplicate headers from a single header', () => {
    expect(headerSignature(['tag', 'tag'])).not.toEqual(headerSignature(['tag']));
  });
  it('is order-sensitive', () => {
    expect(headerSignature(['a', 'b'])).not.toEqual(headerSignature(['b', 'a']));
  });
  it('keeps blank header positions instead of dropping them', () => {
    expect(headerSignature(['tag', '', 'spcode'])).not.toEqual(headerSignature(['tag', 'spcode']));
  });
  it('carries a version prefix so a version bump invalidates old signatures', () => {
    expect(HEADER_SIGNATURE_VERSION).toBe(3);
    expect(headerSignature(['tag']).startsWith(`v${HEADER_SIGNATURE_VERSION}:`)).toBe(true);
  });
  it('distinguishes a literal sentinel header from a genuine blank column (no token collision)', () => {
    // A header that normalizes to the old '∅' sentinel must not be indistinguishable from a blank
    // position. Content tokens are namespaced 'c<norm>' and blank positions 'b', so they stay disjoint.
    expect(headerSignature(['∅'])).not.toBe(headerSignature(['']));
  });
  it('does not collide when a header literally contains the separator-prone pipe character', () => {
    expect(headerSignature(['a|b'])).not.toEqual(headerSignature(['a', 'b']));
  });
  it('still round-trips through seedMapping/mappingApplies for identical headers', () => {
    const headers = ['Tag', 'Sp_Code', 'Quadrat'];
    const mapping = seedMapping({ format: SourceFormat.csv, headers });
    expect(mappingApplies(mapping, headers)).toBe(true);
    expect(mappingApplies(mapping, ['Tag', 'Sp_Code'])).toBe(false);
  });
});

describe('chooseEffectiveCsvMapping (upload-time revalidation)', () => {
  const headers = ['tag', 'spcode', 'quadrat', 'lx', 'ly', 'dbh', 'hom', 'date'];

  it('uses a valid, applicable stored mapping unchanged', () => {
    const stored = seedMapping({ format: SourceFormat.csv, headers });
    const result = chooseEffectiveCsvMapping(stored, headers);
    expect(result.usedStored).toBe(true);
    expect(result.reasonCode).toBeUndefined();
    expect(result.mapping).toBe(stored);
  });

  it('falls back to a seed with a stale code when the stored signature does not match', () => {
    const stored = seedMapping({ format: SourceFormat.csv, headers: ['totally', 'different'] });
    const result = chooseEffectiveCsvMapping(stored, headers);
    expect(result.usedStored).toBe(false);
    expect(result.reasonCode).toBe('stale');
  });

  it('falls back to a seed with an invalid code when an applicable stored mapping fails validation', () => {
    const stored = seedMapping({ format: SourceFormat.csv, headers });
    const broken = { ...stored, fields: stored.fields.map(f => (f.canonicalField === 'tag' ? { ...f, sourceColumns: [] as string[] } : f)) };
    const result = chooseEffectiveCsvMapping(broken, headers);
    expect(result.usedStored).toBe(false);
    expect(result.reasonCode).toBe('invalid');
  });

  it('seeds with no reasonCode when there is no stored mapping', () => {
    const result = chooseEffectiveCsvMapping(undefined, headers);
    expect(result.usedStored).toBe(false);
    expect(result.reasonCode).toBeUndefined();
  });
});
