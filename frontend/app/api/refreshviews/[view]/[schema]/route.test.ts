import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HTTPResponses } from '@/config/macros';
import { NextRequest } from 'next/server';
// --------- Import the handler AFTER mocks ---------
import { POST } from './route';
import ConnectionManager from '@/config/connectionmanager'; // --------- Helpers ---------

// --------- Mocks (must be BEFORE importing the route) ---------

// Singleton-safe ConnectionManager wrapper that respects your setup mocks.
// Guarantees getInstance() returns an object with the needed methods.
vi.mock('@/config/connectionmanager', async () => {
  const actual = await vi.importActual<any>('@/config/connectionmanager').catch(() => ({}));

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

// --------- Helpers ---------
function makeProps(view?: string, schema?: string) {
  return { params: Promise.resolve({ view: view as any, schema: schema as any }) } as any;
}

describe('POST /api/refreshviews/[view]/[schema]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws if schema or view is missing/undefined', async () => {
    await expect(POST(new NextRequest('http://localhost'), makeProps(undefined as any, 'myschema'))).rejects.toThrow(/schema not provided/i);
    await expect(POST(new NextRequest('http://localhost'), makeProps('viewfulltable', undefined as any))).rejects.toThrow(/schema not provided/i);
    await expect(POST(new NextRequest('http://localhost'), makeProps('undefined' as any, 'myschema'))).rejects.toThrow(/schema not provided/i);
    await expect(POST(new NextRequest('http://localhost'), makeProps('viewfulltable', 'undefined' as any))).rejects.toThrow(/schema not provided/i);
  });

  it('viewfulltable: calls RefreshViewFullTable(), commits, and closes', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const begin = vi.spyOn(cm, 'beginTransaction').mockResolvedValueOnce('tx-1');
    const exec = vi.spyOn(cm, 'executeQuery').mockResolvedValueOnce(undefined);
    const commit = vi.spyOn(cm, 'commitTransaction').mockResolvedValueOnce(undefined);
    const rollback = vi.spyOn(cm, 'rollbackTransaction').mockResolvedValueOnce(undefined);
    const close = vi.spyOn(cm, 'closeConnection').mockResolvedValueOnce(undefined);

    const res = await POST(new NextRequest('http://localhost', { method: 'POST' }), makeProps('viewfulltable', 'myschema'));

    expect(res.status).toBe(HTTPResponses.OK);
    expect(begin).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledWith('CALL myschema.RefreshViewFullTable();');
    expect(commit).toHaveBeenCalledWith('tx-1');
    expect(rollback).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('measurementssummary: calls RefreshMeasurementsSummary(), commits, and closes', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const begin = vi.spyOn(cm, 'beginTransaction').mockResolvedValueOnce('tx-2');
    const exec = vi.spyOn(cm, 'executeQuery').mockResolvedValueOnce(undefined);
    const commit = vi.spyOn(cm, 'commitTransaction').mockResolvedValueOnce(undefined);
    const rollback = vi.spyOn(cm, 'rollbackTransaction').mockResolvedValueOnce(undefined);
    const close = vi.spyOn(cm, 'closeConnection').mockResolvedValueOnce(undefined);

    const res = await POST(new NextRequest('http://localhost', { method: 'POST' }), makeProps('measurementssummary', 'myschema'));

    expect(res.status).toBe(HTTPResponses.OK);
    expect(begin).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledWith('CALL myschema.RefreshMeasurementsSummary();');
    expect(commit).toHaveBeenCalledWith('tx-2');
    expect(rollback).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('unknown view: calls Refresh() (empty suffix), commits, and closes', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const begin = vi.spyOn(cm, 'beginTransaction').mockResolvedValueOnce('tx-3');
    const exec = vi.spyOn(cm, 'executeQuery').mockResolvedValueOnce(undefined);
    const commit = vi.spyOn(cm, 'commitTransaction').mockResolvedValueOnce(undefined);
    const rollback = vi.spyOn(cm, 'rollbackTransaction').mockResolvedValueOnce(undefined);
    const close = vi.spyOn(cm, 'closeConnection').mockResolvedValueOnce(undefined);

    const res = await POST(new NextRequest('http://localhost', { method: 'POST' }), makeProps('someotherview', 'myschema'));

    expect(res.status).toBe(HTTPResponses.OK);
    expect(begin).toHaveBeenCalledTimes(1);
    // The route builds: `CALL schema.Refresh${''}();` -> `CALL schema.Refresh();`
    expect(exec).toHaveBeenCalledWith('CALL myschema.Refresh();');
    expect(commit).toHaveBeenCalledWith('tx-3');
    expect(rollback).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('on error: rolls back with the transaction id and closes', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const begin = vi.spyOn(cm, 'beginTransaction').mockResolvedValueOnce('tx-err');
    const exec = vi.spyOn(cm, 'executeQuery').mockRejectedValueOnce(new Error('kaboom'));
    const commit = vi.spyOn(cm, 'commitTransaction').mockResolvedValueOnce(undefined);
    const rollback = vi.spyOn(cm, 'rollbackTransaction').mockResolvedValueOnce(undefined);
    const close = vi.spyOn(cm, 'closeConnection').mockResolvedValueOnce(undefined);

    await expect(POST(new NextRequest('http://localhost', { method: 'POST' }), makeProps('viewfulltable', 'myschema'))).rejects.toThrow(/Call failed/i);

    expect(begin).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledTimes(1);
    expect(rollback).toHaveBeenCalledWith('tx-err');
    expect(commit).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
