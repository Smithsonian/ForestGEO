import { vi } from 'vitest';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import type ConnectionManager from '@/lib/db/connectionmanager';
import { MYSQL_DEADLOCK_ERRNO, MYSQL_DEADLOCK_ERROR_CODE } from '@/lib/db/deadlock-retry';

export const BARRIER_DEADLINE_MS = 15_000;
/** INNODB_TRX is served from a cache that refreshes only after 100 ms without a read; a tighter poll never sees a new waiter. */
export const LOCK_WAIT_POLL_INTERVAL_MS = 150;
export const MYSQL_LOCK_WAIT_TIMEOUT_ERRNO = 1205;
const MYSQL_DEADLOCK_SQLSTATE = '40001';
const MYSQL_DEADLOCK_MESSAGE = 'Deadlock found when trying to get lock; try restarting transaction';
const STATEMENT_PREVIEW_LENGTH = 150;

export interface RecordedStatement {
  sequence: number;
  transactionID: string | undefined;
  sql: string;
  params: unknown[];
  /** True once the statement returned or threw. A recorded CALL that has not settled is still running inside the procedure. */
  settled: boolean;
}
export type StatementMatcher = (statement: RecordedStatement) => boolean;
export type BarrierPlacement = 'before' | 'after';

export interface Barrier {
  reached: Promise<void>;
  gate: Promise<void>;
  markReached(): void;
  release(): void;
}

export function createBarrier(): Barrier {
  let markReached!: () => void;
  let release!: () => void;
  const reached = new Promise<void>(resolve => (markReached = resolve));
  const gate = new Promise<void>(resolve => (release = resolve));
  return { reached, gate, markReached, release };
}

export class BarrierDeadlineError extends Error {
  constructor(label: string, statementLog: string) {
    super(`${label} not reached within ${BARRIER_DEADLINE_MS} ms. Statements:\n${statementLog}`);
    this.name = 'BarrierDeadlineError';
  }
}

export async function withinDeadline<T>(promise: Promise<T>, label: string, renderStatementLog: () => string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new BarrierDeadlineError(label, renderStatementLog())), BARRIER_DEADLINE_MS);
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

