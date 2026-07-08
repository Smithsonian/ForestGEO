import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Connection } from 'mysql2/promise';
import { setupTestDatabase, teardownTestDatabase } from '../setup/local-db-setup';

const AUTH_USER_EMAIL = 'integration-runner@forestgeo.test';
const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;
const HTTP_BAD_REQUEST = 400;
const OUT_OF_SCOPE_SCHEMA = 'forestgeo_panama';
const INVALID_SCHEMA = 'foo;DROP';
const STUB_ARTIFACT = '-- rebuild viewfulltable artifact --';

// This route performs NO app-schema DB query. The renderer is mocked so the
// artifact is deterministic; isValidSchema and userCanExportSchema stay REAL so
// the guard and the export-role gate exercise their true logic. renderRebuild
// is the "work" spy: it must NOT run on a denial.
const mocks = vi.hoisted(() => ({
  renderRebuild: vi.fn(() => STUB_ARTIFACT)
}));

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({
    user: { email: AUTH_USER_EMAIL, userStatus: 'global', sites: [] }
  }))
}));

vi.mock('@/lib/ctfs-export', () => ({
  renderRebuildViewFullTableArtifact: mocks.renderRebuild
}));

vi.mock('@/ailogger', () => ({
  default: {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined
  }
}));

describe('GET /api/export/ctfs-rebuild-view/[schema] authz', () => {
  let connection: Connection;
  let schema: string;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    schema = setup.config.database;
  }, 90000);

  afterAll(async () => {
    await teardownTestDatabase(connection);
  });

  function makeRequest() {
    return new NextRequest(`http://localhost/api/export/ctfs-rebuild-view/${schema}`);
  }

  function makeContext(overrideSchema: string) {
    return { params: Promise.resolve({ schema: overrideSchema }) } as any;
  }

  it('denies an out-of-scope schema with 403 and renders no artifact', async () => {
    mocks.renderRebuild.mockClear();
    const { auth } = await import('@/auth');
    vi.mocked(auth).mockResolvedValueOnce({
      user: { email: 'attacker@forestgeo.test', userStatus: 'field crew', sites: [{ schemaName: OUT_OF_SCOPE_SCHEMA }] }
    } as any);

    const { GET } = await import('@/app/api/export/ctfs-rebuild-view/[schema]/route');
    const res = await GET(makeRequest(), makeContext(schema));

    expect(res.status).toBe(HTTP_FORBIDDEN);
    expect(mocks.renderRebuild).not.toHaveBeenCalled();
  });

  it('rejects a structurally invalid schema with 400 and renders no artifact', async () => {
    mocks.renderRebuild.mockClear();
    const { GET } = await import('@/app/api/export/ctfs-rebuild-view/[schema]/route');
    const res = await GET(makeRequest(), makeContext(INVALID_SCHEMA));

    expect(res.status).toBe(HTTP_BAD_REQUEST);
    expect(mocks.renderRebuild).not.toHaveBeenCalled();
  });

  it('returns 200 with the rebuild artifact for an authorized member request', async () => {
    mocks.renderRebuild.mockClear();
    const { GET } = await import('@/app/api/export/ctfs-rebuild-view/[schema]/route');
    const res = await GET(makeRequest(), makeContext(schema));

    expect(res.status).toBe(HTTP_OK);
    expect(res.headers.get('Content-Type')).toMatch(/application\/sql/i);
    expect(await res.text()).toBe(STUB_ARTIFACT);
    expect(mocks.renderRebuild).toHaveBeenCalledTimes(1);
  });
});
