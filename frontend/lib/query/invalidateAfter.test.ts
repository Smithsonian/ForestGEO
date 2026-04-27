import { describe, expect, it, vi, beforeEach } from 'vitest';

const calls: Array<{ prefix: string; scope: unknown }> = [];
vi.mock('./mutateKey', () => ({
  mutateKey: vi.fn(async (prefix: string, opts?: { scope?: unknown }) => {
    calls.push({ prefix, scope: opts?.scope });
  })
}));

import { invalidateAfter } from './invalidateAfter';

const scope = { siteSchema: 's', plotID: 1, censusID: 2 };

describe('invalidateAfter', () => {
  beforeEach(() => { calls.length = 0; });

  it('delete-measurement fans out to all affected measurement grids and dashboard prefixes', async () => {
    await invalidateAfter('delete-measurement', scope);
    expect(new Set(calls.map(c => c.prefix))).toEqual(
      new Set([
        'grid:measurements',
        'grid:measurementssummary',
        'grid:measurementssummary_staging',
        'grid:failedmeasurements',
        'grid:summary',
        'grid:errors',
        'grid:unifiedchangelog',
        'dashboard:metrics',
        'dashboard:dataquality',
        'dashboard:progress'
      ])
    );
  });

  it('reingest fans out to failed measurements, errors, measurement grids, changelog, and dashboard prefixes', async () => {
    await invalidateAfter('reingest', scope);
    expect(new Set(calls.map(c => c.prefix))).toEqual(
      new Set([
        'grid:failedmeasurements',
        'grid:errors',
        'grid:measurements',
        'grid:measurementssummary',
        'grid:measurementssummary_staging',
        'grid:unifiedchangelog',
        'dashboard:metrics',
        'dashboard:dataquality',
        'dashboard:progress'
      ])
    );
  });

  it('save-edit-plan fans out to all measurement grids, errors, failed, changelog, and dashboard prefixes', async () => {
    await invalidateAfter('save-edit-plan', scope);
    expect(new Set(calls.map(c => c.prefix))).toEqual(
      new Set([
        'grid:measurements',
        'grid:measurementssummary',
        'grid:measurementssummary_staging',
        'grid:errors',
        'grid:failedmeasurements',
        'grid:unifiedchangelog',
        'dashboard:metrics',
        'dashboard:dataquality'
      ])
    );
  });

  it('delete-quadrat fans out to quadrats, quadratpersonnel, measurement grids, and dashboard:metrics', async () => {
    await invalidateAfter('delete-quadrat', scope);
    expect(new Set(calls.map(c => c.prefix))).toEqual(
      new Set([
        'grid:quadrats',
        'grid:quadratpersonnel',
        'grid:measurements',
        'grid:measurementssummary',
        'grid:measurementssummary_staging',
        'dashboard:metrics'
      ])
    );
  });

  it('delete-attribute fans out to attributes, measurement grids, and dashboard:metrics', async () => {
    await invalidateAfter('delete-attribute', scope);
    expect(new Set(calls.map(c => c.prefix))).toEqual(
      new Set([
        'grid:attributes',
        'grid:measurements',
        'grid:measurementssummary',
        'grid:measurementssummary_staging',
        'dashboard:metrics'
      ])
    );
  });

  it('delete-taxonomy fans out to taxonomy grids, trees, measurement grids, and dashboard:metrics', async () => {
    await invalidateAfter('delete-taxonomy', scope);
    expect(new Set(calls.map(c => c.prefix))).toEqual(
      new Set([
        'grid:taxonomies',
        'grid:alltaxonomiesview',
        'grid:stemtaxonomiesview',
        'grid:trees',
        'grid:measurements',
        'grid:measurementssummary',
        'grid:measurementssummary_staging',
        'dashboard:metrics'
      ])
    );
  });

  it('census-creation invalidates every grid + dashboard prefix', async () => {
    await invalidateAfter('census-creation', scope);
    const fired = new Set(calls.map(c => c.prefix));
    expect(fired.has('grid:measurements')).toBe(true);
    expect(fired.has('grid:measurementssummary')).toBe(true);
    expect(fired.has('grid:summary')).toBe(true);
    expect(fired.has('grid:errors')).toBe(true);
    expect(fired.has('grid:quadrats')).toBe(true);
    expect(fired.has('grid:attributes')).toBe(true);
    expect(fired.has('grid:taxonomies')).toBe(true);
    expect(fired.has('grid:personnel')).toBe(true);
    expect(fired.has('grid:trees')).toBe(true);
    expect(fired.has('grid:stems')).toBe(true);
    expect(fired.has('dashboard:metrics')).toBe(true);
    expect(fired.has('dashboard:changelog')).toBe(true);
    expect(fired.has('dashboard:dataquality')).toBe(true);
    expect(fired.has('dashboard:progress')).toBe(true);
  });

  it('passes scope through to mutateKey unchanged', async () => {
    await invalidateAfter('delete-measurement', scope);
    for (const call of calls) expect(call.scope).toBe(scope);
  });
});
