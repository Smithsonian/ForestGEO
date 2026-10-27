import { beforeEach, describe, expect, it } from 'vitest';
import { clearAllCaches, DelimiterIssueCode, validateDelimiter } from './delimiterdetection';

function fileOf(text: string, name: string): File {
  return new File([text], name, { type: 'text/csv' });
}

describe('validateDelimiter ragged-row line numbering', () => {
  beforeEach(() => {
    clearAllCaches();
  });

  it('reports the physical source line, with the header as line 1', async () => {
    // Header = line 1, data rows = lines 2..4; the short row is source line 3.
    const content = 'Spcode,Species,Family\nACAL,diversifolia,Euph\nACBE,short\nACCE,full,Fam\n';
    const result = await validateDelimiter(fileOf(content, 'ragged.csv'), ',', ['spcode', 'species']);

    const mismatches = result.issues.filter(i => i.code === DelimiterIssueCode.ROW_COLUMN_COUNT_MISMATCH);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].message).toBe('Line 3 has 2 columns, expected 3');
  });

  it('keeps physical line numbering after a blank line following the header', async () => {
    // Header = line 1, blank = line 2, first data row (short) = line 3.
    const content = 'Spcode,Species,Family\n\nACAL,diversifolia\nACBE,full,Fam\n';
    const result = await validateDelimiter(fileOf(content, 'blank.csv'), ',', ['spcode', 'species']);

    const mismatches = result.issues.filter(i => i.code === DelimiterIssueCode.ROW_COLUMN_COUNT_MISMATCH);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].message).toBe('Line 3 has 2 columns, expected 3');
    expect(mismatches[0].message).not.toMatch(/data row/i);
  });

  it('numbers the first data row as line 2', async () => {
    const content = 'Spcode,Species,Family\nACAL,diversifolia\n';
    const result = await validateDelimiter(fileOf(content, 'first-row.csv'), ',', ['spcode', 'species']);

    const mismatch = result.issues.find(i => i.code === DelimiterIssueCode.ROW_COLUMN_COUNT_MISMATCH);
    expect(mismatch?.message).toBe('Line 2 has 2 columns, expected 3');
  });

  it('does not flag a well-formed file when the expected header list is larger than the required subset', async () => {
    const content = 'Spcode,Species\nACAL,diversifolia\n';
    const result = await validateDelimiter(fileOf(content, 'valid.csv'), ',', ['spcode', 'species']);

    expect(result.isValid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('still flags a genuinely missing required header', async () => {
    const result = await validateDelimiter(fileOf('Spcode,Family\nACAL,Euph\n', 'missing.csv'), ',', ['spcode', 'species']);

    expect(result.isValid).toBe(false);
    expect(result.issues.some(i => i.code === DelimiterIssueCode.MISSING_REQUIRED_COLUMNS)).toBe(true);
  });
});
