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

  it('delete-measurement fans out to measurements, summary, dashboard:metrics', async () => {
    await invalidateAfter('delete-measurement', scope);
    expect(new Set(calls.map(c => c.prefix))).toEqual(
      new Set(['grid:measurements', 'grid:summary', 'dashboard:metrics'])
    );
  });

  it('reingest fans out to errors, measurements, dashboard:metrics', async () => {
    await invalidateAfter('reingest', scope);
    expect(new Set(calls.map(c => c.prefix))).toEqual(
      new Set(['grid:errors', 'grid:measurements', 'dashboard:metrics'])
    );
  });

  it('save-edit-plan fans out to measurements, errors, dashboard:metrics', async () => {
    await invalidateAfter('save-edit-plan', scope);
    expect(new Set(calls.map(c => c.prefix))).toEqual(
      new Set(['grid:measurements', 'grid:errors', 'dashboard:metrics'])
    );
  });

  it('delete-quadrat fans out to quadrats, measurements, dashboard:metrics', async () => {
    await invalidateAfter('delete-quadrat', scope);
    expect(new Set(calls.map(c => c.prefix))).toEqual(
      new Set(['grid:quadrats', 'grid:measurements', 'dashboard:metrics'])
    );
  });

  it('delete-attribute fans out to attributes, measurements, dashboard:metrics', async () => {
    await invalidateAfter('delete-attribute', scope);
    expect(new Set(calls.map(c => c.prefix))).toEqual(
      new Set(['grid:attributes', 'grid:measurements', 'dashboard:metrics'])
    );
  });

  it('delete-taxonomy fans out to taxonomies, measurements, dashboard:metrics', async () => {
    await invalidateAfter('delete-taxonomy', scope);
    expect(new Set(calls.map(c => c.prefix))).toEqual(
      new Set(['grid:taxonomies', 'grid:measurements', 'dashboard:metrics'])
    );
  });

  it('census-creation invalidates every grid + dashboard prefix', async () => {
    await invalidateAfter('census-creation', scope);
    const fired = new Set(calls.map(c => c.prefix));
    expect(fired.has('grid:measurements')).toBe(true);
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
