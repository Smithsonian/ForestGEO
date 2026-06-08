import { describe, it, expect } from 'vitest';
import { AmbiguousSheetError, MissingSheetError, MissingColumnError, UnparseableDateError } from './errors';

describe('arcgis typed errors', () => {
  it.each([
    ['MissingSheetError', MissingSheetError],
    ['MissingColumnError', MissingColumnError],
    ['AmbiguousSheetError', AmbiguousSheetError],
    ['UnparseableDateError', UnparseableDateError]
  ])('%s is an Error with a stable name and message', (expectedName, Ctor) => {
    const err = new Ctor('boom');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe(expectedName);
    expect(err.message).toBe('boom');
  });
});
