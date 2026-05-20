import { describe, it, expect } from 'vitest';
import { buildProcedureName, buildLockName, randomSuffix } from './identifier-safety';

describe('buildProcedureName', () => {
  it('produces csv_to_sql_v2_load_<plot>_<slug>_<random>', () => {
    const name = buildProcedureName({ destinationPlotId: 1, plotCensusNumber: '2024' });
    expect(name).toMatch(/^csv_to_sql_v2_load_1_2024_[0-9a-f]{8}$/);
  });

  it('sanitizes non-identifier characters in PlotCensusNumber', () => {
    const name = buildProcedureName({ destinationPlotId: 7, plotCensusNumber: '2024a-pilot' });
    // Hyphens become underscores
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

  it('rejects an empty slug after sanitization', () => {
    expect(() => buildProcedureName({ destinationPlotId: 1, plotCensusNumber: '---' })).toThrow(/PlotCensusNumber slug is empty/);
    expect(() => buildProcedureName({ destinationPlotId: 1, plotCensusNumber: '' })).toThrow(/PlotCensusNumber slug is empty/);
    expect(() => buildProcedureName({ destinationPlotId: 1, plotCensusNumber: '___' })).toThrow(/PlotCensusNumber slug is empty/);
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

  it('returns a fresh random suffix each call', () => {
    const a = buildProcedureName({ destinationPlotId: 1, plotCensusNumber: '1' });
    const b = buildProcedureName({ destinationPlotId: 1, plotCensusNumber: '1' });
    // Extremely unlikely to collide (32 bits of randomness).
    expect(a).not.toBe(b);
  });
});

describe('buildLockName', () => {
  it('returns ctfs-export:<plot>:<census>', () => {
    expect(buildLockName({ destinationPlotId: 1, plotCensusNumber: '2024a' })).toBe('ctfs-export:1:2024a');
  });

  it('preserves the raw PlotCensusNumber (no sanitization)', () => {
    // Special chars are escaped at the SQL-string-literal boundary, not here.
    expect(buildLockName({ destinationPlotId: 1, plotCensusNumber: "x'y" })).toBe(`ctfs-export:1:x'y`);
    expect(buildLockName({ destinationPlotId: 5, plotCensusNumber: 'pilot-1' })).toBe('ctfs-export:5:pilot-1');
  });
});

describe('randomSuffix', () => {
  it('returns 8 lowercase hex chars', () => {
    for (let i = 0; i < 100; i++) {
      expect(randomSuffix()).toMatch(/^[0-9a-f]{8}$/);
    }
  });
});
