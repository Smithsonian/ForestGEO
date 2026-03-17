import { describe, it, expect, vi, afterEach } from 'vitest';
import { withTimeout } from './withtimeout';

describe('withTimeout', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects with AbortError when the timeout elapses first', async () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();

    const pendingPromise = new Promise<string>(() => {});
    const resultPromise = withTimeout(pendingPromise, 5000, onTimeout);
    const timeoutExpectation = expect(resultPromise).rejects.toMatchObject({
      name: 'AbortError',
      message: 'Operation timed out after 5000ms'
    });

    await vi.advanceTimersByTimeAsync(5000);

    await timeoutExpectation;
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('returns the original result when the promise resolves in time', async () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();

    const resultPromise = withTimeout(
      new Promise<string>(resolve => {
        setTimeout(() => resolve('done'), 100);
      }),
      5000,
      onTimeout
    );

    await vi.advanceTimersByTimeAsync(100);

    await expect(resultPromise).resolves.toBe('done');
    expect(onTimeout).not.toHaveBeenCalled();
  });
});
