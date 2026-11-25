import { vi } from 'vitest';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import type ConnectionManager from '@/lib/db/connectionmanager';

export const BARRIER_DEADLINE_MS = 15_000;
/** INNODB_TRX is served from a cache that refreshes only after 100 ms without a read, so a tighter poll never sees a new waiter. */
export const LOCK_WAIT_POLL_INTERVAL_MS = 150;
export const BARRIER_TEST_TIMEOUT_MS = 120_000;
const LOCK_WAIT_TRX_STATE = 'LOCK WAIT';
const STATEMENT_LOG_PREVIEW_LENGTH = 160;
const TRX_QUERY_HEAD_LENGTH = 120;

export type BarrierPlacement = 'before' | 'after';

export interface RecordedStatement {
  transactionID: string | undefined;
  sql: string;
  params: unknown[];
}

export interface BarrierSpec {
  pattern: RegExp;
  /** Evaluated against the statement about to run (already recorded, so `countMatches` includes it); the first match parks. Defaults to always true. */
  when?: (statement: RecordedStatement) => boolean;
  /** `before` parks the statement ahead of MySQL, so the transaction holds only what its earlier statements took; `after` parks it once it has run and holds its locks. */
  placement?: BarrierPlacement;
}

export interface FailureSpec {
  pattern: RegExp;
  when?: (statement: RecordedStatement) => boolean;
  /** Thrown INSTEAD of running the first matching statement. */
  error: Error;
}

export interface Barrier {
  /** Resolves once a statement is parked here. */
  reached: Promise<void>;
  release: () => void;
}

export interface LockWait {
  threadId: number;
  queryHead: string;
}

export class BarrierDeadlineError extends Error {
  constructor(label: string, statementLog: string) {
    super(`${label} not reached within ${BARRIER_DEADLINE_MS} ms. Statements:\n${statementLog}`);
    this.name = 'BarrierDeadlineError';
  }
}

interface ArmedBarrier extends BarrierSpec {
  placement: BarrierPlacement;
  consumed: boolean;
  markReached: () => void;
  gate: Promise<void>;
  release: () => void;
}

interface ArmedFailure extends FailureSpec {
  consumed: boolean;
}

