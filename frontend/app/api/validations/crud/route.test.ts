import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { HTTPResponses } from '@/config/macros';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  executeQuery: vi.fn(async () => []),
  beginTransaction: vi.fn(async () => 'tx-1'),
  commitTransaction: vi.fn(async () => undefined),
  rollbackTransaction: vi.fn(async () => undefined),
  closeConnection: vi.fn(async () => undefined)
}));

vi.mock('@/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/db/connectionmanager', () => ({
  default: {
    getInstance: () => ({
      executeQuery: mocks.executeQuery,
      beginTransaction: mocks.beginTransaction,
      commitTransaction: mocks.commitTransaction,
      rollbackTransaction: mocks.rollbackTransaction,
      closeConnection: mocks.closeConnection
    })
  }
}));

// The global unit setup stubs the mapper; these tests need its real key transformation,
// which is what turns `validationID` into a column MySQL would accept.
vi.mock('@/config/datamapper', async () => vi.importActual('@/config/datamapper'));

import { GET, POST, PATCH, DELETE } from './route';

function makeReq(method: string, url = 'http://localhost/api/validations/crud?schema=forestgeo_testing', body?: unknown): NextRequest {
  return new NextRequest(url, body === undefined ? { method } : { method, body: JSON.stringify(body) });
}

