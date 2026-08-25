import { describe, expect, it } from 'vitest';
import Papa from 'papaparse';
import { FormType } from '@/config/macros/formdetails';
import { makeLegacyCsvHeaderKey } from './fields';

// End-to-end guard for the species-upload header collision. A taxonomy CSV declares BOTH a `spcode`
// column (the code) and a `species` column (the epithet). The legacy transform used to alias
// `species -> spcode`, so papaparse saw two `spcode` columns, renamed the second to a phantom
// `spcode1` nothing reads, and the epithet was lost (SpeciesName written NULL). This parses exactly as
// the upload does (Papa.parse with the form's transformHeader) and asserts both columns survive.
const TAXONOMY_CSV = [
  'spcode,family,genus,species,idlevel,authority',
  'CALAME,Lamiaceae,Callicarpa,americana,species,L.',
  'CARTEX,Juglandaceae,Carya,texana,species,Buckley'
].join('\n');

describe('species upload header parsing (Papa.parse with the species transform)', () => {
  it('keeps `spcode` and `species` as separate columns (no collision, no phantom rename)', () => {
    const result = Papa.parse<Record<string, string>>(TAXONOMY_CSV, {
      header: true,
      skipEmptyLines: true,
      transformHeader: makeLegacyCsvHeaderKey(FormType.species)
    });

    expect(result.meta.fields).toEqual(['spcode', 'family', 'genus', 'species', 'idlevel', 'authority']);
    expect(result.meta.fields).not.toContain('spcode1');

    const first = result.data[0];
    // SpeciesCode <- row.spcode, SpeciesName <- row.species (see upsertSpeciesRows).
    expect(first.spcode).toBe('CALAME');
    expect(first.species).toBe('americana');
    expect(first.genus).toBe('Callicarpa');
    expect(first.family).toBe('Lamiaceae');
  });

  it('still collapses `species` into `spcode` for a measurements upload (alias is correct there)', () => {
    const measurementsCsv = ['tag,species,quadrat,lx,ly,date', '1,CALAME,0101,1.0,2.0,2026-01-12'].join('\n');
    const result = Papa.parse<Record<string, string>>(measurementsCsv, {
      header: true,
      skipEmptyLines: true,
      transformHeader: makeLegacyCsvHeaderKey(FormType.measurements)
    });

    expect(result.meta.fields).toContain('spcode');
    expect(result.data[0].spcode).toBe('CALAME');
  });
});
