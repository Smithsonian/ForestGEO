import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ manager: null as any, timeout: null as any }));

vi.mock('@/lib/db/connectionmanager', async () => {
  const actual = await vi.importActual<typeof import('@/lib/db/connectionmanager')>('@/lib/db/connectionmanager');
  return { ...actual, default: { getInstance: () => state.manager } };
});
vi.mock('@/lib/db/sqlsecurity', () => ({ safeFormatQuery: (_schema: string, sql: string) => sql.replace(/\?\?/g, 'test_schema') }));
vi.mock('@/lib/failedinitialcensusrecovery', () => ({ shouldRecoverFailedInitialCensus: () => false }));
vi.mock('@/lib/batchfailuretransfer', () => ({ moveTemporaryBatchToFailedMeasurements: vi.fn() }));
vi.mock('@/ailogger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/db/primitives', () => ({
  QueryTimeoutError: class QueryTimeoutError extends Error {},
  isKilledConnectionError: () => false,
  isKilledStatementError: () => false
}));

import { TransactionCallbackTimeoutError } from '@/lib/db/connectionmanager';
import { ingestBatch, SetupCallbackTimeoutError } from './ingest-batch';

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
      if (sql.includes('CAST(MAX(id) AS CHAR)')) return [{ rowCount: 4, upperID: '4', plotID: 5, censusID: 7, plotCount: 1, censusCount: 1 }];
      if (sql.includes('FROM test_schema.temporarymeasurements') && sql.includes('FOR UPDATE'))
        return [{ rowCount: 4, plotID: 5, censusID: 7, plotCount: 1, censusCount: 1 }];
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
});
