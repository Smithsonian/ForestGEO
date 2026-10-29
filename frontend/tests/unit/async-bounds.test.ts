import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { delay, waitFor } from '../integration/helpers/async-bounds';

const TIGHT_BOUND_MS = 10;
const SLOW_CONDITION_MS = 50;
const POLL_INTERVAL_MS = 5;
const IMMEDIATE_SUCCESS_BOUND_MS = 1000;
const DESCRIPTION = 'committed row becomes visible';

describe('waitFor deadline enforcement', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the elapsed time when the condition is true on the first poll', async () => {
    const pending = waitFor(() => true, IMMEDIATE_SUCCESS_BOUND_MS, DESCRIPTION, POLL_INTERVAL_MS);

    await expect(pending).resolves.toBe(0);
  });

  it('rejects a condition that only returns true after the bound has passed', async () => {
    const lateSuccess = async () => {
      await delay(SLOW_CONDITION_MS);
      return true;
    };

    const outcome = waitFor(lateSuccess, TIGHT_BOUND_MS, DESCRIPTION, POLL_INTERVAL_MS).then(
      elapsedMs => ({ resolvedAfterMs: elapsedMs }),
      (error: Error) => ({ rejectedWith: error.message })
    );
    await vi.advanceTimersByTimeAsync(SLOW_CONDITION_MS);

    expect(await outcome, `late success must not be accepted: bound ${TIGHT_BOUND_MS}ms, condition took ${SLOW_CONDITION_MS}ms`).toEqual({
      rejectedWith: `Condition not met within ${TIGHT_BOUND_MS}ms: ${DESCRIPTION}`
    });
  });

  it('rejects at the bound when the condition never settles', async () => {
    const neverSettles = () => new Promise<boolean>(() => undefined);

    const outcome = waitFor(neverSettles, TIGHT_BOUND_MS, DESCRIPTION, POLL_INTERVAL_MS).then(
      elapsedMs => ({ resolvedAfterMs: elapsedMs }),
      (error: Error) => ({ rejectedWith: error.message })
    );
    await vi.advanceTimersByTimeAsync(TIGHT_BOUND_MS);

    expect(await outcome, 'a hung condition must fail at the bound instead of hanging the test').toEqual({
      rejectedWith: `Condition not met within ${TIGHT_BOUND_MS}ms: ${DESCRIPTION}`
    });
  });

  it('propagates an error thrown by the condition instead of reporting a missed deadline', async () => {
    const failure = new Error('probe query failed');

    const pending = waitFor(() => Promise.reject(failure), IMMEDIATE_SUCCESS_BOUND_MS, DESCRIPTION, POLL_INTERVAL_MS);

    await expect(pending).rejects.toBe(failure);
  });

  it('leaves no timers behind after the condition succeeds', async () => {
    await waitFor(() => true, IMMEDIATE_SUCCESS_BOUND_MS, DESCRIPTION, POLL_INTERVAL_MS);

    expect(vi.getTimerCount()).toBe(0);
  });
});
