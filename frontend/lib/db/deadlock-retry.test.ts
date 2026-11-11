import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { warnMock } = vi.hoisted(() => ({ warnMock: vi.fn() }));
vi.mock('@/ailogger', () => ({ default: { info: vi.fn(), warn: warnMock, error: vi.fn(), debug: vi.fn() } }));

import {
  DEADLOCK_RETRY_BACKOFF_MULTIPLIER,
  DEADLOCK_RETRY_EVENT,
  DEADLOCK_RETRY_INITIAL_DELAY_MS,
  DEADLOCK_RETRY_MAX_ATTEMPTS,
  isDeadlockError,
  MYSQL_DEADLOCK_ERRNO,
  MYSQL_DEADLOCK_ERROR_CODE,
  retryWholeTransactionOnDeadlock
} from './deadlock-retry';
import { TransactionCallbackTimeoutError } from './transactionerrors';
import { ChangelogOperation, ChangelogWriteError } from '@/lib/changelog/record-mutation';

const TRANSACTION_KIND = 'unit_test_transaction';
const TRANSACTION_RESULT = 'committed-value';
const LOCK_WAIT_TIMEOUT = { code: 'ER_LOCK_WAIT_TIMEOUT', errno: 1205 } as const;
const QUERY_INTERRUPTED = { code: 'ER_QUERY_INTERRUPTED', errno: 1317 } as const;
const CONNECTION_LOST_CODE = 'PROTOCOL_CONNECTION_LOST';
const CALLBACK_TIMEOUT_MS = 60_000;
const ONE_MILLISECOND = 1;

function driverError(message: string, shape: { code: string; errno?: number }): Error {
  return Object.assign(new Error(message), shape);
}

function deadlock(): Error {
  return driverError('Deadlock found when trying to get lock; try restarting transaction', { code: MYSQL_DEADLOCK_ERROR_CODE, errno: MYSQL_DEADLOCK_ERRNO });
}

describe('isDeadlockError', () => {
  it('recognises 1213 by code, by errno, and on a wrapped cause; nothing else', () => {
    const wrapped = new ChangelogWriteError(ChangelogOperation.DELETE, 'coremeasurements', '1,2', deadlock());
    const cases: Array<[string, unknown, boolean]> = [
      ['driver deadlock', deadlock(), true],
      ['errno only', { errno: MYSQL_DEADLOCK_ERRNO }, true],
      ['code only', { code: MYSQL_DEADLOCK_ERROR_CODE }, true],
      ['ChangelogWriteError wrapping a deadlock', wrapped, true],
      ['lock wait timeout 1205', driverError('Lock wait timeout exceeded', LOCK_WAIT_TIMEOUT), false],
      ['plain Error', new Error('boom'), false],
      ['null', null, false],
      ['string', 'ER_LOCK_DEADLOCK', false]
    ];
    for (const [label, candidate, expected] of cases) {
      console.log(`[U13 isDeadlockError] ${label} -> ${isDeadlockError(candidate)}`);
      expect(isDeadlockError(candidate), label).toBe(expected);
    }
  });
});

