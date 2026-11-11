/**
 * runQuery timeout quarantine — unit-level contract (no DB).
 *
 * Guards the fix for the Harvard 116k-row upload incident: runQuery's JS-side
 * timeout used to reject the caller while the statement kept executing
 * server-side, and the still-busy connection was released back to the pool.
 * Any later borrower of that connection (including the retry of the same
 * sub-batch) had its commands queued behind the runaway statement, and — for a
 * CALL managing its own transaction — the "timed-out" statement could still
 * COMMIT afterwards. MAX_EXECUTION_TIME offers no server-side backstop here:
 * it applies only to top-level SELECTs, never to CALL / INSERT ... SELECT.
 *
 * The contract asserted here:
 *   1. On timeout, runQuery rejects with a typed QueryTimeoutError carrying the
 *      connection's threadId. Classifiers match the TYPE, never the message.
 *   2. The timed-out connection is destroy()ed FIRST, before any attempt to
 *      acquire a kill connection — destroying frees a pool slot, and under the
 *      saturation this path exists for, doing it the other way round deadlocks.
 *   3. KILL QUERY <threadId> is then issued best-effort from a SEPARATE
 *      connection acquired under a deadline, which is released afterwards.
 *   4. A kill connection that arrives after the deadline is disposed of, not
 *      leaked; failing to get one never reinitializes the pool.
 *   5. The orphaned in-flight promise is logged whichever way it settles —
 *      including the operationally critical "killed too late, work committed".
 *   6. A statement KILLed by anyone else (ER_QUERY_INTERRUPTED, or a killed
 *      connection) also quarantines the connection: its procedure's EXIT HANDLER
 *      never ran, so it may still hold an open transaction.
 *   7. Ordinary query errors and successes do NOT kill or destroy anything.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PoolConnection } from 'mysql2/promise';
import {
  isKilledConnectionError,
  isKilledStatementError,
  KILL_STATEMENT_DEADLINE_MS,
  killQueryOnThread,
  QueryTimeoutError,
  runQuery
} from '@/lib/db/primitives';
import { ConnectionQuarantinedError, isConnectionQuarantined, quarantineConnection } from '@/lib/db/connectionquarantine';
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
const MYSQL_ERRNO_QUERY_INTERRUPTED = 1317;
const MYSQL_ERRNO_CONNECTION_KILLED = 1927;
const NEVER_SETTLES = () => new Promise<never>(() => {});
const flushMicrotasks = () => new Promise(resolve => setTimeout(resolve, 0));

type MockKillConnection = { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> };
type MockTargetConnection = PoolConnection & {
  query: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
};

let killConnection: MockKillConnection;
let tryAcquireConnection: ReturnType<typeof vi.fn>;
let getConnection: ReturnType<typeof vi.fn>;

function makeTargetConnection(threadId: number | undefined, statementImpl: () => Promise<unknown>): MockTargetConnection {
  return {
    threadId,
    query: vi.fn(statementImpl),
    execute: vi.fn(statementImpl),
    destroy: vi.fn(),
    release: vi.fn()
  } as unknown as MockTargetConnection;
}

function mysqlError(message: string, extra: { code?: string; errno?: number }): Error {
  return Object.assign(new Error(message), extra);
}

beforeEach(() => {
  killConnection = {
    query: vi.fn().mockResolvedValue([[], []]),
    release: vi.fn(),
    destroy: vi.fn()
  };
  tryAcquireConnection = vi.fn().mockResolvedValue({ status: 'acquired', connection: killConnection });
  getConnection = vi.fn();
  vi.mocked(getPoolMonitorInstance).mockReturnValue({
    tryAcquireConnection,
    getConnection,
    signalActivity: vi.fn()
  } as unknown as ReturnType<typeof getPoolMonitorInstance>);
});

describe('runQuery timeout quarantine', () => {
  it('rejects with a typed QueryTimeoutError carrying threadId, KILLs the statement, and destroys the connection (CALL path)', async () => {
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

    expect(connection.query).toHaveBeenCalledTimes(1);
    expect(killConnection.query).toHaveBeenCalledWith(`KILL QUERY ${STUCK_THREAD_ID}`);
    expect(killConnection.release).toHaveBeenCalledTimes(1);
    expect(connection.destroy).toHaveBeenCalledTimes(1);
    // Releasing is the caller's job; runQuery must not release (and after
    // destroy(), the caller's release() is a mysql2 no-op).
    expect(connection.release).not.toHaveBeenCalled();
  });

  it('destroys the timed-out connection BEFORE trying to acquire a kill connection', async () => {
    // Ordering is the whole fix for the pool-exhaustion deadlock: with all
    // connections checked out on stuck statements, acquiring first means every
    // firing timeout queues forever behind the saturation it is trying to
    // relieve, and no destroy ever runs. This mock proves the order directly by
    // asserting the connection is already destroyed when the acquisition starts.
    const connection = makeTargetConnection(STUCK_THREAD_ID, NEVER_SETTLES);
    let destroyedBeforeAcquire: boolean | null = null;
    tryAcquireConnection.mockImplementation(async () => {
      destroyedBeforeAcquire = connection.destroy.mock.calls.length > 0;
      return { status: 'acquired', connection: killConnection };
    });

    await expect(runQuery(connection, 'CALL anything()', [], SHORT_TIMEOUT_MS)).rejects.toBeInstanceOf(QueryTimeoutError);

    expect(destroyedBeforeAcquire, 'the poisoned connection must be destroyed before the kill acquisition').toBe(true);
  });

  it('never routes the kill acquisition through the recovering getConnection path', async () => {
    // PoolMonitor.getConnection reinitializes the WHOLE pool when acquisition
    // fails. A best-effort kill that cannot find a spare connection must not
    // take every healthy in-flight query down with it.
    const connection = makeTargetConnection(STUCK_THREAD_ID, NEVER_SETTLES);

    await expect(runQuery(connection, 'CALL anything()', [], SHORT_TIMEOUT_MS)).rejects.toBeInstanceOf(QueryTimeoutError);

    expect(getConnection).not.toHaveBeenCalled();
    expect(tryAcquireConnection).toHaveBeenCalledTimes(1);
  });

  it('still settles (and stays destroyed) when no kill connection can be acquired in time', async () => {
    const connection = makeTargetConnection(STUCK_THREAD_ID, NEVER_SETTLES);
    tryAcquireConnection.mockResolvedValue({ status: 'timeout' });

    await expect(runQuery(connection, 'CALL anything()', [], SHORT_TIMEOUT_MS)).rejects.toBeInstanceOf(QueryTimeoutError);

    expect(connection.destroy).toHaveBeenCalledTimes(1);
    expect(vi.mocked(ailogger.error)).toHaveBeenCalledWith(expect.stringContaining(`Could not KILL QUERY thread ${STUCK_THREAD_ID}`));
  });

  it('still settles when the pool cannot supply a kill connection at all', async () => {
    const connection = makeTargetConnection(STUCK_THREAD_ID, NEVER_SETTLES);
    tryAcquireConnection.mockResolvedValue({ status: 'failed', error: new Error('pool exploded') });

    await expect(runQuery(connection, 'CALL anything()', [], SHORT_TIMEOUT_MS)).rejects.toBeInstanceOf(QueryTimeoutError);

    expect(connection.destroy).toHaveBeenCalledTimes(1);
    expect(vi.mocked(ailogger.error)).toHaveBeenCalledWith(expect.stringContaining('pool exploded'));
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

    expect(tryAcquireConnection).not.toHaveBeenCalled();
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

  it('logs when the orphaned statement SUCCEEDS after the timeout — the killed-too-late case', async () => {
    // The one outcome operators most need to see: the KILL lost the race, the
    // server committed the work, and the caller was told the statement timed
    // out. Nothing downstream can be trusted to treat that as "did not happen"
    // unless it is visible.
    let resolveInFlight!: (rows: unknown) => void;
    const connection = makeTargetConnection(
      STUCK_THREAD_ID,
      () =>
        new Promise(resolve => {
          resolveInFlight = resolve;
        })
    );

    await expect(runQuery(connection, 'CALL bulkingestionprocess(?, ?)', ['s', 'b'], SHORT_TIMEOUT_MS)).rejects.toBeInstanceOf(QueryTimeoutError);

    resolveInFlight([[], []]);
    await flushMicrotasks();
    expect(vi.mocked(ailogger.warn)).toHaveBeenCalledWith(expect.stringContaining('Orphaned statement COMPLETED after query timeout'));
  });

  it.each([
    { label: 'ER_QUERY_INTERRUPTED by code', error: mysqlError('Query execution was interrupted', { code: 'ER_QUERY_INTERRUPTED' }) },
    { label: 'ER_QUERY_INTERRUPTED by errno', error: mysqlError('Query execution was interrupted', { errno: MYSQL_ERRNO_QUERY_INTERRUPTED }) },
    { label: 'ER_CONNECTION_KILLED by errno', error: mysqlError('Connection was killed', { errno: MYSQL_ERRNO_CONNECTION_KILLED }) }
  ])('destroys a connection whose statement was KILLed by someone else ($label)', async ({ error }) => {
    // The procedure's EXIT HANDLER never completed, so its internal
    // START TRANSACTION may still be open on this session. Releasing it would
    // hand the next borrower an uncommitted transaction and make the caller's
    // very next statement lock-wait on the zombie.
    const connection = makeTargetConnection(STUCK_THREAD_ID, () => Promise.reject(error));

    await expect(runQuery(connection, 'CALL bulkingestionprocess(?, ?)', ['s', 'b'], SHORT_TIMEOUT_MS)).rejects.toBe(error);

    expect(connection.destroy).toHaveBeenCalledTimes(1);
    // No second kill: the statement is already dead.
    expect(tryAcquireConnection).not.toHaveBeenCalled();
  });

  it('does not kill or destroy on an ordinary query error', async () => {
    const sqlError = new Error("Table 'x.nonexistent' doesn't exist");
    const connection = makeTargetConnection(STUCK_THREAD_ID, () => Promise.reject(sqlError));

    await expect(runQuery(connection, 'SELECT * FROM nonexistent', [], SHORT_TIMEOUT_MS)).rejects.toBe(sqlError);

    expect(tryAcquireConnection).not.toHaveBeenCalled();
    expect(connection.destroy).not.toHaveBeenCalled();
  });

  it('does not kill or destroy on success and returns the rows', async () => {
    const rows = [{ total: 3 }];
    const connection = makeTargetConnection(STUCK_THREAD_ID, () => Promise.resolve([rows, []]));

    await expect(runQuery(connection, 'SELECT COUNT(*) AS total FROM plots', [], SHORT_TIMEOUT_MS)).resolves.toEqual(rows);

    expect(tryAcquireConnection).not.toHaveBeenCalled();
    expect(connection.destroy).not.toHaveBeenCalled();
  });
});

describe('kill-error classification', () => {
  it('recognizes a KILLed statement by code or errno', () => {
    expect(isKilledStatementError(mysqlError('x', { code: 'ER_QUERY_INTERRUPTED' }))).toBe(true);
    expect(isKilledStatementError(mysqlError('x', { errno: MYSQL_ERRNO_QUERY_INTERRUPTED }))).toBe(true);
    expect(isKilledStatementError(mysqlError('x', { code: 'ER_LOCK_DEADLOCK', errno: 1213 }))).toBe(false);
    expect(isKilledStatementError(null)).toBe(false);
    expect(isKilledStatementError(undefined)).toBe(false);
  });

  it('recognizes a KILLed connection by code or errno', () => {
    expect(isKilledConnectionError(mysqlError('x', { code: 'ER_CONNECTION_KILLED' }))).toBe(true);
    expect(isKilledConnectionError(mysqlError('x', { errno: MYSQL_ERRNO_CONNECTION_KILLED }))).toBe(true);
    expect(isKilledConnectionError(mysqlError('x', { errno: 2013 }))).toBe(false);
    expect(isKilledConnectionError(null)).toBe(false);
  });
});

describe('killQueryOnThread', () => {
  it('reports a successful kill and releases its connection', async () => {
    await expect(killQueryOnThread(STUCK_THREAD_ID, 'unit test')).resolves.toEqual({ status: 'killed' });
    expect(killConnection.release).toHaveBeenCalledTimes(1);
  });

  it('treats a rejected KILL as the benign already-settled race, not an error', async () => {
    killConnection.query.mockRejectedValue(new Error('Unknown thread id'));

    const outcome = await killQueryOnThread(STUCK_THREAD_ID, 'unit test');

    expect(outcome.status).toBe('statement_already_settled');
    expect(killConnection.release).toHaveBeenCalledTimes(1);
    // Logged at info, NOT error: the statement finishing on its own is expected.
    expect(vi.mocked(ailogger.info)).toHaveBeenCalledWith(expect.stringContaining(`KILL QUERY for thread ${STUCK_THREAD_ID} was rejected`));
    expect(vi.mocked(ailogger.error)).not.toHaveBeenCalled();
  });

  it('reports an acquisition timeout at error level and never throws', async () => {
    tryAcquireConnection.mockResolvedValue({ status: 'timeout' });

    const outcome = await killQueryOnThread(STUCK_THREAD_ID, 'unit test');

    expect(outcome).toMatchObject({ status: 'no_kill_connection', reason: 'timeout' });
    expect(vi.mocked(ailogger.error)).toHaveBeenCalledWith(expect.stringContaining('still holds its locks'));
  });

  it('refuses a non-integer thread id without touching the pool', async () => {
    const outcome = await killQueryOnThread(Number.NaN, 'unit test');

    expect(outcome).toMatchObject({ status: 'no_kill_connection', reason: 'failed' });
    expect(tryAcquireConnection).not.toHaveBeenCalled();
  });
});

const SECOND_STATEMENT_SQL = 'SELECT 2 AS queued_behind';

describe('runQuery cancellation by quarantine (U26, U27, R-8)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('U26: quarantining the connection rejects the pending wrapper with ConnectionQuarantinedError and clears its 660 s timer, without a KILL', async () => {
    const connection = makeTargetConnection(STUCK_THREAD_ID, NEVER_SETTLES);
    const timersBefore = vi.getTimerCount();

    const outcome = runQuery(connection, 'SELECT * FROM plots WHERE PlotID = ?', [1]).then(
      () => 'resolved',
      (error: unknown) => error
    );
    await vi.advanceTimersByTimeAsync(0);
    console.log('[U26] timers while pending:', vi.getTimerCount(), 'baseline:', timersBefore);
    expect(vi.getTimerCount(), 'runQuery arms exactly one timer per statement').toBe(timersBefore + 1);

    quarantineConnection(connection, 'unit test quarantine');
    const settled = await outcome;
    console.log('[U26] outcome after quarantine:', settled, 'timers:', vi.getTimerCount());

    expect(settled).toBeInstanceOf(ConnectionQuarantinedError);
    expect((settled as ConnectionQuarantinedError).threadId).toBe(STUCK_THREAD_ID);
    expect(vi.getTimerCount(), 'the 660 s timer must be cleared by the cancellation, not left armed').toBe(timersBefore);
    expect(connection.destroy).toHaveBeenCalledTimes(1);
    expect(tryAcquireConnection, 'whoever quarantined owns the KILL decision; runQuery must not KILL on cancellation').not.toHaveBeenCalled();
  });

  it('U27: runQuery’s own timeout cancels a second statement queued on the same connection at that moment', async () => {
    const connection = makeTargetConnection(STUCK_THREAD_ID, NEVER_SETTLES);
    const timersBefore = vi.getTimerCount();

    const first = runQuery(connection, 'CALL slow_procedure()', [], SHORT_TIMEOUT_MS).then(
      () => 'resolved',
      (error: unknown) => error
    );
    const second = runQuery(connection, SECOND_STATEMENT_SQL, []).then(
      () => 'resolved',
      (error: unknown) => error
    );

    await vi.advanceTimersByTimeAsync(SHORT_TIMEOUT_MS);
    const [firstOutcome, secondOutcome] = await Promise.all([first, second]);
    console.log('[U27] first:', firstOutcome, 'second:', secondOutcome, 'timers:', vi.getTimerCount());

    expect(firstOutcome).toBeInstanceOf(QueryTimeoutError);
    expect(secondOutcome, 'the queued statement must be cancelled with the connection, not wait for its own 660 s timer').toBeInstanceOf(
      ConnectionQuarantinedError
    );
    expect(vi.getTimerCount()).toBe(timersBefore);
    expect(connection.destroy).toHaveBeenCalledTimes(1);
  });

  it('R-8: rejects at once without issuing the statement when the connection is already quarantined', async () => {
    const connection = makeTargetConnection(STUCK_THREAD_ID, NEVER_SETTLES);
    quarantineConnection(connection, 'quarantined earlier');
    const timersBefore = vi.getTimerCount();

    await expect(runQuery(connection, 'SELECT 1', [])).rejects.toBeInstanceOf(ConnectionQuarantinedError);

    expect(connection.query).not.toHaveBeenCalled();
    expect(connection.execute).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(timersBefore);
  });
});

describe('runQuery protocol choice for session commands (U28)', () => {
  it.each(['USE `forestgeo_testing`', 'START TRANSACTION', '  start transaction'])('sends %s over the text protocol (not preparable, E6)', async sql => {
    const connection = makeTargetConnection(STUCK_THREAD_ID, () => Promise.resolve([[], []]));
    await runQuery(connection, sql);
    console.log(`[U28] ${sql}: query calls=${connection.query.mock.calls.length} execute calls=${connection.execute.mock.calls.length}`);
    expect(connection.query).toHaveBeenCalledTimes(1);
    expect(connection.execute).not.toHaveBeenCalled();
  });

  // Parameterless on purpose: a `?`-bound session variable fails over the prepared protocol (rule 12, ER_WRONG_TYPE_FOR_VAR).
  it('keeps a parameterless SET SESSION on the prepared protocol', async () => {
    const connection = makeTargetConnection(STUCK_THREAD_ID, () => Promise.resolve([[], []]));
    await runQuery(connection, 'SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED');
    expect(connection.execute).toHaveBeenCalledTimes(1);
    expect(connection.query).not.toHaveBeenCalled();
  });
});

describe('killQueryOnThread KILL statement deadline (U29)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('returns kill_deadline_exceeded at the deadline, quarantines the kill connection and never releases it', async () => {
    killConnection.query.mockImplementation(NEVER_SETTLES);
    let outcome: unknown = 'pending';
    const killing = killQueryOnThread(STUCK_THREAD_ID, 'unit test').then(value => (outcome = value));

    await vi.advanceTimersByTimeAsync(KILL_STATEMENT_DEADLINE_MS - 1);
    expect(outcome, 'must not give up before the KILL deadline').toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    await killing;
    console.log('[U29] outcome:', outcome);

    expect(outcome).toMatchObject({ status: 'kill_deadline_exceeded' });
    expect(killConnection.destroy, 'a kill connection with an unanswered KILL is quarantined').toHaveBeenCalledTimes(1);
    expect(killConnection.release, 'and never returned to the pool').not.toHaveBeenCalled();
  });
});

describe('runQuery timeout quarantines through the registry', () => {
  it('a timed-out connection is reported as quarantined', async () => {
    const connection = makeTargetConnection(STUCK_THREAD_ID, NEVER_SETTLES);
    await expect(runQuery(connection, 'CALL anything()', [], SHORT_TIMEOUT_MS)).rejects.toBeInstanceOf(QueryTimeoutError);
    expect(isConnectionQuarantined(connection)).toBe(true);
  });
});
