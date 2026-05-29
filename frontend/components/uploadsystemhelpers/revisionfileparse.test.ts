import { describe, expect, it } from 'vitest';
import { canonicalizeRevisionRow, normalizeRevisionHeader } from './revisionfileparse';

const BYTE_ORDER_MARK = '﻿';
const UNICODE_TREE_TAG = '木本-柏 1';
const TAB_WRAPPED_STEM_GUID = '\tStemGUID\t';
const CRLF_SUFFIX = '\r\n';

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

  // CSV encoding edge cases. Papa Parse + the CSV spec make these legal headers
  // that a naive consumer would mishandle. The normalizer needs to behave
  // predictably for each so the route layer can trust its output.
  describe('header encoding edge cases', () => {
    it('strips surrounding whitespace and embedded tabs from a header before lookup', () => {
      expect(normalizeRevisionHeader(TAB_WRAPPED_STEM_GUID)).toBe('stemid');
    });

    it('strips a trailing CRLF left behind by a Windows-style line ending', () => {
      expect(normalizeRevisionHeader(`SpeciesCode${CRLF_SUFFIX}`)).toBe('spcode');
    });

    // CSVs exported from Excel start with a UTF-8 BOM (U+FEFF) glued to the first
    // header. ECMAScript treats U+FEFF as whitespace, so String.prototype.trim
    // strips it — the normalizer resolves the BOM-prefixed first header to the
    // same canonical key as a clean header. Papa Parse's usual BOM stripping is
    // therefore belt-and-suspenders.
    it('normalizes a BOM-prefixed first header to the same canonical key as a clean header', () => {
      expect(normalizeRevisionHeader(`${BYTE_ORDER_MARK}StemGUID`)).toBe('stemid');
      expect(normalizeRevisionHeader(`${BYTE_ORDER_MARK}MeasuredDBH`)).toBe('dbh');
    });
  });

  describe('unicode values', () => {
    it('canonicalization preserves unicode characters inside cell values', () => {
      const row = canonicalizeRevisionRow({
        stemid: '42',
        tag: UNICODE_TREE_TAG,
        stemtag: UNICODE_TREE_TAG,
        codes: 'A'
      });
      expect(row.tag).toBe(UNICODE_TREE_TAG);
      expect(row.stemtag).toBe(UNICODE_TREE_TAG);
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
