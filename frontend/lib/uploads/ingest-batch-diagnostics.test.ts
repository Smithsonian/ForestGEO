import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ manager: null as any, timeout: null as any }));

vi.mock('@/lib/db/connectionmanager', () => ({ default: { getInstance: () => state.manager } }));
vi.mock('@/lib/db/sqlsecurity', () => ({ safeFormatQuery: (_schema: string, sql: string) => sql.replace(/\?\?/g, 'test_schema') }));
vi.mock('@/lib/failedinitialcensusrecovery', () => ({ shouldRecoverFailedInitialCensus: () => false }));
vi.mock('@/lib/batchfailuretransfer', () => ({ moveTemporaryBatchToFailedMeasurements: vi.fn() }));
vi.mock('@/ailogger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/db/primitives', () => ({
  QueryTimeoutError: class QueryTimeoutError extends Error {},
  isKilledConnectionError: () => false,
  isKilledStatementError: () => false
}));

import { TransactionCallbackTimeoutError } from '@/lib/db/transactionerrors';
import { ingestBatch, SetupCallbackTimeoutError, SetupLockUnavailableError } from './ingest-batch';
import { SETUP_FAILURE_CODES } from './setup-failure';

describe('ingestBatch setup diagnostics', () => {
  afterEach(() => {
    state.manager = null;
    state.timeout = null;
  });

  it('freezes terminal timeout diagnostics with the active step, counters, and typed cause', async () => {
    const timeout = new TransactionCallbackTimeoutError('tx', 120_000);
    state.timeout = timeout;
    const family = [{ BatchID: 'batch', PlotID: 5, CensusID: 7, rowCount: 4, plotCount: 1, censusCount: 1 }];
    const executeQuery = vi.fn(async (sql: string) => {
      if (sql.includes('COUNT(DISTINCT PlotID)') && sql.includes('GROUP BY BatchID')) return family;
      if (sql.includes('completedUploads')) return [{ completedUploads: 0, incompleteUploads: 0, treeCount: 0, stemCount: 0, coreMeasurementCount: 0 }];
      if (sql.includes('SELECT 1')) return [];
      return { affectedRows: 0 };
    });
    state.manager = {
      executeQuery,
      acquireApplicationLock: vi.fn(async () => true),
      withTransaction: vi.fn(async (callback: (tx: any) => Promise<unknown>) => {
        await callback({ id: 'tx', query: executeQuery });
        throw state.timeout;
      })
    };
    const events: Readonly<Record<string, any>>[] = [];

    let caught: unknown;
    try {
      await ingestBatch(state.manager, {
        schema: 'test_schema',
        fileID: 'file.csv',
        batchID: 'batch',
        expectedScope: { plotID: 5, censusID: 7 },
        onSetupProgress: event => {
          events.push(event);
          return Promise.reject(new Error('telemetry sink failure'));
        }
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(SetupCallbackTimeoutError);
    expect((caught as SetupCallbackTimeoutError).cause).toBe(timeout);
    const terminal = events.at(-1)!;
    expect(terminal).toMatchObject({ terminal: true, step: 'commit', outcome: 'failed', errorCode: 'SETUP_CALLBACK_TIMEOUT', rowCount: 4 });
    expect(Object.isFrozen(terminal)).toBe(true);
  });

  it('fails with a typed lock error at the lock_wait step and never discovers the family', async () => {
    const executeQuery = vi.fn(async () => []);
    state.manager = {
      executeQuery,
      acquireApplicationLock: vi.fn(async () => false),
      withTransaction: vi.fn(async (callback: (tx: any) => Promise<unknown>) => callback({ id: 'tx', query: executeQuery }))
    };
    const events: Readonly<Record<string, any>>[] = [];

    const caught = await ingestBatch(state.manager, {
      schema: 'test_schema',
      fileID: 'file.csv',
      batchID: 'batch',
      expectedScope: { plotID: 5, censusID: 7 },
      onSetupProgress: event => {
        events.push(event);
      }
    }).catch((error: unknown) => error);
    console.log('[lock-unavailable] caught:', caught, 'terminal:', events.at(-1));

    expect(caught).toBeInstanceOf(SetupLockUnavailableError);
    expect((caught as Error).message).toBe('Failed to acquire application lock for file file.csv. Another upload may be in progress.');
    expect(events.at(-1)).toMatchObject({ terminal: true, step: 'lock_wait', outcome: 'failed', errorCode: SETUP_FAILURE_CODES.lockUnavailable });
    expect(executeQuery).not.toHaveBeenCalled();
  });
});
