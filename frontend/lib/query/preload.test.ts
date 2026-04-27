import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const preloadSpy = vi.fn();
vi.mock('swr', async () => {
  const actual = await vi.importActual<typeof import('swr')>('swr');
  return { ...actual, preload: (...args: unknown[]) => preloadSpy(...args) };
});

import { preloadKey } from './preload';
import { queryKey } from './queryKey';

describe('preloadKey', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    preloadSpy.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it('fires preload after the 150ms debounce', () => {
    preloadKey(queryKey('grid:measurements', { siteSchema: 's' }), '/api/x');
    vi.advanceTimersByTime(100);
    expect(preloadSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60);
    expect(preloadSpy).toHaveBeenCalledTimes(1);
  });

  it('dedupes the same key within the debounce window', () => {
    const k = queryKey('grid:measurements', { siteSchema: 's' });
    preloadKey(k, '/api/x');
    preloadKey(k, '/api/x');
    vi.advanceTimersByTime(160);
    expect(preloadSpy).toHaveBeenCalledTimes(1);
  });

  it('cancels a pending preload', () => {
    const k = queryKey('grid:measurements', { siteSchema: 's' });
    preloadKey(k, '/api/x');
    vi.advanceTimersByTime(100);
    preloadKey.cancel(k);
    vi.advanceTimersByTime(200);
    expect(preloadSpy).not.toHaveBeenCalled();
  });

  it('different keys queue independently', () => {
    preloadKey(queryKey('grid:measurements', { siteSchema: 's' }), '/api/x');
    preloadKey(queryKey('grid:errors', { siteSchema: 's' }), '/api/y');
    vi.advanceTimersByTime(160);
    expect(preloadSpy).toHaveBeenCalledTimes(2);
  });
});
