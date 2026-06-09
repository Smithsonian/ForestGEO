import { describe, expect, it } from 'vitest';
import { FormType, RequiredTableHeadersByFormType, SourceFormat, TableHeadersByFormType } from '@/config/macros/formdetails';
import { aliasesFor, canonicalFieldsFor, normalizeHeader } from './fields';

describe('normalizeHeader', () => {
  it('lowercases, trims, and strips separators', () => {
    expect(normalizeHeader('  X_Coord ')).toBe('xcoord');
    expect(normalizeHeader('Local-X')).toBe('localx');
    expect(normalizeHeader('Stem Tag')).toBe('stemtag');
  });
});

describe('canonicalFieldsFor(csv)', () => {
  const fields = canonicalFieldsFor(SourceFormat.csv);

  it('lists the 11 CSV import fields', () => {
    // Order matches TableHeadersByFormType[measurements] (registry is source of truth; export-only fields excluded).
    expect(fields.map(f => f.canonicalField)).toEqual(['tag', 'stemtag', 'spcode', 'quadrat', 'lx', 'ly', 'dbh', 'hom', 'date', 'codes', 'comments']);
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
});
