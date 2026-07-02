import { describe, expect, it } from 'vitest';
import { isUnsignedIntFieldInvalid, MYSQL_UNSIGNED_INT_MAX, parseUnsignedIntField } from './temporary-measurements';

describe('parseUnsignedIntField', () => {
  it('parses positive integers within the MySQL unsigned range', () => {
    expect(parseUnsignedIntField(5001)).toBe(5001);
    expect(parseUnsignedIntField('5001')).toBe(5001);
    expect(parseUnsignedIntField(MYSQL_UNSIGNED_INT_MAX)).toBe(MYSQL_UNSIGNED_INT_MAX);
  });

  it('returns null for absent or blank values', () => {
    expect(parseUnsignedIntField(undefined)).toBeNull();
    expect(parseUnsignedIntField(null)).toBeNull();
    expect(parseUnsignedIntField('')).toBeNull();
    expect(parseUnsignedIntField('   ')).toBeNull();
  });

  it('returns null for present-but-invalid values', () => {
    expect(parseUnsignedIntField('5,001')).toBeNull();
    expect(parseUnsignedIntField('STEM-5001')).toBeNull();
    expect(parseUnsignedIntField('5001x')).toBeNull();
    expect(parseUnsignedIntField(0)).toBeNull();
    expect(parseUnsignedIntField(-1)).toBeNull();
    expect(parseUnsignedIntField(12.3)).toBeNull();
    expect(parseUnsignedIntField(MYSQL_UNSIGNED_INT_MAX + 1)).toBeNull();
  });
});

describe('isUnsignedIntFieldInvalid', () => {
  it('is false for absent/blank values (a missing PublishedStemID is legitimately optional)', () => {
    expect(isUnsignedIntFieldInvalid(undefined)).toBe(false);
    expect(isUnsignedIntFieldInvalid(null)).toBe(false);
    expect(isUnsignedIntFieldInvalid('')).toBe(false);
    expect(isUnsignedIntFieldInvalid('   ')).toBe(false);
  });

  it('is false for values that parse to a valid unsigned int', () => {
    expect(isUnsignedIntFieldInvalid(5001)).toBe(false);
    expect(isUnsignedIntFieldInvalid('5001')).toBe(false);
  });

  it('is true only for present values that cannot be stored as an unsigned int', () => {
    // These are exactly the cases that were previously coerced to NULL and ingested silently.
    expect(isUnsignedIntFieldInvalid('5,001')).toBe(true);
    expect(isUnsignedIntFieldInvalid('STEM-5001')).toBe(true);
    expect(isUnsignedIntFieldInvalid('5001x')).toBe(true);
    expect(isUnsignedIntFieldInvalid(0)).toBe(true);
    expect(isUnsignedIntFieldInvalid(-1)).toBe(true);
    expect(isUnsignedIntFieldInvalid(12.3)).toBe(true);
  });
});
