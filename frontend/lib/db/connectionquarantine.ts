import type { PoolConnection } from 'mysql2/promise';
import ailogger from '@/ailogger';

type PoolConnectionWithThreadId = PoolConnection & { threadId?: number };

export type DeadlineSettlement<T> = { status: 'settled'; value: T } | { status: 'failed'; error: unknown } | { status: 'deadline_exceeded' };

export type LateSettlement = { status: 'settled' } | { status: 'failed'; error: unknown };

export type ManagedStatementCancel = (reason: string) => void;

const CONNECTION_QUARANTINED_MESSAGE = 'Statement cancelled because its database connection was quarantined';

/** Rejection a tracked statement receives when its connection is quarantined before the driver settles it. */
export class ConnectionQuarantinedError extends Error {
  readonly threadId: number | undefined;
  readonly reason: string;

  constructor(threadId: number | undefined, reason: string) {
    super(CONNECTION_QUARANTINED_MESSAGE);
    this.name = 'ConnectionQuarantinedError';
    this.threadId = threadId;
    this.reason = reason;
  }
}

const managedStatementCancels = new WeakMap<PoolConnection, Set<ManagedStatementCancel>>();
const quarantinedConnections = new WeakSet<PoolConnection>();

/**
 * Races `operation` against `deadlineMs`. The timer is cleared on every path. Handlers are attached
 * synchronously, so a settlement after the deadline is delivered to `onLateSettlement` exactly once and
 * never becomes an unhandled rejection.
 */
export function settleWithinDeadline<T>(
  operation: Promise<T>,
  deadlineMs: number,
  onLateSettlement: (late: LateSettlement) => void
): Promise<DeadlineSettlement<T>> {
  return new Promise(resolve => {
    let deadlinePassed = false;
    const deadlineHandle = setTimeout(() => {
      deadlinePassed = true;
      resolve({ status: 'deadline_exceeded' });
    }, deadlineMs);
    operation.then(
      value => {
        if (deadlinePassed) {
          onLateSettlement({ status: 'settled' });
          return;
        }
        clearTimeout(deadlineHandle);
        resolve({ status: 'settled', value });
      },
      (error: unknown) => {
        if (deadlinePassed) {
          onLateSettlement({ status: 'failed', error });
          return;
        }
        clearTimeout(deadlineHandle);
        resolve({ status: 'failed', error });
      }
    );
  });
}

/** Registers a cancel hook for a statement `runQuery` has in flight on `connection`; returns the unregister function. */
export function trackManagedStatement(connection: PoolConnection, cancel: ManagedStatementCancel): () => void {
  let cancels = managedStatementCancels.get(connection);
  if (!cancels) {
    cancels = new Set();
    managedStatementCancels.set(connection, cancels);
  }
  const trackedCancels = cancels;
  trackedCancels.add(cancel);
  return () => {
    trackedCancels.delete(cancel);
  };
}

export function isConnectionQuarantined(connection: PoolConnection): boolean {
  return quarantinedConnections.has(connection);
}

/**
 * The only way the database layer drops a connection: destroy it (never release it) and synchronously cancel
 * every statement tracked on it, so no wrapper waits on a driver promise that a destroyed connection may never
 * settle. Idempotent; never throws.
 */
export function quarantineConnection(connection: PoolConnection, reason: string): void {
  if (!quarantinedConnections.has(connection)) {
    quarantinedConnections.add(connection);
    try {
      connection.destroy();
    } catch (destroyError: unknown) {
      const errorObj = destroyError instanceof Error ? destroyError : new Error(String(destroyError));
      const threadId = (connection as PoolConnectionWithThreadId).threadId ?? 'unknown';
      ailogger.error(`Error destroying quarantined connection (thread ${threadId}; ${reason}): ${errorObj.message}`, errorObj);
    }
  }
  const cancels = managedStatementCancels.get(connection);
  if (!cancels) return;
  managedStatementCancels.delete(connection);
  for (const cancel of cancels) cancel(reason);
}
