/**
 * Unit tests for GET /api/export/ctfs-rebuild-view/[schema].
 *
 * The endpoint is schema-scoped, performs NO app-schema DB query, and returns
 * the input-independent ViewFullTable rebuild artifact. Heavy deps (auth,
 * ctfs-export renderer, ailogger) are mocked so the suite runs without a DB.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HTTPResponses } from '@/config/macros';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  isValidSchema: vi.fn(() => true),
  renderRebuild: vi.fn(() => '-- rebuild artifact --'),
  loggerInfo: vi.fn(),
  loggerError: vi.fn()
}));

vi.mock('@/auth', () => ({ auth: mocks.auth }));
vi.mock('@/config/utils/sqlsecurity', () => ({ isValidSchema: mocks.isValidSchema }));
vi.mock('@/lib/ctfs-export', () => ({ renderRebuildViewFullTableArtifact: mocks.renderRebuild }));
vi.mock('@/ailogger', () => ({ default: { info: mocks.loggerInfo, error: mocks.loggerError } }));

import { GET } from './route';
import type { NextRequest } from 'next/server';

const VALID_SCHEMA = 'forestgeo_testing';

function makeUrl(overrides: Record<string, string | undefined> = {}): URL {
  const url = new URL(`http://localhost/api/export/ctfs-rebuild-view/${VALID_SCHEMA}`);
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) url.searchParams.delete(k);
    else url.searchParams.set(k, v);
  }
  return url;
}
function makeRequest(url: URL = makeUrl()): NextRequest {
  return { nextUrl: url } as unknown as NextRequest;
}
function makeProps(schema = VALID_SCHEMA) {
  return { params: Promise.resolve({ schema }) };
}

const ADMIN_SESSION = { user: { email: 'admin@example.com', name: 'A', userStatus: 'db admin', sites: [], allsites: [] } };
const LEAD_IN_SCOPE = { user: { email: 'lead@example.com', name: 'L', userStatus: 'lead technician', sites: [{ schemaName: VALID_SCHEMA }], allsites: [] } };
const LEAD_OUT_OF_SCOPE = {
  user: { email: 'lead2@example.com', name: 'L2', userStatus: 'lead technician', sites: [{ schemaName: 'other_schema' }], allsites: [] }
};

describe('GET /api/export/ctfs-rebuild-view/:schema', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue(ADMIN_SESSION);
    mocks.isValidSchema.mockReturnValue(true);
    mocks.renderRebuild.mockReturnValue('-- rebuild artifact --');
  });

  it('returns 401 when unauthenticated', async () => {
    mocks.auth.mockResolvedValue(null);
    const res = await GET(makeRequest(), makeProps());
    expect(res.status).toBe(HTTPResponses.UNAUTHORIZED);
  });

  it('returns 400 when the schema is malformed', async () => {
    mocks.isValidSchema.mockReturnValue(false);
    const res = await GET(makeRequest(), makeProps('bad schema'));
    expect(res.status).toBe(HTTPResponses.BAD_REQUEST);
  });

  it('returns 403 when a lead technician requests a schema outside their scope', async () => {
    mocks.auth.mockResolvedValue(LEAD_OUT_OF_SCOPE);
    const res = await GET(makeRequest(), makeProps());
    expect(res.status).toBe(HTTPResponses.FORBIDDEN);
  });

  it('returns 200 with the rebuild artifact + download headers for an in-scope lead', async () => {
    mocks.auth.mockResolvedValue(LEAD_IN_SCOPE);
    const res = await GET(makeRequest(), makeProps());
    expect(res.status).toBe(HTTPResponses.OK);
    expect(res.headers.get('Content-Type')).toMatch(/application\/sql/i);
    expect(res.headers.get('Content-Disposition')).toMatch(/^attachment; filename=ctfs-rebuild-viewfulltable-\d+\.sql$/);
    expect(await res.text()).toBe('-- rebuild artifact --');
  });

  it('does not depend on destinationPlotID: the artifact body is identical with or without it', async () => {
    const withParam = await (await GET(makeRequest(makeUrl({ destinationPlotID: '5' })), makeProps())).text();
    const without = await (await GET(makeRequest(), makeProps())).text();
    expect(withParam).toBe(without);
    expect(mocks.renderRebuild).toHaveBeenCalledWith();
  });

  it('records destinationPlotID in the audit log and filename when supplied', async () => {
    const res = await GET(makeRequest(makeUrl({ destinationPlotID: '5' })), makeProps());
    expect(res.headers.get('Content-Disposition')).toMatch(/^attachment; filename=ctfs-rebuild-viewfulltable-5-\d+\.sql$/);
    const [message, meta] = mocks.loggerInfo.mock.calls[0];
    expect(message).toMatch(/ctfs-viewfulltable rebuild generated/i);
    expect(meta.schema).toBe(VALID_SCHEMA);
    expect(meta.destinationPlotID).toBe('5');
    expect(meta.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('ignores a non-integer destinationPlotID (no header injection)', async () => {
    const res = await GET(makeRequest(makeUrl({ destinationPlotID: 'evil; rm -rf' })), makeProps());
    expect(res.headers.get('Content-Disposition')).toMatch(/^attachment; filename=ctfs-rebuild-viewfulltable-\d+\.sql$/);
  });

  it('audits generatedAt even with no destinationPlotID', async () => {
    await GET(makeRequest(), makeProps());
    const [, meta] = mocks.loggerInfo.mock.calls[0];
    expect(meta.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(meta.destinationPlotID).toBeUndefined();
  });
});
