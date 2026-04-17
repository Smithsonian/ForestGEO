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

// Mock schema validation to accept test schemas
vi.mock('@/config/utils/sqlsecurity', () => ({
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

describe('POST /api/refreshviews/[view]/[schema]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 if schema or view is missing/undefined', async () => {
    const res1 = await POST(new NextRequest('http://localhost'), makeProps(undefined as any, 'myschema'));
    expect(res1.status).toBe(HTTPResponses.INVALID_REQUEST);
    const res2 = await POST(new NextRequest('http://localhost'), makeProps('viewfulltable', undefined as any));
    expect(res2.status).toBe(HTTPResponses.INVALID_REQUEST);
    const res3 = await POST(new NextRequest('http://localhost'), makeProps('undefined' as any, 'myschema'));
    expect(res3.status).toBe(HTTPResponses.INVALID_REQUEST);
    const res4 = await POST(new NextRequest('http://localhost'), makeProps('viewfulltable', 'undefined' as any));
    expect(res4.status).toBe(HTTPResponses.INVALID_REQUEST);
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
    // safeFormatQuery wraps schema in backticks
    expect(exec).toHaveBeenCalledWith('CALL `myschema`.RefreshViewFullTable()', undefined, 'tx-1');
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
    // safeFormatQuery wraps schema in backticks
    expect(exec).toHaveBeenCalledWith('CALL `myschema`.RefreshMeasurementsSummary()', undefined, 'tx-2');
    expect(commit).toHaveBeenCalledWith('tx-2');
    expect(rollback).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('measurementssummary with plot/census context refreshes only the active scope', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const begin = vi.spyOn(cm, 'beginTransaction').mockResolvedValueOnce('tx-3');
    const exec = vi.spyOn(cm, 'executeQuery').mockResolvedValue(undefined);
    const commit = vi.spyOn(cm, 'commitTransaction').mockResolvedValueOnce(undefined);
    const rollback = vi.spyOn(cm, 'rollbackTransaction').mockResolvedValueOnce(undefined);
    const close = vi.spyOn(cm, 'closeConnection').mockResolvedValueOnce(undefined);

    const request = new NextRequest('http://localhost', {
      method: 'POST',
      body: JSON.stringify({ plotID: 17, censusID: 42 })
    });

    const res = await POST(request, makeProps('measurementssummary', 'myschema'));

    expect(res.status).toBe(HTTPResponses.OK);
    expect(begin).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenNthCalledWith(1, 'DELETE FROM `myschema`.measurementssummary WHERE PlotID = ? AND CensusID = ?', [17, 42], 'tx-3');
    expect(exec).toHaveBeenNthCalledWith(2, expect.stringContaining('INSERT IGNORE INTO `myschema`.measurementssummary'), [17, 42], 'tx-3');
    expect(String(exec.mock.calls[1]?.[0])).toContain('LEFT JOIN `myschema`.stems st');
    expect(String(exec.mock.calls[1]?.[0])).toContain('COALESCE(st.StemTag, cm.RawStemTag)');
    expect(String(exec.mock.calls[1]?.[0])).toContain('COALESCE(q.QuadratName, cm.RawQuadrat)');
    expect(String(exec.mock.calls[1]?.[0])).toContain('measurement_error_log');
    expect(String(exec.mock.calls[1]?.[0])).not.toContain("me.ErrorSource = 'validation'");
    expect(exec).not.toHaveBeenCalledWith('CALL `myschema`.RefreshMeasurementsSummary()');
    expect(commit).toHaveBeenCalledWith('tx-3');
    expect(rollback).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('unknown view: returns 400 for invalid view name', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const begin = vi.spyOn(cm, 'beginTransaction');
    const exec = vi.spyOn(cm, 'executeQuery');

    // Route now validates view against whitelist and rejects unknown views
    const res = await POST(new NextRequest('http://localhost', { method: 'POST' }), makeProps('someotherview', 'myschema'));

    expect(res.status).toBe(HTTPResponses.INVALID_REQUEST);
    expect(begin).not.toHaveBeenCalled();
    expect(exec).not.toHaveBeenCalled();
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
