import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { FileRow } from '@/config/macros/formdetails';

// tests/mocks/platform-mocks.ts stubs '@/lib/db/definitions/zones' with an empty module (it exists
// to keep datamapper.ts's transitive imports out of unrelated test suites) — unmock to test the real
// implementation, matching the pattern established by timekeeping.test.ts.
let validateQuadratsRow: typeof import('./zones').validateQuadratsRow;

beforeAll(async () => {
  vi.unmock('@/lib/db/definitions/zones');
  ({ validateQuadratsRow } = await import('./zones'));
});

// A fully-valid row, cloned and mutated per test so each assertion isolates exactly one field.
const VALID_ROW: FileRow = {
  quadrat: 'Q0001',
  startx: '0',
  starty: '0',
  dimx: '20',
  dimy: '20',
  area: '400',
  quadratshape: 'square'
};

describe('validateQuadratsRow', () => {
  it('accepts a fully-populated, numerically valid row', () => {
    expect(validateQuadratsRow(VALID_ROW)).toBeNull();
  });

  it('accepts negative StartX/StartY (a quadrat can sit south/west of a plot-relative origin after normalization)', () => {
    expect(validateQuadratsRow({ ...VALID_ROW, startx: '-5', starty: '-5' })).toBeNull();
  });

  describe('quadrat name', () => {
    it('rejects a missing quadrat name', () => {
      const { quadrat: _quadrat, ...rest } = VALID_ROW;
      const errors = validateQuadratsRow(rest as FileRow);
      expect(errors).not.toBeNull();
      expect(errors?.quadrat).toBeDefined();
    });

    it('rejects a blank quadrat name', () => {
      const errors = validateQuadratsRow({ ...VALID_ROW, quadrat: '   ' });
      expect(errors).not.toBeNull();
      expect(errors?.quadrat).toBeDefined();
    });

    it('rejects a null quadrat name', () => {
      const errors = validateQuadratsRow({ ...VALID_ROW, quadrat: null });
      expect(errors).not.toBeNull();
      expect(errors?.quadrat).toBeDefined();
    });
  });

  describe('startx/starty — missing must not silently become zero', () => {
    it('rejects a missing (null) startx rather than treating it as 0', () => {
      const errors = validateQuadratsRow({ ...VALID_ROW, startx: null });
      expect(errors).not.toBeNull();
      expect(errors?.startx).toBeDefined();
    });

    it('rejects a blank-string startx rather than treating it as 0', () => {
      const errors = validateQuadratsRow({ ...VALID_ROW, startx: '' });
      expect(errors).not.toBeNull();
      expect(errors?.startx).toBeDefined();
    });

    it('rejects a whitespace-only starty rather than treating it as 0', () => {
      const errors = validateQuadratsRow({ ...VALID_ROW, starty: '   ' });
      expect(errors).not.toBeNull();
      expect(errors?.starty).toBeDefined();
    });

    it('rejects a non-numeric startx', () => {
      const errors = validateQuadratsRow({ ...VALID_ROW, startx: 'not-a-number' });
      expect(errors).not.toBeNull();
      expect(errors?.startx).toBeDefined();
    });

    it('a genuine "0" startx/starty is valid (must not be confused with missing)', () => {
      expect(validateQuadratsRow({ ...VALID_ROW, startx: '0', starty: '0' })).toBeNull();
    });
  });

  describe('dimx/dimy', () => {
    it('rejects a missing dimx', () => {
      const errors = validateQuadratsRow({ ...VALID_ROW, dimx: null });
      expect(errors).not.toBeNull();
      expect(errors?.dimx).toBeDefined();
    });

    it('rejects a non-numeric dimy', () => {
      const errors = validateQuadratsRow({ ...VALID_ROW, dimy: 'twenty' });
      expect(errors).not.toBeNull();
      expect(errors?.dimy).toBeDefined();
    });

    it('rejects a zero dimx (non-positive dimension has no footprint)', () => {
      const errors = validateQuadratsRow({ ...VALID_ROW, dimx: '0' });
      expect(errors).not.toBeNull();
      expect(errors?.dimx).toBeDefined();
    });

    it('rejects a negative dimy', () => {
      const errors = validateQuadratsRow({ ...VALID_ROW, dimy: '-20' });
      expect(errors).not.toBeNull();
      expect(errors?.dimy).toBeDefined();
    });
  });

  it('reports every offending field at once, not just the first', () => {
    const errors = validateQuadratsRow({ ...VALID_ROW, quadrat: '', startx: null, dimy: '-1' });
    expect(errors).not.toBeNull();
    expect(Object.keys(errors ?? {}).sort()).toEqual(['dimy', 'quadrat', 'startx']);
  });
});
