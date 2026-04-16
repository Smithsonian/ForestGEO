import { describe, expect, it } from 'vitest';
import { canonicalizeRevisionRow, normalizeRevisionHeader } from './revisionfileparse';

describe('normalizeRevisionHeader', () => {
  it('normalizes canonical revision headers and View Data export aliases to the same short-form keys', () => {
    expect(normalizeRevisionHeader('StemGUID')).toBe('stemid');
    expect(normalizeRevisionHeader('stemID')).toBe('stemid');
    expect(normalizeRevisionHeader('TreeTag')).toBe('tag');
    expect(normalizeRevisionHeader('StemTag')).toBe('stemtag');
    expect(normalizeRevisionHeader('SpeciesCode')).toBe('spcode');
    expect(normalizeRevisionHeader('QuadratName')).toBe('quadrat');
    expect(normalizeRevisionHeader('StemLocalX')).toBe('lx');
    expect(normalizeRevisionHeader('StemLocalY')).toBe('ly');
    expect(normalizeRevisionHeader('MeasuredDBH')).toBe('dbh');
    expect(normalizeRevisionHeader('MeasuredHOM')).toBe('hom');
    expect(normalizeRevisionHeader('MeasurementDate')).toBe('date');
    expect(normalizeRevisionHeader('Description')).toBe('comments');
  });

  it('keeps raw and display code columns distinct until row canonicalization chooses one', () => {
    expect(normalizeRevisionHeader('RawCodes')).toBe('rawcodes');
    expect(normalizeRevisionHeader('Attributes')).toBe('attributes');
    expect(normalizeRevisionHeader('codes')).toBe('codes');
  });
});

describe('canonicalizeRevisionRow', () => {
  it('converts app export NULL placeholders to null across all columns so unedited exports round-trip without fake diffs', () => {
    expect(
      canonicalizeRevisionRow({
        stemid: '5283365',
        dbh: 'NULL',
        hom: 'NULL',
        date: 'NULL',
        lx: 'NULL',
        ly: 'NULL',
        comments: 'NULL',
        codes: 'NULL',
        spcode: 'NULL',
        quadrat: 'NULL',
        tag: 'NULL',
        stemtag: 'NULL'
      })
    ).toEqual({
      stemid: '5283365',
      dbh: null,
      hom: null,
      date: null,
      lx: null,
      ly: null,
      comments: null,
      codes: null,
      spcode: null,
      quadrat: null,
      tag: null,
      stemtag: null
    });
  });

  it('prefers explicit revision codes, then raw export codes, then display attributes', () => {
    expect(
      canonicalizeRevisionRow({
        codes: 'A;B',
        rawcodes: 'C;D',
        attributes: 'E;F'
      })
    ).toEqual({
      codes: 'A;B',
      rawcodes: 'C;D',
      attributes: 'E;F'
    });

    expect(
      canonicalizeRevisionRow({
        rawcodes: 'Q;L',
        attributes: 'L; Q'
      })
    ).toEqual({
      rawcodes: 'Q;L',
      attributes: 'L; Q',
      codes: 'Q;L'
    });

    expect(
      canonicalizeRevisionRow({
        attributes: 'D2'
      })
    ).toEqual({
      attributes: 'D2',
      codes: 'D2'
    });
  });
});
