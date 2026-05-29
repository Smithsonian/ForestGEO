import { describe, expect, it, vi } from 'vitest';

const mutateSpy = vi.fn().mockResolvedValue(undefined);
vi.mock('swr', async () => {
  const actual = await vi.importActual<typeof import('swr')>('swr');
  return { ...actual, mutate: (...args: unknown[]) => mutateSpy(...args) };
});

import { mutateKey } from './mutateKey';

describe('mutateKey', () => {
  it('passes a matcher function and revalidate: true by default', async () => {
    mutateSpy.mockClear();
    await mutateKey('grid:measurements');
    expect(mutateSpy).toHaveBeenCalledTimes(1);
    const [matcher, , opts] = mutateSpy.mock.calls[0];
    expect(typeof matcher).toBe('function');
    expect(opts).toMatchObject({ revalidate: true });
  });

  it('matcher returns true for a key with the matching prefix', async () => {
    mutateSpy.mockClear();
    await mutateKey('grid:measurements');
    const matcher = mutateSpy.mock.calls[0][0] as (k: unknown) => boolean;
    expect(matcher(['grid:measurements', 's|1|2', undefined, '/api/x'])).toBe(true);
    expect(matcher(['grid:errors', 's|1|2', undefined, '/api/x'])).toBe(false);
  });

  it('matcher returns false for non-array keys', async () => {
    mutateSpy.mockClear();
    await mutateKey('grid:measurements');
    const matcher = mutateSpy.mock.calls[0][0] as (k: unknown) => boolean;
    expect(matcher('plain-string-key')).toBe(false);
    expect(matcher(undefined)).toBe(false);
    expect(matcher(null)).toBe(false);
    expect(matcher(['grid:measurements'])).toBe(false); // too short
  });

  it('matcher with scope further filters by scope key', async () => {
    mutateSpy.mockClear();
    await mutateKey('grid:measurements', { scope: { siteSchema: 's', plotID: 1, censusID: 2 } });
    const matcher = mutateSpy.mock.calls[0][0] as (k: unknown) => boolean;
    expect(matcher(['grid:measurements', 's|1|2', undefined])).toBe(true);
    expect(matcher(['grid:measurements', 'other|1|2', undefined])).toBe(false);
  });

  it('passes revalidate: false when requested', async () => {
    mutateSpy.mockClear();
    await mutateKey('grid:measurements', { revalidate: false });
    expect(mutateSpy.mock.calls[0][2]).toMatchObject({ revalidate: false });
  });
});
