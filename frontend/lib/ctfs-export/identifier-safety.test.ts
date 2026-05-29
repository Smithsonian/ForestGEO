import { describe, it, expect } from 'vitest';
import { buildProcedureName, buildLockName, deterministicSuffix } from './identifier-safety';

describe('buildProcedureName', () => {
  it('produces csv_to_sql_v2_load_<plot>_<slug>_<hash>', () => {
    const name = buildProcedureName({ destinationPlotId: 1, plotCensusNumber: '2024' });
    expect(name).toMatch(/^csv_to_sql_v2_load_1_2024_[0-9a-f]{8}$/);
  });

  it('sanitizes non-identifier characters in PlotCensusNumber', () => {
    const name = buildProcedureName({ destinationPlotId: 7, plotCensusNumber: '2024a-pilot' });
    expect(name).toMatch(/^csv_to_sql_v2_load_7_2024a_pilot_[0-9a-f]{8}$/);
  });

  it('caps slug at 32 chars', () => {
    const long = 'a'.repeat(40);
    const name = buildProcedureName({ destinationPlotId: 1, plotCensusNumber: long });
    const prefix = 'csv_to_sql_v2_load_1_';
    expect(name.startsWith(prefix)).toBe(true);
    const tail = name.slice(prefix.length);
    const lastUnderscore = tail.lastIndexOf('_');
    const slug = tail.slice(0, lastUnderscore);
    expect(slug.length).toBeLessThanOrEqual(32);
  });

  it('throws when the slug collapses to empty (no identifier characters available)', () => {
    // Empty slug is now an error rather than a fallback — the input is malformed
    // and should not silently coalesce to a collision-prone 'census' slug.
    expect(() => buildProcedureName({ destinationPlotId: 1, plotCensusNumber: '---' })).toThrow(/empty after sanitization/);
    expect(() => buildProcedureName({ destinationPlotId: 1, plotCensusNumber: '' })).toThrow(/empty after sanitization/);
    expect(() => buildProcedureName({ destinationPlotId: 1, plotCensusNumber: '___' })).toThrow(/empty after sanitization/);
  });

  it('rejects non-integer destinationPlotId', () => {
    expect(() => buildProcedureName({ destinationPlotId: 1.5, plotCensusNumber: '1' })).toThrow(/destinationPlotId must be a non-negative integer/);
    expect(() => buildProcedureName({ destinationPlotId: -1, plotCensusNumber: '1' })).toThrow(/destinationPlotId must be a non-negative integer/);
    expect(() => buildProcedureName({ destinationPlotId: NaN, plotCensusNumber: '1' })).toThrow(/destinationPlotId must be a non-negative integer/);
  });

  it('handles a leading-digit PlotCensusNumber', () => {
    const name = buildProcedureName({ destinationPlotId: 1, plotCensusNumber: '2024a' });
    expect(name).toMatch(/^csv_to_sql_v2_load_1_2024a_[0-9a-f]{8}$/);
  });

  it('returns a deterministic suffix for identical inputs', () => {
    const a = buildProcedureName({ destinationPlotId: 1, plotCensusNumber: '1' });
    const b = buildProcedureName({ destinationPlotId: 1, plotCensusNumber: '1' });
    expect(a).toBe(b);
  });

  it('returns a different suffix when inputs differ (schema/appCensusId)', () => {
    const a = buildProcedureName({ destinationPlotId: 1, plotCensusNumber: '1', schema: 'forestgeo_a' });
    const b = buildProcedureName({ destinationPlotId: 1, plotCensusNumber: '1', schema: 'forestgeo_b' });
    expect(a).not.toBe(b);
  });
});

describe('buildLockName', () => {
  it('returns ctfs-export:<plot>:<census>', () => {
    expect(buildLockName({ destinationPlotId: 1, plotCensusNumber: '2024a' })).toBe('ctfs-export:1:2024a');
  });

  it('preserves the raw PlotCensusNumber (no sanitization)', () => {
    expect(buildLockName({ destinationPlotId: 1, plotCensusNumber: "x'y" })).toBe(`ctfs-export:1:x'y`);
    expect(buildLockName({ destinationPlotId: 5, plotCensusNumber: 'pilot-1' })).toBe('ctfs-export:5:pilot-1');
  });

  it('throws when the lock name would exceed MySQL GET_LOCK 64-char limit', () => {
    // ctfs-export:<id>:<census> is 'ctfs-export:' (12) + plotId + ':' + plotCensusNumber.
    // 64 - 12 - 1 - 1 (destinationPlotId='9') = 50 chars of headroom for census number.
    const tooLong = 'a'.repeat(80);
    expect(() => buildLockName({ destinationPlotId: 9, plotCensusNumber: tooLong })).toThrow(/64-char limit/);
  });

  it('accepts a borderline-but-legal lock name', () => {
    // 64 - 12 - 1 - 1 ('9' destinationPlotId is 1 char) = 50 chars for the census.
    const okLong = 'a'.repeat(50);
    expect(buildLockName({ destinationPlotId: 9, plotCensusNumber: okLong })).toBe(`ctfs-export:9:${okLong}`);
  });
});

describe('deterministicSuffix', () => {
  it('returns 8 lowercase hex chars', () => {
    expect(deterministicSuffix({ destinationPlotId: 1, plotCensusNumber: '1' })).toMatch(/^[0-9a-f]{8}$/);
  });

  it('is deterministic for identical inputs', () => {
    const a = deterministicSuffix({ destinationPlotId: 1, plotCensusNumber: '1' });
    const b = deterministicSuffix({ destinationPlotId: 1, plotCensusNumber: '1' });
    expect(a).toBe(b);
  });

  it('changes when any input changes', () => {
    const base = deterministicSuffix({ destinationPlotId: 1, plotCensusNumber: '1' });
    expect(deterministicSuffix({ destinationPlotId: 2, plotCensusNumber: '1' })).not.toBe(base);
    expect(deterministicSuffix({ destinationPlotId: 1, plotCensusNumber: '2' })).not.toBe(base);
    expect(deterministicSuffix({ destinationPlotId: 1, plotCensusNumber: '1', schema: 'x' })).not.toBe(base);
    expect(deterministicSuffix({ destinationPlotId: 1, plotCensusNumber: '1', appCensusId: 5 })).not.toBe(base);
  });
});
