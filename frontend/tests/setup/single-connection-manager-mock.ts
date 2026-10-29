import type { Connection } from 'mysql2/promise';

export interface RecordedStatement {
  transactionID: string | null;
  sql: string;
  params: unknown[];
}

export interface ParkedTransactionStart {
  /** Checked at the start of every withTransaction, before BEGIN; the first matching entry parks that call. */
  when: () => boolean;
  /** Resolves once a transaction start is parked here. */
  reached: Promise<void>;
  /** Lets the parked transaction start proceed. */
  release: () => void;
  gate: Promise<void>;
  markReached: () => void;
  consumed: boolean;
}

export interface SingleConnectionState {
  connection: Connection | null;
  activeTransactionID: string | null;
  transactionCounter: number;
  statements: RecordedStatement[];
  transactionOutcomes: Map<string, 'committed' | 'rolled_back'>;
  /** Returns an error to throw INSTEAD of running the statement (failure injection), or null. */
  failOn: ((sql: string, params: unknown[], transactionID: string | null) => Error | null) | null;
  /** Rewrites a statement before it runs (forced INSERT IGNORE drops), or returns null to leave it. */
  rewrite: ((sql: string, params: unknown[]) => { sql: string; params: unknown[] } | null) | null;
  parkedStarts: ParkedTransactionStart[];
  heldLocks: Set<string>;
}

export const SINGLE_CONNECTION_TRANSACTION_PREFIX = 'single-tx-';

export function createSingleConnectionState(): SingleConnectionState {
  return {
    connection: null,
    activeTransactionID: null,
    transactionCounter: 0,
    statements: [],
    transactionOutcomes: new Map(),
    failOn: null,
    rewrite: null,
    parkedStarts: [],
    heldLocks: new Set()
  };
}

export function parkNextTransactionStart(state: SingleConnectionState, when: () => boolean): ParkedTransactionStart {
  let release!: () => void;
  let markReached!: () => void;
  const gate = new Promise<void>(resolve => (release = resolve));
  const reached = new Promise<void>(resolve => (markReached = resolve));
  const parked: ParkedTransactionStart = { when, reached, release, gate, markReached, consumed: false };
  state.parkedStarts.push(parked);
  return parked;
}

/** Clears the recorded statements and injections, and ends whatever an aborted test left open: its transaction is rolled back and its application locks are released. */
export async function resetSingleConnectionState(state: SingleConnectionState): Promise<void> {
  if (state.connection) {
    if (state.activeTransactionID) await state.connection.rollback();
    for (const lockName of state.heldLocks) await state.connection.query('SELECT RELEASE_LOCK(?)', [lockName]);
  }
  state.heldLocks.clear();
  state.activeTransactionID = null;
  state.statements.length = 0;
  state.transactionOutcomes.clear();
  state.failOn = null;
  state.rewrite = null;
  state.parkedStarts.length = 0;
}

/** The module shape `vi.mock('@/lib/db/connectionmanager', …)` must return. */
export function buildSingleConnectionManagerModule(state: SingleConnectionState) {
  const requireConnection = (): Connection => {
    if (!state.connection) throw new Error('Test DB connection not initialized');
    return state.connection;
  };
  const releaseLocks = async () => {
    for (const name of state.heldLocks) await requireConnection().query('SELECT RELEASE_LOCK(?)', [name]);
    state.heldLocks.clear();
  };
  const manager = {
    executeQuery: async (sql: string, params: unknown[] = [], transactionID?: string) => {
      if (transactionID && transactionID !== state.activeTransactionID) {
        throw new Error(`single-connection mock: transactionID mismatch (got "${transactionID}", active "${state.activeTransactionID}")`);
      }
      const rewritten = state.rewrite?.(sql, params) ?? { sql, params };
      state.statements.push({ transactionID: transactionID ?? null, sql: rewritten.sql, params: rewritten.params });
      const injected = state.failOn?.(rewritten.sql, rewritten.params, transactionID ?? null);
      if (injected) throw injected;
      const [rows] = await requireConnection().query(rewritten.sql, rewritten.params);
      return rows;
    },
    beginTransaction: async () => {
      if (state.activeTransactionID) throw new Error('single-connection mock: transaction already active');
      await requireConnection().beginTransaction();
      state.transactionCounter += 1;
      state.activeTransactionID = `${SINGLE_CONNECTION_TRANSACTION_PREFIX}${state.transactionCounter}`;
      return state.activeTransactionID;
    },
    commitTransaction: async (transactionID: string) => {
      if (transactionID !== state.activeTransactionID) throw new Error('single-connection mock: commit transactionID mismatch');
      await requireConnection().commit();
      await releaseLocks();
      state.transactionOutcomes.set(transactionID, 'committed');
      state.activeTransactionID = null;
    },
    rollbackTransaction: async (transactionID: string) => {
      if (transactionID !== state.activeTransactionID) throw new Error('single-connection mock: rollback transactionID mismatch');
      await requireConnection().rollback();
      await releaseLocks();
      state.transactionOutcomes.set(transactionID, 'rolled_back');
      state.activeTransactionID = null;
    },
    withTransaction: async <T>(fn: (tx: { id: string; query: (sql: string, params?: unknown[]) => Promise<unknown> }) => Promise<T>) => {
      const parked = state.parkedStarts.find(candidate => !candidate.consumed && candidate.when());
      if (parked) {
        parked.consumed = true;
        parked.markReached();
        await parked.gate;
      }
      const id = await manager.beginTransaction();
      try {
        const result = await fn({ id, query: (sql, params) => manager.executeQuery(sql, params, id) });
        await manager.commitTransaction(id);
        return result;
      } catch (error) {
        await manager.rollbackTransaction(id);
        throw error;
      }
    },
    acquireApplicationLock: async (lockName: string, transactionID: string, timeoutMs: number) => {
      if (transactionID !== state.activeTransactionID) throw new Error('single-connection mock: unknown lock transaction');
      if (state.heldLocks.has(lockName)) return true;
      const [rows] = await requireConnection().query('SELECT GET_LOCK(?, ?) AS acquired', [lockName, Math.ceil(timeoutMs / 1000)]);
      const acquired = (rows as Array<{ acquired: number }>)[0]?.acquired === 1;
      if (acquired) state.heldLocks.add(lockName);
      return acquired;
    },
    releaseApplicationLock: async (lockName: string) => {
      await requireConnection().query('SELECT RELEASE_LOCK(?)', [lockName]);
      state.heldLocks.delete(lockName);
    },
    cleanupStaleTransactions: async () => undefined,
    closeConnection: async () => undefined
  };
  return { default: { getInstance: () => manager } };
}
