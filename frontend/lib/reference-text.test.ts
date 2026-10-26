import { describe, expect, it } from 'vitest';
import { trimReferenceTextFields } from '@/lib/reference-text';

describe('trimReferenceTextFields', () => {
  it('trims outer whitespace from attribute Code and Description only', () => {
    const row = { Code: '  A ', Description: '\t dead  stem \n', Status: ' alive ', IsActive: 1 };
    expect(trimReferenceTextFields('attributes', row)).toEqual({ Code: 'A', Description: 'dead  stem', Status: ' alive ', IsActive: 1 });
  });

  it('preserves internal spaces, case and leading zeros', () => {
    expect(trimReferenceTextFields('attributes', { Code: ' 007 ', Description: ' Mixed  Case ' })).toEqual({ Code: '007', Description: 'Mixed  Case' });
  });

  it('keeps null and undefined as they are and passes non-strings through', () => {
    const result = trimReferenceTextFields('attributes', { Code: 'X', Description: null, Extra: undefined });
    expect(result).toEqual({ Code: 'X', Description: null, Extra: undefined });
    expect(trimReferenceTextFields('attributes', { Code: 5 as unknown as string, Description: undefined }).Code).toBe(5);
  });

  it('does not mutate the input row', () => {
    const row = { Code: ' A ', Description: ' d ' };
    trimReferenceTextFields('attributes', row);
    expect(row).toEqual({ Code: ' A ', Description: ' d ' });
  });

  it('leaves other data types untouched', () => {
    const row = { Quadrat: ' Q1 ', Description: ' keep ' };
    expect(trimReferenceTextFields('quadrats', row)).toBe(row);
  });
});
