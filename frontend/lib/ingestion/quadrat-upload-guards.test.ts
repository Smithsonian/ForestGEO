import { describe, it, expect } from 'vitest';
import { buildDivergentQuadratUploadError, quadratRevisionAppendsDivergentSet } from './quadrat-upload-guards';

describe('quadratRevisionAppendsDivergentSet', () => {
  it('flags the placeholder-grid + real-upload doubling case (no name overlap)', () => {
    const placeholderGrid = ['Q00001', 'Q00002', 'Q00003'];
    const realQuadrats = ['C01', 'D01', 'E01'];
    expect(quadratRevisionAppendsDivergentSet(placeholderGrid, realQuadrats)).toBe(true);
  });

  it('does not flag when at least one incoming name matches an existing quadrat', () => {
    const existing = ['C01', 'D01', 'E01'];
    const incoming = ['C01', 'F01', 'G01']; // C01 overlaps → genuine revision, not a divergent set
    expect(quadratRevisionAppendsDivergentSet(existing, incoming)).toBe(false);
  });

  it('matches names case-insensitively and ignoring surrounding whitespace', () => {
    const existing = ['c01', 'd01'];
    const incoming = [' C01 ', 'Z09'];
    expect(quadratRevisionAppendsDivergentSet(existing, incoming)).toBe(false);
  });

  it('does not flag a first-time upload into an empty plot', () => {
    expect(quadratRevisionAppendsDivergentSet([], ['C01', 'D01'])).toBe(false);
  });

  it('does not flag when the incoming file has no usable names', () => {
    expect(quadratRevisionAppendsDivergentSet(['Q00001'], ['', '  '])).toBe(false);
  });

  it('ignores blank existing names when deciding overlap', () => {
    // A blank existing name must not be treated as a match for a blank-trimmed incoming name.
    expect(quadratRevisionAppendsDivergentSet(['', 'Q00001'], ['C01'])).toBe(true);
  });
});

describe('buildDivergentQuadratUploadError', () => {
  it('names the plot, the incoming count, and points to Clean Re-Upload', () => {
    const message = buildDivergentQuadratUploadError(42, ['Q00001', 'Q00002'], 525);
    expect(message).toContain('plot 42');
    expect(message).toContain('525');
    expect(message).toContain('Clean Re-Upload');
    expect(message).toContain('Q00001');
  });

  it('truncates a long existing-name sample with an ellipsis', () => {
    const manyNames = Array.from({ length: 30 }, (_, i) => `Q${String(i + 1).padStart(5, '0')}`);
    const message = buildDivergentQuadratUploadError(1, manyNames, 12);
    expect(message).toContain('…');
    expect(message).not.toContain('Q00011'); // beyond the 10-name sample window
  });
});
