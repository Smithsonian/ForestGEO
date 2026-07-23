import { describe, it, expect } from 'vitest';
import { buildDivergentQuadratUploadError, quadratRevisionAppendsDivergentSet } from './quadrat-upload-guards';

describe('quadratRevisionAppendsDivergentSet', () => {
  it('flags the placeholder-grid + real-upload doubling case', () => {
    const placeholderGrid = ['Q00001', 'Q00002', 'Q00003'];
    const realQuadrats = ['C01', 'D01', 'E01'];
    expect(quadratRevisionAppendsDivergentSet(placeholderGrid, realQuadrats)).toBe(true);
  });

  it('allows a small legitimate addition to a generated grid', () => {
    const existing = Array.from({ length: 20 }, (_, i) => `Q${String(i + 1).padStart(5, '0')}`);
    const incoming = ['C01'];
    expect(quadratRevisionAppendsDivergentSet(existing, incoming)).toBe(false);
  });

  it('allows a large generated-name extension, including later clean-upload chunks', () => {
    const existing = Array.from({ length: 20 }, (_, i) => `Q${String(i + 1).padStart(5, '0')}`);
    const incoming = Array.from({ length: 20 }, (_, i) => `Q${String(i + 21).padStart(5, '0')}`);
    expect(quadratRevisionAppendsDivergentSet(existing, incoming)).toBe(false);
  });

  it('allows a wholly new set on a real, non-placeholder layout', () => {
    const existing = ['C01', 'D01', 'E01'];
    const incoming = ['F01', 'G01', 'H01'];
    expect(quadratRevisionAppendsDivergentSet(existing, incoming)).toBe(false);
  });

  it('still blocks a replacement with one incidental generated-name overlap', () => {
    const placeholderGrid = Array.from({ length: 20 }, (_, i) => `Q${String(i + 1).padStart(5, '0')}`);
    const realQuadrats = ['Q00001', ...Array.from({ length: 19 }, (_, i) => `C${String(i + 1).padStart(2, '0')}`)];
    expect(quadratRevisionAppendsDivergentSet(placeholderGrid, realQuadrats)).toBe(true);
  });

  it('matches generated placeholder names case-insensitively and ignoring surrounding whitespace', () => {
    const existing = ['q00001', 'q00002'];
    const incoming = [' C01 ', 'Z09'];
    expect(quadratRevisionAppendsDivergentSet(existing, incoming)).toBe(true);
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
