import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { HTTPResponses } from '@/config/macros';
import { ScopeAccessError, ScopeBusyError } from '@/config/editplan/scopeguard';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), override: vi.fn(), quarantine: vi.fn() }));
vi.mock('@/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/validations/override', () => ({ overrideValidationScope: mocks.override }));
vi.mock('@/lib/db/connectionmanager', () => ({ default: { getInstance: () => ({}) } }));
vi.mock('@/lib/schema-quarantine', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/schema-quarantine')>()),
  findSchemaQuarantine: mocks.quarantine
}));

import { POST } from './route';
const SCHEMA = 'forestgeo_testing';
const CONTEXT = { params: Promise.resolve({}) };
function request(body: unknown = { schema: SCHEMA, plotID: 1, censusID: 2 }) {
  return new NextRequest('http://localhost/api/validations/override', { method: 'POST', body: JSON.stringify(body) });
}

describe('atomic validation override endpoint', () => {
  beforeEach(() => {
    mocks.auth.mockResolvedValue({ user: { email: 'admin@example.test', userStatus: 'global', sites: [] } });
    mocks.quarantine.mockResolvedValue(null);
    mocks.override.mockResolvedValue(3);
  });
  it('requires a session and preserves the admin-only write restriction', async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await POST(request(), CONTEXT)).status).toBe(HTTPResponses.UNAUTHORIZED);
    mocks.auth.mockResolvedValue({ user: { userStatus: 'field crew', sites: [{ schemaName: SCHEMA }] } });
    expect((await POST(request(), CONTEXT)).status).toBe(HTTPResponses.FORBIDDEN);
    expect(mocks.override).not.toHaveBeenCalled();
  });
  it.each([0, -1, 1.5, '2', null])('rejects invalid census ID %s before mutation', async censusID => {
    expect((await POST(request({ schema: SCHEMA, plotID: 1, censusID }), CONTEXT)).status).toBe(HTTPResponses.BAD_REQUEST);
    expect(mocks.override).not.toHaveBeenCalled();
  });
  it('rejects an invalid schema before mutation', async () => {
    expect((await POST(request({ schema: 'bad;schema', plotID: 1, censusID: 2 }), CONTEXT)).status).toBe(HTTPResponses.BAD_REQUEST);
    expect(mocks.override).not.toHaveBeenCalled();
  });
  it('submits exactly one scoped operation and reports its committed affected rows', async () => {
    const response = await POST(request(), CONTEXT);
    expect(response.status).toBe(HTTPResponses.OK);
    expect(await response.json()).toEqual({ affectedRows: 3 });
    expect(mocks.override).toHaveBeenCalledExactlyOnceWith({}, { schema: SCHEMA, plotID: 1, censusID: 2 });
  });
  it('maps scope mismatch and busy failures without reporting success', async () => {
    mocks.override.mockRejectedValueOnce(new ScopeAccessError());
    expect((await POST(request(), CONTEXT)).status).toBe(HTTPResponses.BAD_REQUEST);
    mocks.override.mockRejectedValueOnce(new ScopeBusyError());
    expect((await POST(request(), CONTEXT)).status).toBe(HTTPResponses.CONFLICT);
  });
  it('does not expose database failure details or report a failed commit as success', async () => {
    mocks.override.mockRejectedValue(new Error('private database failure detail'));
    const response = await POST(request(), CONTEXT);
    expect(response.status).toBe(HTTPResponses.INTERNAL_SERVER_ERROR);
    expect(await response.text()).not.toContain('private database failure detail');
  });
});
