import { beforeEach, describe, expect, it, vi } from 'vitest';

const { loggerMock } = vi.hoisted(() => ({
  loggerMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

vi.mock('@/ailogger', () => ({ default: loggerMock }));

import {
  callBulkIngestionInCallerTransaction,
  CALLER_OWNS_TRANSACTION_SQL,
  CLEAR_CALLER_TRANSACTION_SQL,
  FLAG_CLEAR_FAILED_REASON,
  MISSING_TRANSACTION_ID_MESSAGE,
  transactionExecutorFor,
  type BulkIngestionExecutor
} from './bulk-ingestion-call';

const SCHEMA = 'forestgeo_testing';
const INVALID_SCHEMA = 'forestgeo_testing`; DROP TABLE trees; --';
const EXPECTED_CALL_SQL = 'CALL `forestgeo_testing`.bulkingestionprocess(?, ?)';
const FILE_ID = 'census.csv';
const BATCH_ID = 'batch-0001';
const TRANSACTION_ID = 'tx-7f3a';
const CALLER_FLAG_SET = 1;

const SUCCESS_RESULT = [[{ message: 'Batch batch-0001 processed successfully: 3 records', batch_failed: 0 }], []];
const HANDLED_FAILURE_RESULT = [[{ message: 'Batch batch-0001 failed: 1644', batch_failed: 1 }], []];

type StatementBehavior = (session: SimulatedSession) => Promise<unknown>;

/**
 * Models one MySQL session: the SET/CLEAR statements really change `flag`, and any
 * statement can be overridden to reject (optionally AFTER it took effect, as with a
 * lost response).
 */
class SimulatedSession {
  flag: number | null = null;
  readonly statements: string[] = [];
  readonly discardReasons: string[] = [];
  private readonly overrides = new Map<string, StatementBehavior>();

  constructor(private readonly callResult: unknown = SUCCESS_RESULT) {}

  override(sql: string, behavior: StatementBehavior): this {
    this.overrides.set(sql, behavior);
    return this;
  }

  readonly executor: BulkIngestionExecutor & { query: ReturnType<typeof vi.fn> } = {
    query: vi.fn(async (sql: string) => {
      this.statements.push(sql);
      const override = this.overrides.get(sql);
      if (override) return override(this);
      if (sql === CALLER_OWNS_TRANSACTION_SQL) this.flag = CALLER_FLAG_SET;
      else if (sql === CLEAR_CALLER_TRANSACTION_SQL) this.flag = null;
      else if (sql === EXPECTED_CALL_SQL) return this.callResult;
      else throw new Error(`unexpected statement on the simulated session: ${sql}`);
      return [];
    }),
    discard: (reason: string) => {
      this.discardReasons.push(reason);
    }
  };
}

function mysqlError(code: string, errno: number, message: string): Error & { code: string; errno: number } {
  return Object.assign(new Error(message), { code, errno });
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    value => {
      throw new Error(`expected a rejection, got ${JSON.stringify(value)}`);
    },
    (error: unknown) => error
  );
}

describe('callBulkIngestionInCallerTransaction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects an invalid schema before touching the session', async () => {
    const session = new SimulatedSession();

    await expect(callBulkIngestionInCallerTransaction(session.executor, INVALID_SCHEMA, FILE_ID, BATCH_ID)).rejects.toThrow(/Invalid or unauthorized schema/);

    expect(session.statements, 'no session mutation may precede schema validation').toEqual([]);
    expect(session.discardReasons).toEqual([]);
  });

  for (const [label, callResult] of [
    ['a successful batch', SUCCESS_RESULT],
    ['a handled batch_failed result', HANDLED_FAILURE_RESULT]
  ] as const) {
    it(`runs SET, the parameterized CALL and CLEAR in order and returns the raw result for ${label}`, async () => {
      const session = new SimulatedSession(callResult);

      const result = await callBulkIngestionInCallerTransaction(session.executor, SCHEMA, FILE_ID, BATCH_ID);

      expect(result, 'the raw CALL result must be returned unchanged').toBe(callResult);
      expect(session.statements).toEqual([CALLER_OWNS_TRANSACTION_SQL, EXPECTED_CALL_SQL, CLEAR_CALLER_TRANSACTION_SQL]);
      expect(session.executor.query).toHaveBeenNthCalledWith(2, EXPECTED_CALL_SQL, [FILE_ID, BATCH_ID]);
      expect(session.flag, 'the flag must be cleared after the CALL').toBeNull();
      expect(session.discardReasons).toEqual([]);
    });
  }

  it('still clears the flag when SET rejects after the server applied it, and never runs the CALL', async () => {
    const lostResponse = mysqlError('PROTOCOL_CONNECTION_LOST', 0, 'response lost after SET');
    const session = new SimulatedSession().override(CALLER_OWNS_TRANSACTION_SQL, async s => {
      s.flag = CALLER_FLAG_SET;
      throw lostResponse;
    });

    const thrown = await rejectionOf(callBulkIngestionInCallerTransaction(session.executor, SCHEMA, FILE_ID, BATCH_ID));

    expect(thrown, 'the original SET error must reach the caller').toBe(lostResponse);
    expect(session.statements).toEqual([CALLER_OWNS_TRANSACTION_SQL, CLEAR_CALLER_TRANSACTION_SQL]);
    expect(session.flag).toBeNull();
    expect(session.discardReasons).toEqual([]);
  });

  it('clears the flag when the CALL is rejected before the procedure could clear it (ER_SP_DOES_NOT_EXIST)', async () => {
    const missingProcedure = mysqlError('ER_SP_DOES_NOT_EXIST', 1305, 'PROCEDURE forestgeo_testing.bulkingestionprocess does not exist');
    let flagWhenCallRejected: number | null = null;
    const session = new SimulatedSession().override(EXPECTED_CALL_SQL, async s => {
      flagWhenCallRejected = s.flag;
      throw missingProcedure;
    });

    const thrown = await rejectionOf(callBulkIngestionInCallerTransaction(session.executor, SCHEMA, FILE_ID, BATCH_ID));

    expect(thrown).toBe(missingProcedure);
    expect(flagWhenCallRejected, 'the flag was live on the session when the CALL failed').toBe(CALLER_FLAG_SET);
    expect(session.flag, 'CLEAR must reset what the procedure never consumed').toBeNull();
    expect(session.statements.at(-1)).toBe(CLEAR_CALLER_TRANSACTION_SQL);
    expect(session.discardReasons).toEqual([]);
  });

  it('discards the connection once and keeps the original CALL error when CLEAR also fails', async () => {
    const callError = mysqlError('ER_SP_DOES_NOT_EXIST', 1305, 'procedure missing');
    const clearError = mysqlError('PROTOCOL_CONNECTION_LOST', 0, 'connection lost during CLEAR');
    const session = new SimulatedSession()
      .override(EXPECTED_CALL_SQL, async () => {
        throw callError;
      })
      .override(CLEAR_CALLER_TRANSACTION_SQL, async () => {
        throw clearError;
      });

    const thrown = await rejectionOf(callBulkIngestionInCallerTransaction(session.executor, SCHEMA, FILE_ID, BATCH_ID));

    expect(thrown, 'the CALL error explains the failure; the cleanup error must not replace it').toBe(callError);
    expect(session.discardReasons).toEqual([FLAG_CLEAR_FAILED_REASON]);
    expect(loggerMock.error).toHaveBeenCalledWith(expect.stringContaining(FLAG_CLEAR_FAILED_REASON), clearError);
  });

  it('discards the connection once and keeps the original SET error when CLEAR also fails', async () => {
    const setError = mysqlError('PROTOCOL_CONNECTION_LOST', 0, 'connection lost during SET');
    const clearError = mysqlError('PROTOCOL_CONNECTION_LOST', 0, 'connection lost during CLEAR');
    const session = new SimulatedSession()
      .override(CALLER_OWNS_TRANSACTION_SQL, async () => {
        throw setError;
      })
      .override(CLEAR_CALLER_TRANSACTION_SQL, async () => {
        throw clearError;
      });

    const thrown = await rejectionOf(callBulkIngestionInCallerTransaction(session.executor, SCHEMA, FILE_ID, BATCH_ID));

    expect(thrown).toBe(setError);
    expect(session.statements).not.toContain(EXPECTED_CALL_SQL);
    expect(session.discardReasons).toEqual([FLAG_CLEAR_FAILED_REASON]);
  });

  it('rejects with the cleanup error instead of reporting success when the CALL resolved but CLEAR failed', async () => {
    const clearError = mysqlError('PROTOCOL_CONNECTION_LOST', 0, 'connection lost during CLEAR');
    const session = new SimulatedSession().override(CLEAR_CALLER_TRANSACTION_SQL, async () => {
      throw clearError;
    });

    const thrown = await rejectionOf(callBulkIngestionInCallerTransaction(session.executor, SCHEMA, FILE_ID, BATCH_ID));

    expect(thrown, 'a discarded transaction must never be reported as a successful ingestion').toBe(clearError);
    expect(session.discardReasons).toEqual([FLAG_CLEAR_FAILED_REASON]);
  });

  it('stays pending until CLEAR settles so the caller cannot commit before cleanup', async () => {
    let releaseClear: () => void = () => undefined;
    const clearGate = new Promise<void>(resolve => {
      releaseClear = resolve;
    });
    const session = new SimulatedSession().override(CLEAR_CALLER_TRANSACTION_SQL, async s => {
      await clearGate;
      s.flag = null;
      return [];
    });

    let settled = false;
    const call = callBulkIngestionInCallerTransaction(session.executor, SCHEMA, FILE_ID, BATCH_ID).then(result => {
      settled = true;
      return result;
    });
    await vi.waitFor(() => expect(session.statements).toContain(CLEAR_CALLER_TRANSACTION_SQL));
    await Promise.resolve();

    expect(settled, 'the helper resolved while CLEAR was still in flight').toBe(false);
    expect(session.flag).toBe(CALLER_FLAG_SET);

    releaseClear();
    await expect(call).resolves.toBe(SUCCESS_RESULT);
    expect(session.flag).toBeNull();
  });
});

