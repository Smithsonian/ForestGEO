import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { HTTPResponses } from '@/config/macros';
import { TRANSACTION_COMMIT_OUTCOME_UNKNOWN_CODE, TransactionCommitOutcomeUnknownError } from '@/lib/db/transactionerrors';

const TRANSACTION_ID = 'tx-clear-unknown';
const INJECTED_COMMIT_DEADLINE_MS = 30_000;

vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { email: 'admin@forestgeo.test', userStatus: 'global', sites: [] } })) }));
vi.mock('@/ailogger', () => ({ default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/db/connectionmanager', () => {
  const manager = {
    executeQuery: vi.fn(async (sql: string) => {
      if (/FOR UPDATE/.test(sql) && /coremeasurements cm/.test(sql)) return [{ CoreMeasurementID: 42, StemGUID: 7 }];
      if (/census c/.test(sql)) return [{ PlotCensusNumber: 1 }];
      if (/upload_sessions|validation_runs/.test(sql)) return [];
      return { affectedRows: 1 };
    }),
    beginTransaction: vi.fn(async () => TRANSACTION_ID),
    acquireApplicationLock: vi.fn(async () => true),
    commitTransaction: vi.fn(async () => undefined),
    rollbackTransaction: vi.fn(async () => undefined),
    closeConnection: vi.fn(async () => undefined)
  };
  return { default: { getInstance: () => manager } };
});

import ConnectionManager from '@/lib/db/connectionmanager';
import { POST } from './route';

describe('POST /api/validations/clearmeasurementerrors after an unknown COMMIT outcome (P3-3)', () => {
  it('answers with the unknown-outcome code, never retries and never rolls back', async () => {
    const cm = ConnectionManager.getInstance() as unknown as Record<'beginTransaction' | 'commitTransaction' | 'rollbackTransaction', ReturnType<typeof vi.fn>>;
    cm.commitTransaction.mockRejectedValueOnce(new TransactionCommitOutcomeUnknownError(TRANSACTION_ID, 'deadline_exceeded', INJECTED_COMMIT_DEADLINE_MS));
    const response = await POST(
      new NextRequest('http://localhost/api/validations/clearmeasurementerrors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schema: 'forestgeo_testing', plotID: 1, censusID: 5, measurementID: 42 })
      }),
      { params: Promise.resolve({}) }
    );
    const body = await response.json();
    console.log('[view-errors clear unknown commit]', response.status, JSON.stringify(body));
    expect(response.status).toBe(HTTPResponses.INTERNAL_SERVER_ERROR);
    expect(body.code).toBe(TRANSACTION_COMMIT_OUTCOME_UNKNOWN_CODE);
    expect(cm.beginTransaction).toHaveBeenCalledTimes(1);
    expect(cm.commitTransaction).toHaveBeenCalledTimes(1);
    expect(cm.rollbackTransaction).not.toHaveBeenCalled();
  });
});
