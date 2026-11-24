import { describe, expect, it } from 'vitest';
import { extractFilenameFromContentDisposition } from '@/lib/errorsexplorer/explorertransport';

const FALLBACK_FILENAME = 'fallback.csv';

describe('extractFilenameFromContentDisposition', () => {
  it('reads the quoted filename from the header', () => {
    expect(extractFilenameFromContentDisposition('attachment; filename="errors-forestgeo_testing-plot1.csv"', FALLBACK_FILENAME)).toBe(
      'errors-forestgeo_testing-plot1.csv'
    );
  });

  it.each([
    { label: 'a missing header', header: null },
    { label: 'a header with no filename', header: 'attachment' },
    { label: 'an unquoted filename', header: 'attachment; filename=errors.csv' }
  ])('falls back to the caller’s filename for $label', ({ header }) => {
    expect(extractFilenameFromContentDisposition(header, FALLBACK_FILENAME)).toBe(FALLBACK_FILENAME);
  });
});