describe('transactionExecutorFor', () => {
  function makeConnectionManager() {
    return {
      executeQuery: vi.fn().mockResolvedValue([]),
      discardTransaction: vi.fn()
    };
  }

  for (const blankTransactionID of ['', '   ']) {
    it(`refuses a blank transaction ID (${JSON.stringify(blankTransactionID)}) so no query can fall back to a pooled connection`, () => {
      const connectionManager = makeConnectionManager();

      expect(() => transactionExecutorFor(connectionManager, blankTransactionID)).toThrow(MISSING_TRANSACTION_ID_MESSAGE);
      expect(connectionManager.executeQuery).not.toHaveBeenCalled();
    });
  }

  it('binds every helper statement and the discard to the same transaction ID', async () => {
    const connectionManager = makeConnectionManager();
    connectionManager.executeQuery.mockImplementation(async (sql: string) => (sql === EXPECTED_CALL_SQL ? SUCCESS_RESULT : []));

    const executor = transactionExecutorFor(connectionManager, TRANSACTION_ID);
    await callBulkIngestionInCallerTransaction(executor, SCHEMA, FILE_ID, BATCH_ID);
    executor.discard(FLAG_CLEAR_FAILED_REASON);

    expect(connectionManager.executeQuery.mock.calls).toEqual([
      [CALLER_OWNS_TRANSACTION_SQL, undefined, TRANSACTION_ID],
      [EXPECTED_CALL_SQL, [FILE_ID, BATCH_ID], TRANSACTION_ID],
      [CLEAR_CALLER_TRANSACTION_SQL, undefined, TRANSACTION_ID]
    ]);
    expect(connectionManager.discardTransaction).toHaveBeenCalledWith(TRANSACTION_ID, FLAG_CLEAR_FAILED_REASON);
  });
});
