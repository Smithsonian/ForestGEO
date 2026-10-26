import { describe, expect, it } from 'vitest';
import { SETUP_FAILURE_CODES, setupFailureSummary } from './setup-failure';

const DEFAULT_SUMMARY = 'Upload setup failed while preparing measurements.';

describe('setupFailureSummary', () => {
  it.each(Object.values(SETUP_FAILURE_CODES))('has its own summary for %s', code => {
    const summary = setupFailureSummary(code);
    console.log('[setup-failure]', code, '->', summary);
    expect(summary).not.toBe(DEFAULT_SUMMARY);
  });

  it.each([undefined, 'ER_LOCK_DEADLOCK', 'constructor', 'toString', '__proto__', 'hasOwnProperty'])('returns the default summary for %s', code => {
    expect(setupFailureSummary(code)).toBe(DEFAULT_SUMMARY);
  });

  it('only the permanent oversized failure tells the user to upload again', () => {
    const asksForReupload = Object.values(SETUP_FAILURE_CODES).filter(code => /upload the file again/i.test(setupFailureSummary(code)));
    expect(asksForReupload).toEqual([SETUP_FAILURE_CODES.oversizedSubBatch]);
  });
});