describe('/api/validations/crud auth gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET returns 401 when no session', async () => {
    mocks.auth.mockResolvedValue(null);
    const res = await GET(makeReq('GET'));
    expect(res.status).toBe(401);
    expect(mocks.executeQuery).not.toHaveBeenCalled();
  });

  it('POST returns 403 for non-admin users', async () => {
    mocks.auth.mockResolvedValue({ user: { email: 'f@example.com', userStatus: 'field crew', sites: [], allsites: [] } });
    const res = await POST(makeReq('POST', undefined, { procedureName: 'x' }));
    expect(res.status).toBe(403);
    expect(mocks.beginTransaction).not.toHaveBeenCalled();
  });

  it('POST returns 503 when permissions could not be verified', async () => {
    mocks.auth.mockResolvedValue({ user: { email: 'a@example.com', permissionsUnavailable: true, sites: [], allsites: [] } });
    const res = await POST(makeReq('POST', undefined, { procedureName: 'x' }));
    expect(res.status).toBe(503);
    expect(mocks.beginTransaction).not.toHaveBeenCalled();
  });

  it('GET validates schema before executing SQL', async () => {
    mocks.auth.mockResolvedValue({ user: { email: 'a@example.com', userStatus: 'global', sites: [], allsites: [] } });
    const res = await GET(makeReq('GET', 'http://localhost/api/validations/crud?schema=not_allowed'));
    expect(res.status).toBe(400);
    expect(mocks.executeQuery).not.toHaveBeenCalled();
  });

  it('POST allows db admins and answers with the database-assigned id', async () => {
    mocks.auth.mockResolvedValue({ user: { email: 'd@example.com', userStatus: 'db admin', sites: [], allsites: [] } });
    mocks.executeQuery
      .mockResolvedValueOnce({ insertId: 42 } as any)
      .mockResolvedValueOnce([{ ValidationID: 42 }] as any)
      .mockResolvedValueOnce({ affectedRows: 1 } as any);
    const res = await POST(makeReq('POST', undefined, { procedureName: 'dbh_check', validationID: 999 }));
    expect(res.status).toBe(HTTPResponses.OK);
    await expect(res.json()).resolves.toEqual({ insertID: 42, validationID: 42 });
    expect(mocks.commitTransaction).toHaveBeenCalledWith('tx-1');
  });

  it.each([
    ['PATCH', PATCH],
    ['DELETE', DELETE]
  ])('%s of a validation that does not exist returns 404, rolls back and writes nothing', async (method, handler) => {
    mocks.auth.mockResolvedValue({ user: { email: 'a@example.com', userStatus: 'global', sites: [], allsites: [] } });
    mocks.executeQuery.mockResolvedValueOnce([] as any);

    const res = await handler(makeReq(method, undefined, { validationID: 404404, description: 'no such validation' }));

    expect(res.status).toBe(HTTPResponses.NOT_FOUND);
    expect(mocks.executeQuery).toHaveBeenCalledTimes(1);
    expect(mocks.rollbackTransaction).toHaveBeenCalledWith('tx-1');
    expect(mocks.commitTransaction).not.toHaveBeenCalled();
  });

  it.each([
    ['PATCH', true],
    ['PATCH', 1.5],
    ['DELETE', '1 OR 1=1'],
    ['DELETE', undefined],
    ['DELETE', -3]
  ] as const)('%s refuses validationID %j with 400 before opening a transaction', async (method, validationID) => {
    mocks.auth.mockResolvedValue({ user: { email: 'a@example.com', userStatus: 'global', sites: [], allsites: [] } });
    const handler = method === 'PATCH' ? PATCH : DELETE;

    const res = await handler(makeReq(method, undefined, { validationID, description: 'x' }));

    expect(res.status).toBe(HTTPResponses.INVALID_REQUEST);
    expect(mocks.beginTransaction).not.toHaveBeenCalled();
    expect(mocks.executeQuery).not.toHaveBeenCalled();
  });

  it('POST and PATCH write only the writable columns, never a client-supplied primary key in any spelling', async () => {
    mocks.auth.mockResolvedValue({ user: { email: 'a@example.com', userStatus: 'global', sites: [], allsites: [] } });
    mocks.executeQuery
      .mockResolvedValueOnce({ insertId: 5 } as any)
      .mockResolvedValueOnce([{ ValidationID: 5 }] as any)
      .mockResolvedValueOnce({ affectedRows: 1 } as any)
      .mockResolvedValueOnce([{ ValidationID: 5 }] as any)
      .mockResolvedValueOnce({ affectedRows: 1 } as any)
      .mockResolvedValueOnce([{ ValidationID: 5 }] as any)
      .mockResolvedValueOnce({ affectedRows: 1 } as any);
    const forgedKeys = { ValidationID: 999, 'sitespecificvalidations.ValidationID': 999, unknownColumn: 'x' };

    await POST(makeReq('POST', undefined, { validationID: 999, procedureName: 'p', ...forgedKeys }));
    await PATCH(makeReq('PATCH', undefined, { validationID: 5, procedureName: 'p', ...forgedKeys }));

    const writes = (mocks.executeQuery.mock.calls as unknown[][])
      .map(call => String(call[0]))
      .filter(sql => /^(INSERT INTO|UPDATE) `?forestgeo_testing`?\.`?sitespecificvalidations/.test(sql));
    expect(writes, writes.join('\n')).toHaveLength(2);
    for (const sql of writes) {
      expect(sql).toContain('`ProcedureName` = ');
      expect(sql.toLowerCase(), sql).not.toContain('validationid` = 999');
      expect(sql).not.toContain('unknownColumn');
    }
  });

  it.each([
    ['POST', POST],
    ['PATCH', PATCH],
    ['DELETE', DELETE]
  ] as const)('%s answers 400, not 500, for a JSON null body', async (method, handler) => {
    mocks.auth.mockResolvedValue({ user: { email: 'a@example.com', userStatus: 'global', sites: [], allsites: [] } });

    const res = await handler(new NextRequest('http://localhost/api/validations/crud?schema=forestgeo_testing', { method, body: 'null' }));

    expect(res.status).toBe(HTTPResponses.INVALID_REQUEST);
    expect(mocks.beginTransaction).not.toHaveBeenCalled();
  });

  it.each([
    ['POST', POST, { validationID: 3 }],
    ['PATCH', PATCH, { validationID: 404404 }]
  ] as const)('%s with no writable field answers 400 before opening a transaction', async (method, handler, body) => {
    mocks.auth.mockResolvedValue({ user: { email: 'a@example.com', userStatus: 'global', sites: [], allsites: [] } });

    const res = await handler(makeReq(method, undefined, body));

    expect(res.status).toBe(HTTPResponses.INVALID_REQUEST);
    expect(mocks.beginTransaction).not.toHaveBeenCalled();
    expect(mocks.executeQuery).not.toHaveBeenCalled();
  });

  it('PATCH and DELETE are admin-only', async () => {
    mocks.auth.mockResolvedValue({ user: { email: 'f@example.com', userStatus: 'field crew', sites: [], allsites: [] } });
    await expect(PATCH(makeReq('PATCH', undefined, { validationID: 1 }))).resolves.toHaveProperty('status', 403);
    await expect(DELETE(makeReq('DELETE', undefined, { validationID: 1 }))).resolves.toHaveProperty('status', 403);
    expect(mocks.beginTransaction).not.toHaveBeenCalled();
  });
});
