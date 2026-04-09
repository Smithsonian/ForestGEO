import { describe, expect, it } from 'vitest';

import { joinCodesArray, parseCodesString } from './errorsexplorer';

describe('ErrorsExplorer — Codes column helpers', () => {
  describe('parseCodesString', () => {
    it('returns an empty array for undefined', () => {
      expect(parseCodesString(undefined)).toEqual([]);
    });

    it('returns an empty array for the empty string', () => {
      expect(parseCodesString('')).toEqual([]);
    });

    it('parses a single code', () => {
      expect(parseCodesString('D')).toEqual(['D']);
    });

    it('parses multiple semicolon-delimited codes', () => {
      expect(parseCodesString('D;M;A')).toEqual(['D', 'M', 'A']);
    });

    it('trims whitespace around each code segment', () => {
      expect(parseCodesString(' D ; M ')).toEqual(['D', 'M']);
    });

    it('drops empty segments from doubled or trailing semicolons', () => {
      expect(parseCodesString('D;;M;')).toEqual(['D', 'M']);
    });
  });

  describe('joinCodesArray', () => {
    it('joins an array of codes with semicolons', () => {
      expect(joinCodesArray(['D', 'M', 'A'])).toBe('D;M;A');
    });

    it('returns a single code unchanged when only one is selected', () => {
      expect(joinCodesArray(['D'])).toBe('D');
    });

    it('returns the empty string when the array is empty (user cleared codes)', () => {
      expect(joinCodesArray([])).toBe('');
    });

    it('returns the empty string for non-array input (defensive branch)', () => {
      expect(joinCodesArray(null)).toBe('');
      expect(joinCodesArray(undefined)).toBe('');
    });
  });

  describe('parse/join round-trip', () => {
    it('joining then parsing recovers the original code set', () => {
      const original = ['D', 'M'];
      expect(parseCodesString(joinCodesArray(original))).toEqual(original);
    });

    it('parsing then joining preserves the canonical stored form', () => {
      expect(joinCodesArray(parseCodesString(' D ; M '))).toBe('D;M');
    });
  });
});
