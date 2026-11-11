import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PoolConnection } from 'mysql2/promise';

vi.mock('@/ailogger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import ailogger from '@/ailogger';
import { ConnectionQuarantinedError, isConnectionQuarantined, quarantineConnection, settleWithinDeadline, trackManagedStatement } from './connectionquarantine';

const DEADLINE_MS = 1_000;
const BEFORE_DEADLINE_MS = DEADLINE_MS - 1;
const QUARANTINE_REASON = 'unit test quarantine';
const FAKE_THREAD_ID = 9_563;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fakeConnection(): PoolConnection & { destroy: ReturnType<typeof vi.fn> } {
  return { threadId: FAKE_THREAD_ID, destroy: vi.fn() } as unknown as PoolConnection & { destroy: ReturnType<typeof vi.fn> };
}

describe('settleWithinDeadline (U30)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('returns the value and clears its timer when the operation settles first', async () => {
    const timersBefore = vi.getTimerCount();
    const operation = deferred<string>();
    const onLate = vi.fn();
    const settlement = settleWithinDeadline(operation.promise, DEADLINE_MS, onLate);
    expect(vi.getTimerCount(), 'one deadline timer while pending').toBe(timersBefore + 1);

    operation.resolve('acknowledged');
    const outcome = await settlement;
    console.log('[settle] early resolution outcome:', outcome, 'timers after:', vi.getTimerCount());
    expect(outcome).toEqual({ status: 'settled', value: 'acknowledged' });
    expect(vi.getTimerCount(), 'the deadline timer must be cleared when the operation wins').toBe(timersBefore);
    expect(onLate).not.toHaveBeenCalled();
  });

  it('returns the failure (not a throw) and clears its timer when the operation rejects first', async () => {
    const timersBefore = vi.getTimerCount();
    const failure = new Error('server rejected');
    const outcome = await settleWithinDeadline(Promise.reject(failure), DEADLINE_MS, vi.fn());
    expect(outcome).toEqual({ status: 'failed', error: failure });
    expect(vi.getTimerCount()).toBe(timersBefore);
  });

  it('reports deadline_exceeded at the deadline and hands a late resolution to onLateSettlement exactly once', async () => {
    const operation = deferred<string>();
    const onLate = vi.fn();
    let outcome: unknown = 'pending';
    void settleWithinDeadline(operation.promise, DEADLINE_MS, onLate).then(value => (outcome = value));

    await vi.advanceTimersByTimeAsync(BEFORE_DEADLINE_MS);
    expect(outcome, 'must still be pending 1 ms before the deadline').toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    expect(outcome).toEqual({ status: 'deadline_exceeded' });

    operation.resolve('late ack');
    await vi.advanceTimersByTimeAsync(0);
    console.log('[settle] late resolution calls:', onLate.mock.calls);
    expect(onLate).toHaveBeenCalledTimes(1);
    expect(onLate).toHaveBeenCalledWith({ status: 'settled' });
  });

  it('hands a late rejection to onLateSettlement once and never surfaces it as an unhandled rejection', async () => {
    // The real guard is vitest itself: it fails the run on any unhandled rejection. The process listener below only
    // makes an escape visible inside this test's own assertions.
    const operation = deferred<string>();
    const onLate = vi.fn();
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const settlement = settleWithinDeadline(operation.promise, DEADLINE_MS, onLate);
      await vi.advanceTimersByTimeAsync(DEADLINE_MS);
      await expect(settlement).resolves.toEqual({ status: 'deadline_exceeded' });
      const lateError = new Error('late transport loss');
      operation.reject(lateError);
      await vi.advanceTimersByTimeAsync(0);
      expect(onLate).toHaveBeenCalledTimes(1);
      expect(onLate).toHaveBeenCalledWith({ status: 'failed', error: lateError });
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});

describe('quarantineConnection and the managed-statement registry', () => {
  beforeEach(() => vi.clearAllMocks());

  it('destroys once across repeated calls and reports the connection as quarantined', () => {
    const connection = fakeConnection();
    expect(isConnectionQuarantined(connection)).toBe(false);
    quarantineConnection(connection, QUARANTINE_REASON);
    quarantineConnection(connection, QUARANTINE_REASON);
    console.log('[quarantine] destroy calls:', connection.destroy.mock.calls.length);
    expect(connection.destroy, 'destroy must run exactly once however often the connection is quarantined').toHaveBeenCalledTimes(1);
    expect(isConnectionQuarantined(connection)).toBe(true);
  });

  it('cancels every tracked statement on that connection synchronously with the reason, and none on another connection', () => {
    const connection = fakeConnection();
    const other = fakeConnection();
    const first = vi.fn();
    const second = vi.fn();
    const otherCancel = vi.fn();
    trackManagedStatement(connection, first);
    trackManagedStatement(connection, second);
    trackManagedStatement(other, otherCancel);

    quarantineConnection(connection, QUARANTINE_REASON);

    expect(first).toHaveBeenCalledWith(QUARANTINE_REASON);
    expect(second).toHaveBeenCalledWith(QUARANTINE_REASON);
    expect(otherCancel, 'quarantine is per connection').not.toHaveBeenCalled();
  });

  it('does not call a cancel that was unregistered before the quarantine, and cancels each statement only once', () => {
    const connection = fakeConnection();
    const finished = vi.fn();
    const pending = vi.fn();
    const untrackFinished = trackManagedStatement(connection, finished);
    trackManagedStatement(connection, pending);
    untrackFinished();

    quarantineConnection(connection, QUARANTINE_REASON);
    quarantineConnection(connection, QUARANTINE_REASON);

    expect(finished).not.toHaveBeenCalled();
    expect(pending).toHaveBeenCalledTimes(1);
  });

  it('never throws when destroy throws, and logs the failure with the reason', () => {
    const connection = fakeConnection();
    const destroyError = new Error('socket already torn down');
    connection.destroy.mockImplementation(() => {
      throw destroyError;
    });
    const cancel = vi.fn();
    trackManagedStatement(connection, cancel);

    expect(() => quarantineConnection(connection, QUARANTINE_REASON)).not.toThrow();

    expect(cancel, 'tracked statements are cancelled even when destroy throws').toHaveBeenCalledWith(QUARANTINE_REASON);
    expect(vi.mocked(ailogger.error)).toHaveBeenCalledWith(expect.stringContaining(QUARANTINE_REASON), destroyError);
  });

  it('ConnectionQuarantinedError keeps the reason out of its fixed message', () => {
    const error = new ConnectionQuarantinedError(FAKE_THREAD_ID, 'query timeout');
    console.log('[quarantine] error:', { name: error.name, message: error.message, reason: error.reason });
    expect(error.name).toBe('ConnectionQuarantinedError');
    expect(error.threadId).toBe(FAKE_THREAD_ID);
    expect(error.reason).toBe('query timeout');
    expect(error.message).not.toContain('timeout');
  });
});