export function sleep(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

/** The shape mysql2 gives an InnoDB deadlock, for test-side injection after a statement really ran. */
export function deadlockShapedError(): Error & { code: string; errno: number; sqlState: string } {
  return Object.assign(new Error(MYSQL_DEADLOCK_MESSAGE), { code: MYSQL_DEADLOCK_ERROR_CODE, errno: MYSQL_DEADLOCK_ERRNO, sqlState: MYSQL_DEADLOCK_SQLSTATE });
}

export function matching(pattern: RegExp, also: StatementMatcher = () => true): StatementMatcher {
  return statement => pattern.test(statement.sql) && also(statement);
}

interface PlacedBarrier {
  matcher: StatementMatcher;
  occurrence: number;
  placement: BarrierPlacement;
  seen: number;
  barrier: Barrier;
}
interface PlacedInjection {
  matcher: StatementMatcher;
  occurrence: number;
  seen: number;
  fired: boolean;
  makeError: () => Error;
}

export interface StatementHarness {
  statements: RecordedStatement[];
  commitOrder: string[];
  rollbackOrder: string[];
  renderStatementLog(): string;
  /** Parks the `occurrence`-th (1-based) statement matching `matcher` before or after it runs, until `release()`. */
  placeBarrier(matcher: StatementMatcher, occurrence: number, placement: BarrierPlacement): Barrier;
  /** Throws `makeError()` once, right after the `occurrence`-th statement matching `matcher` ran for real. */
  injectAfter(matcher: StatementMatcher, occurrence: number, makeError: () => Error): { fired(): boolean };
  /** Distinct transaction ids, in first-seen order, that ran a statement matching `matcher`. */
  transactionsRunning(matcher: StatementMatcher): string[];
  track<T>(promise: Promise<T>): Promise<T>;
  settleAndRestore(scenarioFailed: boolean): Promise<void>;
}

/**
 * Test-side wrapper around a real ConnectionManager: records every statement with its transaction id, parks
 * chosen statements at barriers, and injects failures after a statement ran. withTransaction, tx.query and
 * transactionExecutorFor all go through executeQuery/commitTransaction/rollbackTransaction on the instance, so
 * the spies see every statement and every end. Product code carries no hook.
 */
export function createStatementHarness(manager: ConnectionManager): StatementHarness {
  const statements: RecordedStatement[] = [];
  const commitOrder: string[] = [];
  const rollbackOrder: string[] = [];
  const barriers: PlacedBarrier[] = [];
  const injections: PlacedInjection[] = [];
  const trackedPromises: Promise<unknown>[] = [];
  const originalExecuteQuery = manager.executeQuery.bind(manager);
  const originalCommitTransaction = manager.commitTransaction.bind(manager);
  const originalRollbackTransaction = manager.rollbackTransaction.bind(manager);

  const renderStatementLog = () =>
    statements
      .map(
        statement =>
          `#${statement.sequence} ${statement.transactionID ?? 'no-tx'} ${statement.sql.replace(/\s+/g, ' ').trim().slice(0, STATEMENT_PREVIEW_LENGTH)}`
      )
      .join('\n');

  const parkAt = async (statement: RecordedStatement, placement: BarrierPlacement) => {
    for (const placed of barriers) {
      if (placed.placement !== placement || !placed.matcher(statement)) continue;
      placed.seen += 1;
      if (placed.seen === placed.occurrence) {
        placed.barrier.markReached();
        await placed.barrier.gate;
      }
    }
  };

  const executeQuerySpy = vi.spyOn(manager, 'executeQuery').mockImplementation(async (sql: string, params?: unknown[], transactionID?: string) => {
    const statement: RecordedStatement = { sequence: statements.length + 1, transactionID, sql, params: params ?? [], settled: false };
    statements.push(statement);
    await parkAt(statement, 'before');
    let result: unknown;
    try {
      result = await originalExecuteQuery(sql, params, transactionID);
    } finally {
      statement.settled = true;
    }
    await parkAt(statement, 'after');
    for (const injection of injections) {
      if (injection.fired || !injection.matcher(statement)) continue;
      injection.seen += 1;
      if (injection.seen === injection.occurrence) {
        injection.fired = true;
        throw injection.makeError();
      }
    }
    return result;
  });
  const commitSpy = vi.spyOn(manager, 'commitTransaction').mockImplementation(async (transactionID: string) => {
    await originalCommitTransaction(transactionID);
    commitOrder.push(transactionID);
  });
  const rollbackSpy = vi.spyOn(manager, 'rollbackTransaction').mockImplementation(async (transactionID: string) => {
    try {
      await originalRollbackTransaction(transactionID);
    } finally {
      rollbackOrder.push(transactionID);
    }
  });

  return {
    statements,
    commitOrder,
    rollbackOrder,
    renderStatementLog,
    placeBarrier(matcher, occurrence, placement) {
      const barrier = createBarrier();
      barriers.push({ matcher, occurrence, placement, seen: 0, barrier });
      return barrier;
    },
    injectAfter(matcher, occurrence, makeError) {
      const injection: PlacedInjection = { matcher, occurrence, seen: 0, fired: false, makeError };
      injections.push(injection);
      return { fired: () => injection.fired };
    },
    transactionsRunning(matcher) {
      return [
        ...new Set(statements.filter(statement => statement.transactionID !== undefined && matcher(statement)).map(statement => statement.transactionID!))
      ];
    },
    track(promise) {
      trackedPromises.push(promise);
      promise.catch(() => undefined);
      return promise;
    },
    async settleAndRestore(scenarioFailed) {
      barriers.forEach(placed => placed.barrier.release());
      try {
        await withinDeadline(Promise.allSettled(trackedPromises), 'tracked runners to settle', renderStatementLog);
      } catch (settleError: unknown) {
        if (!(settleError instanceof BarrierDeadlineError) || !scenarioFailed) throw settleError;
        console.error(`[barrier cleanup] runners did not settle while the scenario was already failing; keeping the scenario's error: ${settleError.message}`);
      } finally {
        executeQuerySpy.mockRestore();
        commitSpy.mockRestore();
        rollbackSpy.mockRestore();
      }
    }
  };
}

export async function runBarrierScenario(harness: StatementHarness, scenario: () => Promise<void>): Promise<void> {
  let scenarioFailed = false;
  try {
    await scenario();
  } catch (scenarioError: unknown) {
    scenarioFailed = true;
    throw scenarioError;
  } finally {
    await harness.settleAndRestore(scenarioFailed);
  }
}

export interface LockWaitTarget {
  schema: string;
  table: string;
  /** Substring of performance_schema.data_locks.LOCK_DATA of the requested lock (for a census row: its id). */
  lockData?: string;
  /**
   * The waiting transaction's current statement (INNODB_TRX.trx_query) must match. Only for statements sent
   * directly: inside a stored procedure trx_query shows the procedure's innermost statement, never the CALL
   * (measured in tests/integration/runquery-timeout-quarantine.integration.test.ts:344-352) — use `threadID`.
   */
  waitingStatement?: RegExp;
  /** The waiting transaction's connection (CONNECTION_ID() of the session, INNODB_TRX.trx_mysql_thread_id). */
  threadID?: number;
}

/** Polls until a transaction is in LOCK WAIT on `target`; returns its INNODB_TRX row. Fails with the statement log at the deadline. */
export async function waitForLockWait(observer: Connection, target: LockWaitTarget, harness: StatementHarness, label: string): Promise<RowDataPacket> {
  const deadlineAt = Date.now() + BARRIER_DEADLINE_MS;
  while (Date.now() < deadlineAt) {
    const [waiting] = await observer.query<RowDataPacket[]>(
      `SELECT trx.trx_id, trx.trx_mysql_thread_id, trx.trx_query, requested.LOCK_DATA, requested.LOCK_MODE, requested.INDEX_NAME
       FROM information_schema.INNODB_TRX trx
       JOIN performance_schema.data_locks requested ON requested.ENGINE_LOCK_ID = trx.trx_requested_lock_id
       WHERE trx.trx_state = 'LOCK WAIT' AND requested.OBJECT_SCHEMA = ? AND requested.OBJECT_NAME = ?`,
      [target.schema, target.table]
    );
    const match = waiting.find(
      row =>
        (target.lockData === undefined || String(row.LOCK_DATA ?? '').includes(target.lockData)) &&
        (target.waitingStatement === undefined || target.waitingStatement.test(String(row.trx_query ?? ''))) &&
        (target.threadID === undefined || Number(row.trx_mysql_thread_id) === target.threadID)
    );
    if (match) {
      console.log(`[lock wait] ${label}: ${JSON.stringify(match)}`);
      return match;
    }
    await sleep(LOCK_WAIT_POLL_INTERVAL_MS);
  }
  const [open] = await observer.query<RowDataPacket[]>('SELECT trx_id, trx_state, trx_query FROM information_schema.INNODB_TRX');
  console.log(`[lock wait] ${label}: open InnoDB transactions at the deadline: ${JSON.stringify(open)}`);
  throw new BarrierDeadlineError(label, harness.renderStatementLog());
}
