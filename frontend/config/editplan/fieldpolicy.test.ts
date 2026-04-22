import { describe, it, expect } from 'vitest';
import { canonicalizeEditPayload, InvalidClearError, isFieldEditableByRole, normalizeFieldValue, rejectDisallowedFields } from './fieldpolicy';

describe('fieldpolicy', () => {
  describe('rejectDisallowedFields', () => {
    it('returns null when every field is allowed on measurementssummary', () => {
      expect(rejectDisallowedFields('measurementssummary', { SpeciesCode: 'AA', MeasuredDBH: 12 })).toBeNull();
    });

    it('returns disallowed keys on measurementssummary', () => {
      expect(rejectDisallowedFields('measurementssummary', { SpeciesCode: 'AA', SpeciesName: 'x' })).toEqual(['SpeciesName']);
    });

    it('returns null for canonical failedmeasurements keys', () => {
      expect(
        rejectDisallowedFields('failedmeasurements', { Tag: '100', SpCode: 'AA', X: 1.0, Y: 2.0, DBH: 12, HOM: 1.3, Date: '2026-01-01' })
      ).toBeNull();
    });

    it('rejects unknown keys on failedmeasurements', () => {
      expect(rejectDisallowedFields('failedmeasurements', { Tag: '100', BogusField: 1 })).toEqual(['BogusField']);
    });
  });

  describe('normalizeFieldValue', () => {
    it('collapses "NULL" and whitespace to null for clear-on-blank fields', () => {
      expect(normalizeFieldValue('Description', '   NULL')).toBeNull();
      expect(normalizeFieldValue('Description', '')).toBeNull();
      expect(normalizeFieldValue('Comments', 'null')).toBeNull();
    });

    it('returns undefined for blank no-op-on-blank fields so apply stage skips them', () => {
      expect(normalizeFieldValue('MeasuredDBH', '')).toBeUndefined();
      expect(normalizeFieldValue('MeasuredDBH', 'NULL')).toBeUndefined();
      expect(normalizeFieldValue('MeasuredHOM', null)).toBeUndefined();
      expect(normalizeFieldValue('StemLocalX', '   ')).toBeUndefined();
    });

    it('trims string values before returning', () => {
      expect(normalizeFieldValue('Description', '  hello ')).toBe('hello');
    });

    it('preserves non-blank numeric values', () => {
      expect(normalizeFieldValue('MeasuredDBH', 12.34)).toBe(12.34);
    });

    it('passes undefined through unchanged', () => {
      expect(normalizeFieldValue('Description', undefined)).toBeUndefined();
    });
  });

  describe('InvalidClearError', () => {
    it('throws when an invalid-clear field receives an empty string', () => {
      expect(() => normalizeFieldValue('SpeciesCode', '')).toThrow(InvalidClearError);
      expect(() => normalizeFieldValue('TreeTag', '   ')).toThrow(InvalidClearError);
    });

    it('throws when an invalid-clear field receives a "NULL" literal', () => {
      expect(() => normalizeFieldValue('SpeciesCode', 'NULL')).toThrow(InvalidClearError);
      expect(() => normalizeFieldValue('TreeTag', 'null')).toThrow(InvalidClearError);
    });

    it('throws when an invalid-clear field receives explicit null', () => {
      expect(() => normalizeFieldValue('MeasurementDate', null)).toThrow(InvalidClearError);
      expect(() => normalizeFieldValue('QuadratName', null)).toThrow(InvalidClearError);
    });

    it('includes the offending field name on the error', () => {
      try {
        normalizeFieldValue('SpeciesCode', '');
        throw new Error('expected InvalidClearError');
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidClearError);
        expect((err as InvalidClearError).field).toBe('SpeciesCode');
      }
    });
  });

  describe('canonicalizeEditPayload', () => {
    it('maps camelCase grid keys to canonical measurementssummary names', () => {
      expect(
        canonicalizeEditPayload('measurementssummary', { speciesCode: 'aa', measuredDBH: 12.3, description: '  hello  ' })
      ).toEqual({ SpeciesCode: 'aa', MeasuredDBH: 12.3, Description: 'hello' });
    });

    it('maps failed-row raw aliases (rawSpCode, RawTreeTag, etc.) to canonical names', () => {
      const failed = canonicalizeEditPayload('failedmeasurements', { rawSpCode: 'bb', RawTreeTag: '100', rawX: 12.34 });
      expect(failed).toEqual({ SpCode: 'bb', Tag: '100', X: 12.34 });
      expect(rejectDisallowedFields('failedmeasurements', failed)).toBeNull();
    });

    it('drops fields normalized to undefined (no-op clears)', () => {
      expect(canonicalizeEditPayload('measurementssummary', { measuredDBH: '', measuredHOM: '  ' })).toEqual({});
    });

    it('propagates InvalidClearError when an identity field is blanked', () => {
      expect(() => canonicalizeEditPayload('measurementssummary', { speciesCode: '' })).toThrow(InvalidClearError);
      expect(() => canonicalizeEditPayload('failedmeasurements', { rawSpCode: 'NULL' })).toThrow(InvalidClearError);
    });
  });

  // Boundary inputs — legitimate but unusual values arriving from paste, export,
  // or CSV cleanup. The analyzer's first-pass normalization is the only chance
  // to reject truly malformed values before they reach the writer, so its
  // behavior on these inputs is worth pinning.
  describe('normalizeFieldValue boundary inputs', () => {
    const UNICODE_TREE_TAG_RAW = '  木本-柏 1 \t';
    const UNICODE_TREE_TAG_TRIMMED = '木本-柏 1';
    const EMOJI_DESCRIPTION_RAW = '  broken 🌳 stem ';
    const EMOJI_DESCRIPTION_TRIMMED = 'broken 🌳 stem';
    const NEGATIVE_DBH = -5.5;
    const GIANT_COORDINATE = 1e12;
    const TAB_INDENT_TREE_TAG = '\tT9\t';

    it('preserves unicode characters inside identifier fields after trimming whitespace', () => {
      expect(normalizeFieldValue('TreeTag', UNICODE_TREE_TAG_RAW)).toBe(UNICODE_TREE_TAG_TRIMMED);
    });

    it('preserves emoji inside free-text fields (Description is clear-on-blank, not emoji-stripping)', () => {
      expect(normalizeFieldValue('Description', EMOJI_DESCRIPTION_RAW)).toBe(EMOJI_DESCRIPTION_TRIMMED);
    });

    it('passes through negative numeric DBH/HOM unchanged — range validation lives in site-specific validations, not fieldpolicy', () => {
      expect(normalizeFieldValue('MeasuredDBH', NEGATIVE_DBH)).toBe(NEGATIVE_DBH);
      expect(normalizeFieldValue('MeasuredHOM', -0.1)).toBe(-0.1);
    });

    it('passes through extreme finite coordinates unchanged — analyzer does not clamp StemLocalX/Y', () => {
      expect(normalizeFieldValue('StemLocalX', GIANT_COORDINATE)).toBe(GIANT_COORDINATE);
      expect(normalizeFieldValue('StemLocalY', -GIANT_COORDINATE)).toBe(-GIANT_COORDINATE);
    });

    it('treats tab-only content as empty whitespace for invalid-clear fields', () => {
      expect(() => normalizeFieldValue('SpeciesCode', '\t\t')).toThrow(InvalidClearError);
    });

    it('strips surrounding tab/newline characters on identifier fields', () => {
      expect(normalizeFieldValue('TreeTag', TAB_INDENT_TREE_TAG)).toBe('T9');
      expect(normalizeFieldValue('StemTag', '  S12\n')).toBe('S12');
    });
  });

  describe('isFieldEditableByRole', () => {
    it('restricts taxonomic identity fields to global and db admin users', () => {
      expect(isFieldEditableByRole('SpeciesCode', 'global')).toBe(true);
      expect(isFieldEditableByRole('SpCode', 'db admin')).toBe(true);
      expect(isFieldEditableByRole('spcode', 'lead technician')).toBe(false);
      expect(isFieldEditableByRole('SpeciesCode', 'field crew')).toBe(false);
      expect(isFieldEditableByRole('SpeciesCode', undefined)).toBe(false);
    });

    it('allows non-taxonomic fields for non-pending editor roles', () => {
      expect(isFieldEditableByRole('MeasuredDBH', 'field crew')).toBe(true);
      expect(isFieldEditableByRole('TreeTag', 'lead technician')).toBe(true);
      expect(isFieldEditableByRole('MeasuredDBH', 'pending')).toBe(false);
    });
  });
});
