import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { TransactionCommitOutcomeUnknownError } from '@/lib/db/transactionerrors';
// --------- Import the handler AFTER mocks ---------
import { POST } from './route';
import ConnectionManager from '@/lib/db/connectionmanager'; // --------- Helpers ---------

// --------- Mocks (must be BEFORE importing the route) ---------

// Route is now wrapped by withRouteAuthz, so auth() runs before the handler.
// A 'global' admin passes the per-site access gate.
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { userStatus: 'global', sites: [] } }))
}));

// Singleton-safe ConnectionManager wrapper that respects your setup mocks.
// Guarantees getInstance() returns an object with the needed methods.
vi.mock('@/lib/db/connectionmanager', async () => {
  const actual = await vi.importActual<any>('@/lib/db/connectionmanager').catch(() => ({}));

  const candidate =
    (typeof actual?.getInstance === 'function' && actual.getInstance()) ||
    (actual?.default && typeof actual.default.getInstance === 'function' && actual.default.getInstance()) ||
    actual?.default ||
    actual;

  const instance = (candidate &&
    typeof candidate.beginTransaction === 'function' &&
    typeof candidate.executeQuery === 'function' &&
    typeof candidate.commitTransaction === 'function' &&
    typeof candidate.rollbackTransaction === 'function' &&
    typeof candidate.closeConnection === 'function' &&
    candidate) || {
    beginTransaction: vi.fn(async () => 'tx-test'),
    executeQuery: vi.fn(async () => []),
    commitTransaction: vi.fn(async () => {}),
    rollbackTransaction: vi.fn(async () => {}),
    closeConnection: vi.fn(async () => {})
  };

  const getInstance = vi.fn(() => instance);

  return {
    ...actual,
    default: { ...(actual?.default ?? {}), getInstance },
    getInstance
  };
});

// Quiet logger
vi.mock('@/ailogger', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
}));

// Mock schema validation to accept test schemas
vi.mock('@/lib/db/sqlsecurity', () => ({
  isValidSchema: vi.fn((schema: string) => {
    return ['myschema', 'testschema'].includes(schema);
  }),
  safeFormatQuery: vi.fn((schema: string, query: string) => {
    // Replace all ?? with schema name
    return query.replace(/\?\?/g, `\`${schema}\``);
  })
}));

// --------- Helpers ---------
function makeProps(view?: string, schema?: string) {
  return { params: Promise.resolve({ view: view as any, schema: schema as any }) } as any;
}

const REFRESH_TRANSACTION_ID = 'tx-refresh-unknown';
const INJECTED_COMMIT_DEADLINE_MS = 30_000;

describe('POST /api/refreshviews after an unknown COMMIT outcome (#563 §5.2, C5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fails once with the error and never retries or reports success', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const unknown = new TransactionCommitOutcomeUnknownError(REFRESH_TRANSACTION_ID, 'deadline_exceeded', INJECTED_COMMIT_DEADLINE_MS);
    const begin = vi.spyOn(cm, 'beginTransaction').mockResolvedValue(REFRESH_TRANSACTION_ID);
    vi.spyOn(cm, 'executeQuery').mockResolvedValue(undefined);
    vi.spyOn(cm, 'commitTransaction').mockRejectedValueOnce(unknown);
    const rollback = vi.spyOn(cm, 'rollbackTransaction').mockResolvedValue(undefined);
    const close = vi.spyOn(cm, 'closeConnection').mockResolvedValue(undefined);

    const outcome = await POST(new NextRequest('http://localhost', { method: 'POST' }), makeProps('viewfulltable', 'myschema')).then(
      response => ({ status: response.status }),
      (error: unknown) => error
    );
    console.log('[C5] outcome:', outcome, 'begin calls:', begin.mock.calls.length);

    expect(outcome).toBeInstanceOf(Error);
    expect((outcome as Error).message).toMatch(/^Call failed: /);
    expect(begin, 'the refresh must not be retried after an unknown COMMIT outcome').toHaveBeenCalledTimes(1);
    expect(rollback).toHaveBeenCalledWith(REFRESH_TRANSACTION_ID);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
