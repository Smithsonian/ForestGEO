/**
 * runQuery timeout quarantine — unit-level contract (no DB).
 *
 * Guards the fix for the Harvard 106k-row upload incident: runQuery's JS-side
 * timeout used to reject the caller while the statement kept executing
 * server-side, and the still-busy connection was released back to the pool.
 * Any later borrower of that connection (including the retry of the same
 * sub-batch) had its commands queued behind the runaway statement, and — for a
 * CALL managing its own transaction — the "timed-out" statement could still
 * COMMIT afterwards. MAX_EXECUTION_TIME offers no server-side backstop here:
 * it applies only to top-level SELECTs, never to CALL / INSERT ... SELECT.
 *
 * The contract asserted here:
 *   1. On timeout, runQuery rejects with QueryTimeoutError (message keeps the
 *      'timed out' phrase that error classifiers match on) carrying the
 *      connection's threadId.
 *   2. KILL QUERY <threadId> is issued from a SEPARATE pooled connection, which
 *      is then released.
 *   3. The timed-out connection is destroy()ed — never released — so it cannot
 *      re-enter the pool with a statement still in flight.
 *   4. The orphaned in-flight promise's eventual rejection is swallowed (logged)
 *      instead of surfacing as an unhandled rejection.
 *   5. Ordinary query errors and successes do NOT kill or destroy anything.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PoolConnection } from 'mysql2/promise';
import { killQueryOnThread, QueryTimeoutError, runQuery } from '@/lib/db/primitives';
import { getPoolMonitorInstance } from '@/lib/db/poolmonitorsingleton';
import ailogger from '@/ailogger';

vi.mock('@/lib/db/poolmonitorsingleton', () => ({
  getPoolMonitorInstance: vi.fn()
}));
vi.mock('@/ailogger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

const SHORT_TIMEOUT_MS = 25;
const STUCK_THREAD_ID = 4242;
const NEVER_SETTLES = () => new Promise<never>(() => {});
const flushMicrotasks = () => new Promise(resolve => setTimeout(resolve, 0));

type MockKillConnection = { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };
type MockTargetConnection = PoolConnection & {
  query: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
};

let killConnection: MockKillConnection;

function makeTargetConnection(threadId: number | undefined, statementImpl: () => Promise<unknown>): MockTargetConnection {
  return {
    threadId,
    query: vi.fn(statementImpl),
    execute: vi.fn(statementImpl),
    destroy: vi.fn(),
    release: vi.fn()
  } as unknown as MockTargetConnection;
}

beforeEach(() => {
  killConnection = {
    query: vi.fn().mockResolvedValue([[], []]),
    release: vi.fn()
  };
  vi.mocked(getPoolMonitorInstance).mockReturnValue({
    getConnection: vi.fn().mockResolvedValue(killConnection),
    signalActivity: vi.fn()
  } as unknown as ReturnType<typeof getPoolMonitorInstance>);
});

describe('runQuery timeout quarantine', () => {
  it('rejects with QueryTimeoutError carrying threadId, KILLs the statement, and destroys the connection (CALL path)', async () => {
    const connection = makeTargetConnection(STUCK_THREAD_ID, NEVER_SETTLES);

    const rejection = await runQuery(connection, 'CALL bulkingestionprocess(?, ?)', ['schema', 'batch'], SHORT_TIMEOUT_MS).then(
      () => {
        throw new Error('runQuery resolved but the statement never settles — timeout did not fire');
      },
      (err: unknown) => err
    );

    expect(rejection).toBeInstanceOf(QueryTimeoutError);
    const timeoutError = rejection as QueryTimeoutError;
    expect(timeoutError.threadId).toBe(STUCK_THREAD_ID);
    expect(timeoutError.timeoutMs).toBe(SHORT_TIMEOUT_MS);
    // ingest-batch classifies retryable timeouts via message.includes('timed out') —
    // the phrase is load-bearing, not cosmetic.
    expect(timeoutError.message).toContain('timed out');

    expect(connection.query).toHaveBeenCalledTimes(1);
    expect(killConnection.query).toHaveBeenCalledWith(`KILL QUERY ${STUCK_THREAD_ID}`);
    expect(killConnection.release).toHaveBeenCalledTimes(1);
    expect(connection.destroy).toHaveBeenCalledTimes(1);
    // Releasing is the caller's job; runQuery must not release (and after
    // destroy(), the caller's release() is a mysql2 no-op).
    expect(connection.release).not.toHaveBeenCalled();
  });

  it('quarantines the execute() path the same way (non-CALL, non-bulk statement)', async () => {
    const connection = makeTargetConnection(STUCK_THREAD_ID, NEVER_SETTLES);

    await expect(runQuery(connection, 'SELECT * FROM coremeasurements', [], SHORT_TIMEOUT_MS)).rejects.toBeInstanceOf(QueryTimeoutError);

    expect(connection.execute).toHaveBeenCalledTimes(1);
    expect(killConnection.query).toHaveBeenCalledWith(`KILL QUERY ${STUCK_THREAD_ID}`);
    expect(connection.destroy).toHaveBeenCalledTimes(1);
  });

  it('still destroys the connection when threadId is unavailable, but attempts no KILL', async () => {
    const connection = makeTargetConnection(undefined, NEVER_SETTLES);

    await expect(runQuery(connection, 'CALL anything()', [], SHORT_TIMEOUT_MS)).rejects.toBeInstanceOf(QueryTimeoutError);

    expect(killConnection.query).not.toHaveBeenCalled();
    expect(connection.destroy).toHaveBeenCalledTimes(1);
  });

  it('swallows and logs the orphaned statement rejection after a timeout', async () => {
    let rejectInFlight!: (err: Error) => void;
    const connection = makeTargetConnection(
      STUCK_THREAD_ID,
      () =>
        new Promise((_, reject) => {
          rejectInFlight = reject;
        })
    );

    await expect(runQuery(connection, 'CALL anything()', [], SHORT_TIMEOUT_MS)).rejects.toBeInstanceOf(QueryTimeoutError);

    // Simulate the KILLed statement settling later with ER_QUERY_INTERRUPTED.
    // If unhandled, vitest fails the run; the explicit warn proves the swallow
    // handler (not luck) absorbed it.
    rejectInFlight(new Error('Query execution was interrupted'));
    await flushMicrotasks();
    expect(vi.mocked(ailogger.warn)).toHaveBeenCalledWith(expect.stringContaining('Orphaned statement settled after query timeout'));
  });

  it('does not kill or destroy on an ordinary query error', async () => {
    const sqlError = new Error("Table 'x.nonexistent' doesn't exist");
    const connection = makeTargetConnection(STUCK_THREAD_ID, () => Promise.reject(sqlError));

    await expect(runQuery(connection, 'SELECT * FROM nonexistent', [], SHORT_TIMEOUT_MS)).rejects.toBe(sqlError);

    expect(killConnection.query).not.toHaveBeenCalled();
    expect(connection.destroy).not.toHaveBeenCalled();
  });

  it('does not kill or destroy on success and returns the rows', async () => {
    const rows = [{ total: 3 }];
    const connection = makeTargetConnection(STUCK_THREAD_ID, () => Promise.resolve([rows, []]));

    await expect(runQuery(connection, 'SELECT COUNT(*) AS total FROM plots', [], SHORT_TIMEOUT_MS)).resolves.toEqual(rows);

    expect(killConnection.query).not.toHaveBeenCalled();
    expect(connection.destroy).not.toHaveBeenCalled();
  });

  it('killQueryOnThread releases its own connection even when KILL fails, and never throws', async () => {
    killConnection.query.mockRejectedValue(new Error('Unknown thread id'));

    await expect(killQueryOnThread(STUCK_THREAD_ID, 'unit test')).resolves.toBeUndefined();

    expect(killConnection.release).toHaveBeenCalledTimes(1);
    expect(vi.mocked(ailogger.warn)).toHaveBeenCalledWith(expect.stringContaining(`KILL QUERY for thread ${STUCK_THREAD_ID} failed`));
  });
});
