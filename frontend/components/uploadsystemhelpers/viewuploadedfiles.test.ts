import { describe, expect, it, vi } from 'vitest';
import { containerDisplayName } from './viewuploadedfiles';

vi.mock('@/ailogger', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
}));

describe('containerDisplayName', () => {
  it('returns the schema-scoped container name for a mappable schema', () => {
    expect(containerDisplayName('forestgeo_testing', 1, 2)).toBe('forestgeo-testing-plot1-census2');
  });

  it('returns a placeholder when any input is missing', () => {
    expect(containerDisplayName(undefined, 1, 2)).toBe('none');
    expect(containerDisplayName('forestgeo_testing', undefined, 2)).toBe('none');
    expect(containerDisplayName('forestgeo_testing', 1, undefined)).toBe('none');
  });

  it('degrades to a label instead of throwing during render for a schema getContainerName rejects', () => {
    // Valid MySQL schema (passes VALID_SCHEMA_PATTERN) but fails the stricter
    // INJECTIVE_SCHEMA_PATTERN — this is display-only and must not crash the page.
    expect(containerDisplayName('forestgeo__x', 1, 2)).toBe('unavailable (schema cannot be mapped to a storage container)');
  });

  it('degrades to a label for a schema whose container name would exceed the Azure 63-char limit', () => {
    const longSchema = `forestgeo_${'a'.repeat(60)}`;
    expect(() => containerDisplayName(longSchema, 999999, 999999)).not.toThrow();
    expect(containerDisplayName(longSchema, 999999, 999999)).toBe('unavailable (schema cannot be mapped to a storage container)');
  });
});
