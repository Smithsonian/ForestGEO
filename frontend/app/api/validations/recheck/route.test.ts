import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { HTTPResponses } from '@/config/macros';
import { ScopeAccessError, ScopeBusyError } from '@/config/editplan/scopeguard';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), recheck: vi.fn(), quarantine: vi.fn(), ailoggerError: vi.fn() }));
vi.mock('@/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/validations/reset', () => ({ recheckMeasurementValidation: mocks.recheck }));
vi.mock('@/lib/db/connectionmanager', () => ({ default: { getInstance: () => ({}) } }));
vi.mock('@/lib/schema-quarantine', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/schema-quarantine')>()),
  findSchemaQuarantine: mocks.quarantine
}));
vi.mock('@/ailogger', () => ({ default: { error: mocks.ailoggerError, info: vi.fn(), warn: vi.fn() } }));

import { POST } from './route';
const SCHEMA = 'forestgeo_testing';
const CONTEXT = { params: Promise.resolve({}) };
function rawRequest(body: string) {
  return new NextRequest('http://localhost/api/validations/recheck', { method: 'POST', body });
}
function request(body: unknown = { schema: SCHEMA, plotID: 1, censusID: 2, coreMeasurementID: 7 }) {
  return rawRequest(JSON.stringify(body));
}

describe('atomic single-measurement recheck endpoint', () => {
  beforeEach(() => {
    mocks.auth.mockResolvedValue({ user: { email: 'admin@example.test', userStatus: 'global', sites: [] } });
    mocks.quarantine.mockResolvedValue(null);
    mocks.recheck.mockResolvedValue(1);
    mocks.ailoggerError.mockClear();
  });

  it('requires a session and preserves the admin-only write restriction', async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await POST(request(), CONTEXT)).status).toBe(HTTPResponses.UNAUTHORIZED);
    mocks.auth.mockResolvedValue({ user: { userStatus: 'field crew', sites: [{ schemaName: SCHEMA }] } });
    expect((await POST(request(), CONTEXT)).status).toBe(HTTPResponses.FORBIDDEN);
    expect(mocks.recheck).not.toHaveBeenCalled();
  });

  it('rejects a non-admin outside the schema site before the admin check or any mutation', async () => {
    mocks.auth.mockResolvedValue({ user: { userStatus: 'field crew', sites: [{ schemaName: 'some_other_schema' }] } });
    expect((await POST(request(), CONTEXT)).status).toBe(HTTPResponses.FORBIDDEN);
    expect(mocks.recheck).not.toHaveBeenCalled();
  });

  it('rejects a quarantined schema even for a global admin, without calling the service', async () => {
    mocks.quarantine.mockResolvedValue({
      schemaName: SCHEMA,
      quarantinedAt: new Date('2024-01-01T00:00:00.000Z'),
      reason: 'failed deploy contract gate',
      runRef: 'run-123'
    });
    const response = await POST(request(), CONTEXT);
    expect(response.status).toBe(HTTPResponses.SERVICE_UNAVAILABLE);
    expect(mocks.recheck).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before mutation', async () => {
    expect((await POST(rawRequest('{not json'), CONTEXT)).status).toBe(HTTPResponses.BAD_REQUEST);
    expect(mocks.recheck).not.toHaveBeenCalled();
  });

  it('rejects a body containing a bare NaN token (invalid JSON, since JSON has no NaN literal) before mutation', async () => {
    const response = await POST(rawRequest('{"schema":"forestgeo_testing","plotID":1,"censusID":2,"coreMeasurementID":NaN}'), CONTEXT);
    expect(response.status).toBe(HTTPResponses.BAD_REQUEST);
    expect(mocks.recheck).not.toHaveBeenCalled();
  });

  it.each([null, [], 'string', 42, true])('rejects a non-object body %s before mutation', async body => {
    expect((await POST(request(body), CONTEXT)).status).toBe(HTTPResponses.BAD_REQUEST);
    expect(mocks.recheck).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, '2', null, undefined, Number.MAX_SAFE_INTEGER + 1])('rejects invalid plot ID %s before mutation', async plotID => {
    expect((await POST(request({ schema: SCHEMA, plotID, censusID: 2, coreMeasurementID: 7 }), CONTEXT)).status).toBe(HTTPResponses.BAD_REQUEST);
    expect(mocks.recheck).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, '2', null, undefined, Number.MAX_SAFE_INTEGER + 1])('rejects invalid census ID %s before mutation', async censusID => {
    expect((await POST(request({ schema: SCHEMA, plotID: 1, censusID, coreMeasurementID: 7 }), CONTEXT)).status).toBe(HTTPResponses.BAD_REQUEST);
    expect(mocks.recheck).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, '2', null, undefined, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid core measurement ID %s before mutation',
    async coreMeasurementID => {
      expect((await POST(request({ schema: SCHEMA, plotID: 1, censusID: 2, coreMeasurementID }), CONTEXT)).status).toBe(HTTPResponses.BAD_REQUEST);
      expect(mocks.recheck).not.toHaveBeenCalled();
    }
  );

  it('rejects a non-string schema before mutation', async () => {
    expect((await POST(request({ schema: 123, plotID: 1, censusID: 2, coreMeasurementID: 7 }), CONTEXT)).status).toBe(HTTPResponses.BAD_REQUEST);
    expect(mocks.recheck).not.toHaveBeenCalled();
  });

  it('rejects an invalid (non-empty but malformed) schema string before mutation', async () => {
    expect((await POST(request({ schema: 'bad;schema', plotID: 1, censusID: 2, coreMeasurementID: 7 }), CONTEXT)).status).toBe(HTTPResponses.BAD_REQUEST);
    expect(mocks.recheck).not.toHaveBeenCalled();
  });

  it('submits exactly one scoped recheck and reports its committed row count', async () => {
    const response = await POST(request(), CONTEXT);
    expect(response.status).toBe(HTTPResponses.OK);
    expect(await response.json()).toEqual({ affectedRows: 1 });
    expect(mocks.recheck).toHaveBeenCalledExactlyOnceWith({}, { schema: SCHEMA, plotID: 1, censusID: 2, coreMeasurementID: 7 });
  });

  it('maps scope mismatch (including a missing measurement) and busy failures without reporting success', async () => {
    mocks.recheck.mockRejectedValueOnce(new ScopeAccessError());
    expect((await POST(request(), CONTEXT)).status).toBe(HTTPResponses.BAD_REQUEST);
    mocks.recheck.mockRejectedValueOnce(new ScopeBusyError());
    expect((await POST(request(), CONTEXT)).status).toBe(HTTPResponses.CONFLICT);
  });

  it('does not expose database failure details, does not report a failed commit as success, and logs the failure server-side', async () => {
    const dbError = new Error('private database failure detail');
    mocks.recheck.mockRejectedValue(dbError);
    const response = await POST(request(), CONTEXT);
    expect(response.status).toBe(HTTPResponses.INTERNAL_SERVER_ERROR);
    expect(await response.text()).not.toContain('private database failure detail');
    expect(mocks.ailoggerError).toHaveBeenCalledExactlyOnceWith('Validation recheck failed', dbError);
  });
});
