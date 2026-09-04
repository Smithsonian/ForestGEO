import { describe, expect, it } from 'vitest';
import { buildIngestionLockName } from './ingest-batch';

describe('buildIngestionLockName', () => {
  it("stays below MySQL GET_LOCK's 64-character limit for maximum-length filenames", () => {
    const name = buildIngestionLockName('forestgeo_cooksbranch', 'f'.repeat(50), 1, 2);

    expect(name).toHaveLength(52);
    expect(name).toMatch(/^upload:file:[a-f0-9]{40}$/);
  });

  it('is stable and scopes otherwise-identical uploads by schema', () => {
    const first = buildIngestionLockName('forestgeo_alpha', 'measurements.csv', 1, 2);

    expect(buildIngestionLockName('forestgeo_alpha', 'measurements.csv', 1, 2)).toBe(first);
    expect(buildIngestionLockName('forestgeo_beta', 'measurements.csv', 1, 2)).not.toBe(first);
  });
});