describe('retryWholeTransactionOnDeadlock (U13)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('re-runs the whole attempt after one deadlock and returns the second attempt’s value (catches: no retry)', async () => {
    const attempt = vi.fn().mockRejectedValueOnce(deadlock()).mockResolvedValueOnce(TRANSACTION_RESULT);
    const onRetry = vi.fn();
    const pending = retryWholeTransactionOnDeadlock(TRANSACTION_KIND, attempt, onRetry);
    await vi.runAllTimersAsync();
    const result = await pending;
    console.log(
      `[U13 one deadlock] attempts=${attempt.mock.calls.length} onRetry=${JSON.stringify(onRetry.mock.calls)} warn=${JSON.stringify(warnMock.mock.calls)}`
    );
    expect(result).toBe(TRANSACTION_RESULT);
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(onRetry.mock.calls).toEqual([[1]]);
    expect(warnMock).toHaveBeenCalledWith(DEADLOCK_RETRY_EVENT, expect.objectContaining({ transactionKind: TRANSACTION_KIND, failedAttempt: 1 }));
  });

  it('retries a deadlock carried as the cause of a ChangelogWriteError (catches: a wrapped deadlock missed)', async () => {
    const wrapped = new ChangelogWriteError(ChangelogOperation.DELETE, 'coremeasurements', '7', deadlock());
    const attempt = vi.fn().mockRejectedValueOnce(wrapped).mockResolvedValueOnce(TRANSACTION_RESULT);
    const pending = retryWholeTransactionOnDeadlock(TRANSACTION_KIND, attempt);
    await vi.runAllTimersAsync();
    expect(await pending).toBe(TRANSACTION_RESULT);
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it(`stops after ${DEADLOCK_RETRY_MAX_ATTEMPTS} attempts and rethrows the last deadlock unchanged (catches: unbounded retry; a wrapped or replaced error)`, async () => {
    const third = deadlock();
    const attempt = vi.fn().mockRejectedValueOnce(deadlock()).mockRejectedValueOnce(deadlock()).mockRejectedValueOnce(third);
    const pending = retryWholeTransactionOnDeadlock(TRANSACTION_KIND, attempt);
    const settled = pending.then(
      () => null,
      (error: unknown) => error
    );
    await vi.runAllTimersAsync();
    const caught = await settled;
    console.log(`[U13 exhaustion] attempts=${attempt.mock.calls.length} caught=${String(caught)}`);
    expect(attempt).toHaveBeenCalledTimes(DEADLOCK_RETRY_MAX_ATTEMPTS);
    expect(caught).toBe(third);
  });

  it('waits min(initial × 1.5^(n−1), cap) between attempts (catches: no backoff, or the wrong curve)', async () => {
    const startedAt: number[] = [];
    const attempt = vi.fn(async () => {
      startedAt.push(Date.now());
      if (startedAt.length < DEADLOCK_RETRY_MAX_ATTEMPTS) throw deadlock();
      return TRANSACTION_RESULT;
    });
    const pending = retryWholeTransactionOnDeadlock(TRANSACTION_KIND, attempt);
    await vi.advanceTimersByTimeAsync(DEADLOCK_RETRY_INITIAL_DELAY_MS - ONE_MILLISECOND);
    expect(attempt, 'attempt 2 must not start before the first delay').toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(ONE_MILLISECOND);
    expect(attempt).toHaveBeenCalledTimes(2);
    const secondDelayMs = DEADLOCK_RETRY_INITIAL_DELAY_MS * DEADLOCK_RETRY_BACKOFF_MULTIPLIER;
    await vi.advanceTimersByTimeAsync(secondDelayMs - ONE_MILLISECOND);
    expect(attempt, 'attempt 3 must not start before the second delay').toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(ONE_MILLISECOND);
    expect(await pending).toBe(TRANSACTION_RESULT);
    console.log(`[U13 backoff] gaps=${JSON.stringify(startedAt.slice(1).map((time, index) => time - startedAt[index]))}`);
    expect(startedAt.slice(1).map((time, index) => time - startedAt[index])).toEqual([DEADLOCK_RETRY_INITIAL_DELAY_MS, secondDelayMs]);
  });

  it.each([
    ['lock wait timeout 1205', () => driverError('Lock wait timeout exceeded; try restarting transaction', LOCK_WAIT_TIMEOUT)],
    ['TransactionCallbackTimeoutError', () => new TransactionCallbackTimeoutError('tx-unit', CALLBACK_TIMEOUT_MS)],
    ['KILL QUERY (ER_QUERY_INTERRUPTED)', () => driverError('Query execution was interrupted', QUERY_INTERRUPTED)],
    ['connection lost', () => driverError('Connection lost: The server closed the connection.', { code: CONNECTION_LOST_CODE })],
    ['plain Error', () => new Error('count mismatch')]
  ])('does not retry %s (catches: retrying non-deadlock errors)', async (_label, makeError) => {
    const failure = makeError();
    const attempt = vi.fn().mockRejectedValue(failure);
    await expect(retryWholeTransactionOnDeadlock(TRANSACTION_KIND, attempt)).rejects.toBe(failure);
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(warnMock).not.toHaveBeenCalled();
  });
});
