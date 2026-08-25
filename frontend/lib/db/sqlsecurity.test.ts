import { describe, it, expect } from 'vitest';
import { isValidSchema, validateSchemaOrThrow, validatedSchema, safeFormatQuery } from './sqlsecurity';

describe('isValidSchema', () => {
  it('accepts known static schemas', () => {
    expect(isValidSchema('forestgeo')).toBe(true);
    expect(isValidSchema('forestgeo_testing')).toBe(true);
    expect(isValidSchema('catalog')).toBe(true);
  });

  it('accepts dynamic forestgeo_* schemas that match the pattern', () => {
    expect(isValidSchema('forestgeo_rabi')).toBe(true);
    expect(isValidSchema('forestgeo_site123')).toBe(true);
  });

  it('rejects null, undefined, and empty string', () => {
    expect(isValidSchema(null)).toBe(false);
    expect(isValidSchema(undefined)).toBe(false);
    expect(isValidSchema('')).toBe(false);
  });

  it('rejects injection-style values', () => {
    expect(isValidSchema('bad; DROP TABLE users--')).toBe(false);
    expect(isValidSchema("' OR '1'='1")).toBe(false);
    expect(isValidSchema('../etc/passwd')).toBe(false);
    expect(isValidSchema('totally_unrelated_db')).toBe(false);
  });
});

describe('validateSchemaOrThrow', () => {
  it('does not throw for a valid schema', () => {
    expect(() => validateSchemaOrThrow('forestgeo_testing')).not.toThrow();
  });

  it('throws an Error for an invalid schema', () => {
    expect(() => validateSchemaOrThrow('bad; DROP')).toThrow(Error);
    expect(() => validateSchemaOrThrow(null)).toThrow(Error);
  });

  it('provides a descriptive error message containing the invalid value', () => {
    expect(() => validateSchemaOrThrow('evil_schema')).toThrow(/Invalid or unauthorized schema/);
  });
});

describe('validatedSchema', () => {
  it('returns the validated schema value unchanged for a valid schema', () => {
    const result = validatedSchema('forestgeo_testing');
    expect(result).toBe('forestgeo_testing');
  });

  it('is usable as a string after validation', () => {
    const result = validatedSchema('forestgeo_testing');
    expect(`${result}.coremeasurements`).toBe('forestgeo_testing.coremeasurements');
  });

  it('throws for an injection-attempt schema', () => {
    expect(() => validatedSchema('bad; DROP')).toThrow(Error);
    expect(() => validatedSchema("' OR '1'='1")).toThrow(Error);
  });

  it('throws for null and undefined', () => {
    expect(() => validatedSchema(null)).toThrow(Error);
    expect(() => validatedSchema(undefined)).toThrow(Error);
  });

  it('throws with a descriptive error message', () => {
    expect(() => validatedSchema('bad; DROP')).toThrow(/Invalid or unauthorized schema/);
  });
});

describe('safeFormatQuery (regression)', () => {
  it('replaces ?? with the escaped schema name', () => {
    const result = safeFormatQuery('forestgeo_testing', 'SELECT * FROM ??.coremeasurements');
    expect(result).toBe('SELECT * FROM `forestgeo_testing`.coremeasurements');
  });

  it('replaces multiple ?? placeholders with the same schema', () => {
    const result = safeFormatQuery('forestgeo_testing', 'SELECT * FROM ??.a JOIN ??.b ON a.id = b.id');
    expect(result).toBe('SELECT * FROM `forestgeo_testing`.a JOIN `forestgeo_testing`.b ON a.id = b.id');
  });

  it('throws at runtime for an invalid schema — callers cannot bypass validation', () => {
    expect(() => safeFormatQuery('bad; DROP TABLE users--', 'SELECT 1')).toThrow(Error);
    expect(() => safeFormatQuery(null, 'SELECT 1')).toThrow(Error);
    expect(() => safeFormatQuery(undefined, 'SELECT 1')).toThrow(Error);
  });

  it('accepts a SchemaName (branded) value without any type gymnastics', () => {
    const branded = validatedSchema('forestgeo_testing');
    const result = safeFormatQuery(branded, 'SELECT * FROM ??.foo');
    expect(result).toBe('SELECT * FROM `forestgeo_testing`.foo');
  });
});
