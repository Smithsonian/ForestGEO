import { describe, it, expect } from 'vitest';
import { arcgisHelpHeaders } from './schema';

describe('arcgisHelpHeaders', () => {
  it('exposes the workbook help columns including identity and coordinate fields', () => {
    const labels = arcgisHelpHeaders().map(header => header.label);
    expect(labels).toEqual(expect.arrayContaining(['GlobalID', 'tag', 'spcode', 'lx', 'ly']));
  });

  it('flags required vs optional columns and carries explanations', () => {
    const headers = arcgisHelpHeaders();
    const lx = headers.find(header => header.label === 'lx');
    const stemTag = headers.find(header => header.label === 'StemTag');
    expect(lx?.category).toBe('required');
    expect(lx?.explanation).toBeTruthy();
    expect(stemTag?.category).toBe('optional');
  });
});
