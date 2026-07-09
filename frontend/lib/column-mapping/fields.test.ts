import { describe, expect, it } from 'vitest';
import { FormType, RequiredTableHeadersByFormType, SourceFormat, TableHeadersByFormType } from '@/config/macros/formdetails';
import { aliasesFor, canonicalFieldsFor, legacyCsvHeaderKey, makeLegacyCsvHeaderKey, normalizeHeader } from './fields';

describe('normalizeHeader', () => {
  it('lowercases, trims, and strips separators', () => {
    expect(normalizeHeader('  X_Coord ')).toBe('xcoord');
    expect(normalizeHeader('Local-X')).toBe('localx');
    expect(normalizeHeader('Stem Tag')).toBe('stemtag');
  });
});

describe('canonicalFieldsFor(csv)', () => {
  const fields = canonicalFieldsFor(SourceFormat.csv);

  it('lists the 12 CSV import fields', () => {
    // Order matches TableHeadersByFormType[measurements] (registry is source of truth; export-only fields excluded).
    expect(fields.map(f => f.canonicalField)).toEqual([
      'tag',
      'stemtag',
      'spcode',
      'quadrat',
      'lx',
      'ly',
      'dbh',
      'hom',
      'date',
      'codes',
      'comments',
      'publishedstemid'
    ]);
  });

  it('marks tag/spcode/quadrat/lx/ly/date required and the rest optional', () => {
    const required = fields.filter(f => f.required).map(f => f.canonicalField);
    expect(required).toEqual(['tag', 'spcode', 'quadrat', 'lx', 'ly', 'date']);
  });

  it('marks only codes as multiSource, all scope "file"', () => {
    expect(fields.filter(f => f.multiSource).map(f => f.canonicalField)).toEqual(['codes']);
    expect(fields.every(f => f.scope === 'file')).toBe(true);
  });
});

describe('canonicalFieldsFor(arcgis_xlsx)', () => {
  const fields = canonicalFieldsFor(SourceFormat.arcgis_xlsx);

  it('excludes the COD_* aggregate slot from mappable fields', () => {
    expect(fields.find(f => f.canonicalField === 'COD_*')).toBeUndefined();
  });

  it('scopes lx/ly to the trees sheet and ParentGlobalID to stems', () => {
    expect(fields.find(f => f.canonicalField === 'lx')?.scope).toBe('trees');
    expect(fields.find(f => f.canonicalField === 'ParentGlobalID')?.scope).toBe('stems');
    expect(fields.find(f => f.canonicalField === 'StemTag')?.required).toBe(true);
  });
});

describe('CSV field registry derivation', () => {
  it('mirrors formdetails: every CSV field exists in the measurements registry with matching requiredness', () => {
    const registry = new Map(TableHeadersByFormType[FormType.measurements].map(h => [h.label, h]));
    const required = new Set(RequiredTableHeadersByFormType[FormType.measurements].map(h => h.label));
    for (const def of canonicalFieldsFor(SourceFormat.csv)) {
      expect(registry.has(def.canonicalField), `${def.canonicalField} missing from formdetails`).toBe(true);
      expect(def.required, `${def.canonicalField} requiredness`).toBe(required.has(def.canonicalField));
      expect(def.explanation).toBe(registry.get(def.canonicalField)!.explanation);
    }
  });

  it('excludes export-only fields', () => {
    const keys = canonicalFieldsFor(SourceFormat.csv).map(d => d.canonicalField);
    expect(keys).not.toContain('measurementID');
    expect(keys).not.toContain('errors');
  });
});

describe('aliasesFor(csv)', () => {
  it('maps known aliases to canonical fields (exact normalized, ported from transformHeader)', () => {
    const csv = aliasesFor(SourceFormat.csv);
    expect(csv['lx']).toEqual(expect.arrayContaining(['lx', 'localx', 'x', 'xcoord']));
    expect(csv['hom']).toEqual(expect.arrayContaining(['hom', 'height', 'heightofmeasurement']));
    expect(csv['stemtag']).toEqual(expect.arrayContaining(['stemtag', 'stem']));
  });

  it('aliases only unambiguous SI headers to publishedstemid', () => {
    const csv = aliasesFor(SourceFormat.csv);
    expect(csv['publishedstemid']).toEqual(expect.arrayContaining(['publishedstemid', 'si_stemid', 'ctfs_stemid']));
  });

  it("does NOT alias a bare stemid/StemID header to publishedstemid (collides with the app's own StemGUID export label)", () => {
    // The measurements grid and CSV/form exports label internal StemGUID as "stemID"; auto-mapping that
    // header to publishedstemid on re-upload would feed StemGUID into the SI identifier. See fields.ts.
    const csv = aliasesFor(SourceFormat.csv);
    for (const aliases of Object.values(csv)) {
      expect(aliases).not.toContain(normalizeHeader('StemID'));
      expect(aliases).not.toContain('stemid');
    }
  });
});

describe('legacyCsvHeaderKey', () => {
  // Iterates the real CSV alias map (via aliasesFor) so the legacy lookup cannot drift from CSV_ALIASES.
  it('maps every alias of every CSV field to its canonical field', () => {
    const csvAliases = aliasesFor(SourceFormat.csv);
    for (const [canonicalField, aliases] of Object.entries(csvAliases)) {
      for (const alias of aliases) {
        expect(legacyCsvHeaderKey(alias), `alias "${alias}" of field "${canonicalField}"`).toBe(canonicalField);
      }
    }
  });

  it('renames raw (un-normalized) header variants to the canonical field', () => {
    expect(legacyCsvHeaderKey('Tree_Tag')).toBe('tag');
    expect(legacyCsvHeaderKey(' Local X ')).toBe('lx');
    expect(legacyCsvHeaderKey('Species-Code')).toBe('spcode');
    expect(legacyCsvHeaderKey('Notes')).toBe('comments');
  });

  it('passes unknown headers through normalized (lowercase, no whitespace/underscore/hyphen)', () => {
    expect(legacyCsvHeaderKey('Device_ID')).toBe('deviceid');
  });
});

describe('makeLegacyCsvHeaderKey (form-aware legacy transform)', () => {
  // The CSV alias dictionary is measurements-specific. A measurements file that names its species-code
  // column "species"/"sp" should still resolve to spcode, so measurements keeps the aliases.
  it('for the measurements form, applies the CSV aliases', () => {
    const key = makeLegacyCsvHeaderKey(FormType.measurements);
    expect(key('species')).toBe('spcode');
    expect(key('sp')).toBe('spcode');
    expect(key('Notes')).toBe('comments');
  });

  // Regression: the species-definition form's `species` column is the epithet — a distinct required
  // field, NOT the species code. Applying the measurements alias hijacked it into `spcode`, colliding
  // with the real `spcode` column and dropping SpeciesName. It must stay its own field.
  it('for the species form, does NOT hijack the `species` epithet into `spcode`', () => {
    const key = makeLegacyCsvHeaderKey(FormType.species);
    expect(key('species')).toBe('species');
    expect(key('spcode')).toBe('spcode');
  });

  it('for the species form, passes taxonomy headers through normalized without measurements aliasing', () => {
    const key = makeLegacyCsvHeaderKey(FormType.species);
    expect(key('family')).toBe('family');
    expect(key('genus')).toBe('genus');
    expect(key('subspecies')).toBe('subspecies');
    expect(key('idlevel')).toBe('idlevel');
    expect(key('authority')).toBe('authority');
    expect(key(' Sub-Species ')).toBe('subspecies');
  });
});
