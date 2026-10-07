import { describe, expect, it, vi } from 'vitest';
import type { FileRow } from '@/config/macros/formdetails';

// tests/mocks/platform-mocks.ts globally stubs '@/lib/db/definitions/core' with a stale 6-status
// array that predates AttributeStatusOptions' 7th status -- override with the real implementation
// (matching the pattern in datagridcolumns.test.tsx) so these tests exercise the genuine validator.
// This must be a hoisted, static import: it.each(AttributeStatusOptions) below needs the real array
// at collection time, before any beforeAll/dynamic import would run.
vi.mock('@/lib/db/definitions/core', async importOriginal => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return actual;
});

import { AttributeStatusOptions, validateAttributesRow } from '@/lib/db/definitions/core';

const VALID_ROW: FileRow = { code: 'ATTR01', description: 'Canopy emergent', status: 'alive' };

describe('AttributeStatusOptions', () => {
  it('is exactly the seven schema-valid statuses, including the easily-omitted "omitted"', () => {
    expect(AttributeStatusOptions).toEqual(['alive', 'alive-not measured', 'dead', 'stem dead', 'broken below', 'omitted', 'missing']);
  });
});

describe('validateAttributesRow', () => {
  it('accepts a fully-populated, valid row', () => {
    expect(validateAttributesRow(VALID_ROW)).toBeNull();
  });

  describe('status — NULL means unspecified, not an eighth status', () => {
    it('accepts a null status', () => {
      expect(validateAttributesRow({ ...VALID_ROW, status: null })).toBeNull();
    });

    it('accepts an undefined status', () => {
      const { status: _status, ...rest } = VALID_ROW;
      expect(validateAttributesRow(rest as FileRow)).toBeNull();
    });

    it('accepts an exact empty string as unspecified (manual entry/upload blank)', () => {
      expect(validateAttributesRow({ ...VALID_ROW, status: '' })).toBeNull();
    });

    it.each(AttributeStatusOptions)('accepts the canonical status "%s"', status => {
      expect(validateAttributesRow({ ...VALID_ROW, status })).toBeNull();
    });

    it('rejects an arbitrary non-blank status not in the canonical list', () => {
      const errors = validateAttributesRow({ ...VALID_ROW, status: 'active' });
      expect(errors).not.toBeNull();
      expect(errors?.status).toBeDefined();
    });

    it('rejects a whitespace-only status (not the same as a true empty string)', () => {
      const errors = validateAttributesRow({ ...VALID_ROW, status: '   ' });
      expect(errors).not.toBeNull();
      expect(errors?.status).toBeDefined();
    });
  });

  describe('code length limit', () => {
    it('accepts a 10-character code (the limit, inclusive)', () => {
      expect(validateAttributesRow({ ...VALID_ROW, code: '1234567890' })).toBeNull();
    });

    it('rejects an 11-character code (over the limit)', () => {
      const errors = validateAttributesRow({ ...VALID_ROW, code: '12345678901' });
      expect(errors).not.toBeNull();
      expect(errors?.code).toBeDefined();
    });
  });

  it('reports both an invalid status and an overlong code at once, not just the first', () => {
    const errors = validateAttributesRow({ ...VALID_ROW, code: '12345678901', status: 'active' });
    expect(errors).not.toBeNull();
    expect(Object.keys(errors ?? {}).sort()).toEqual(['code', 'status']);
  });
});