export function sleep(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
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

/**
 * Test-side wrapper around the REAL ConnectionManager singleton (this file never mocks it). It records every
 * statement with its params and parks or fails chosen ones, so a test can hold one commit unit mid-transaction while
 * another caller runs against the same rows. Product code carries no hook; everything lives in this spy.
 * Install it AFTER seeding: seeding through the product functions must not appear in the log.
 */
export function installBarrierHarness(manager: ConnectionManager) {
  const recordedStatements: RecordedStatement[] = [];
  const barriers: ArmedBarrier[] = [];
  const failures: ArmedFailure[] = [];
  const trackedPromises: Promise<unknown>[] = [];
  let statementRewrite: ((statement: RecordedStatement) => { sql: string; params: unknown[] } | null) | null = null;

  const originalExecuteQuery = manager.executeQuery.bind(manager);

  const matches = (spec: { pattern: RegExp; when?: (statement: RecordedStatement) => boolean }, statement: RecordedStatement): boolean =>
    spec.pattern.test(statement.sql) && (spec.when?.(statement) ?? true);

  const parkAtMatchingBarrier = async (statement: RecordedStatement, placement: BarrierPlacement): Promise<void> => {
    const barrier = barriers.find(candidate => !candidate.consumed && candidate.placement === placement && matches(candidate, statement));
    if (!barrier) return;
    barrier.consumed = true;
    barrier.markReached();
    await barrier.gate;
  };

  const executeQuerySpy = vi.spyOn(manager, 'executeQuery').mockImplementation(async (sql: string, params?: unknown[], transactionID?: string) => {
    const original: RecordedStatement = { transactionID, sql, params: params ?? [] };
    const rewritten = statementRewrite?.(original);
    const statement: RecordedStatement = rewritten ? { transactionID, sql: rewritten.sql, params: rewritten.params } : original;
    recordedStatements.push(statement);

    const failure = failures.find(candidate => !candidate.consumed && matches(candidate, statement));
    if (failure) {
      failure.consumed = true;
      throw failure.error;
    }
    await parkAtMatchingBarrier(statement, 'before');
    const result = await originalExecuteQuery(statement.sql, statement.params, transactionID);
    await parkAtMatchingBarrier(statement, 'after');
    return result;
  });

  const renderStatementLog = () =>
    recordedStatements
      .map(({ transactionID, sql }, index) => `#${index} ${transactionID ?? 'no-tx'} ${sql.replace(/\s+/g, ' ').trim().slice(0, STATEMENT_LOG_PREVIEW_LENGTH)}`)
      .join('\n');

  return {
    recordedStatements,
    renderStatementLog,
    countMatches(pattern: RegExp): number {
      return recordedStatements.filter(({ sql }) => pattern.test(sql)).length;
    },
    placeBarrier(spec: BarrierSpec): Barrier {
      let markReached!: () => void;
      let release!: () => void;
      const reached = new Promise<void>(resolve => (markReached = resolve));
      const gate = new Promise<void>(resolve => (release = resolve));
      barriers.push({ ...spec, placement: spec.placement ?? 'before', consumed: false, markReached, gate, release });
      return { reached, release };
    },
    injectFailure(spec: FailureSpec): void {
      failures.push({ ...spec, consumed: false });
    },
    /** Replaces a statement before it runs (the effect of a duplicate-key drop); return null to leave it. The recorded statement is the rewritten one. */
    rewriteStatements(rewrite: (statement: RecordedStatement) => { sql: string; params: unknown[] } | null): void {
      statementRewrite = rewrite;
    },
    track<T>(promise: Promise<T>): Promise<T> {
      trackedPromises.push(promise);
      promise.catch(() => undefined);
      return promise;
    },
    async settleAndRestore(scenarioFailed: boolean): Promise<void> {
      barriers.forEach(barrier => barrier.release());
      try {
        await withinDeadline(Promise.allSettled(trackedPromises), 'tracked commits to settle', renderStatementLog);
      } catch (settleError: unknown) {
        if (!scenarioFailed) throw settleError;
        console.error(
          `[barrier cleanup] tracked commits did not settle while the scenario was already failing; keeping the scenario's error: ${String(settleError)}`
        );
      } finally {
        executeQuerySpy.mockRestore();
      }
    }
  };
}
export type BarrierHarness = ReturnType<typeof installBarrierHarness>;

/** Runs `scenario`; whatever happens, every barrier is released and every tracked promise settled before the spy is removed. */
export async function runBarrierScenario(harness: BarrierHarness, scenario: () => Promise<void>): Promise<void> {
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

/**
 * Polls until a transaction is in LOCK WAIT on a row of `schema.tableName` whose LOCK_DATA matches `lockDataLike`.
 * The wait is identified by the lock it requests, never by `trx_query`, which MySQL cuts off at 1024 characters.
 */
export async function waitForLockWait(
  connection: Connection,
  schema: string,
  tableName: string,
  lockDataLike: string,
  renderStatementLog: () => string
): Promise<LockWait> {
  const deadlineAt = Date.now() + BARRIER_DEADLINE_MS;
  while (Date.now() < deadlineAt) {
    const [waiting] = await connection.query<RowDataPacket[]>(
      `SELECT trx.trx_mysql_thread_id AS threadId, LEFT(trx.trx_query, ${TRX_QUERY_HEAD_LENGTH}) AS queryHead
       FROM information_schema.INNODB_TRX trx
       JOIN performance_schema.data_locks requested ON requested.ENGINE_LOCK_ID = trx.trx_requested_lock_id
       WHERE trx.trx_state = ?
         AND requested.OBJECT_SCHEMA = ?
         AND requested.OBJECT_NAME = ?
         AND requested.LOCK_DATA LIKE ?`,
      [LOCK_WAIT_TRX_STATE, schema, tableName, lockDataLike]
    );
    if (waiting.length > 0) return { threadId: Number(waiting[0].threadId), queryHead: String(waiting[0].queryHead) };
    await sleep(LOCK_WAIT_POLL_INTERVAL_MS);
  }
  const [openTransactions] = await connection.query<RowDataPacket[]>(
    `SELECT trx_mysql_thread_id AS threadId, trx_state AS state, LEFT(trx_query, ${TRX_QUERY_HEAD_LENGTH}) AS queryHead FROM information_schema.INNODB_TRX`
  );
  console.log(`[waitForLockWait] open InnoDB transactions at the deadline: ${JSON.stringify(openTransactions)}`);
  throw new BarrierDeadlineError(`a LOCK WAIT on ${schema}.${tableName} matching ${lockDataLike}`, renderStatementLog());
}
