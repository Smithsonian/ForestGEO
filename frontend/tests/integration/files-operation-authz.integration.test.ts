import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const AUTH_USER_EMAIL = 'integration-runner@forestgeo.test';
const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;
const HTTP_BAD_REQUEST = 400;
// Structurally valid schema (matches VALID_SCHEMA_PATTERN); files never touches the DB.
const MEMBER_SCHEMA = 'forestgeo_testing';
const OUT_OF_SCOPE_SCHEMA = 'forestgeo_panama';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getContainerClient: vi.fn(),
  uploadValidFileAsBuffer: vi.fn()
}));

vi.mock('@/auth', () => ({ auth: mocks.auth }));

vi.mock('@/config/macros/azurestorage', () => ({
  getContainerClient: mocks.getContainerClient,
  uploadValidFileAsBuffer: mocks.uploadValidFileAsBuffer
}));

vi.mock('@/ailogger', () => ({
  default: {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined
  }
}));

function memberSession() {
  return {
    user: {
      email: AUTH_USER_EMAIL,
      name: 'Integration Runner',
      userStatus: 'field crew',
      sites: [{ schemaName: MEMBER_SCHEMA }],
      allsites: []
    }
  };
}

function makeListRequest(schema: string) {
  const url = `http://localhost/api/files/list?schema=${schema}&plotID=1&plotName=BCI&census=2`;
  const request = new NextRequest(url);
  return request;
}

function listContext() {
  return { params: Promise.resolve({ operation: 'list' }) };
}

function makeContainerClient() {
  return {
    exists: vi.fn(async () => true),
    listBlobsFlat: vi.fn(async function* () {
      yield {
        name: 'measurements.csv',
        metadata: { user: AUTH_USER_EMAIL, FormType: 'measurements', FileErrorState: '[]' },
        properties: { lastModified: new Date('2026-01-01T00:00:00Z') }
      };
    })
  };
}

describe('GET /api/files/[operation] authz', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue(memberSession());
    mocks.getContainerClient.mockResolvedValue(makeContainerClient());
  });

  it('denies an out-of-scope schema with 403 before any blob-storage call', async () => {
    mocks.auth.mockResolvedValue({
      user: { email: 'attacker@forestgeo.test', userStatus: 'field crew', sites: [{ schemaName: OUT_OF_SCOPE_SCHEMA }], allsites: [] }
    });

    const { GET } = await import('@/app/api/files/[operation]/route');
    const res = await GET(makeListRequest(MEMBER_SCHEMA) as any, listContext());

    expect(res.status).toBe(HTTP_FORBIDDEN);
    // The guard short-circuits before the handler reaches Azure blob storage.
    expect(mocks.getContainerClient).not.toHaveBeenCalled();
  });

  it('rejects a structurally invalid schema with 400 before any blob-storage call', async () => {
    const { GET } = await import('@/app/api/files/[operation]/route');
    const res = await GET(makeListRequest('foo%3BDROP') as any, listContext());

    expect(res.status).toBe(HTTP_BAD_REQUEST);
    expect(mocks.getContainerClient).not.toHaveBeenCalled();
  });

  it('lists files with 200 for an authorized member request', async () => {
    const { GET } = await import('@/app/api/files/[operation]/route');
    const res = await GET(makeListRequest(MEMBER_SCHEMA) as any, listContext());

    expect(res.status).toBe(HTTP_OK);
    const body = await res.json();
    expect(body.responseMessage).toBe('List of files');
    // F19: containers are schema-scoped; the legacy shared 'plot1-census2' name
    // must never be consulted from a user-facing path.
    expect(body.containerName).toBe('forestgeo-testing-plot1-census2');
    expect(body.blobData).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'measurements.csv' })]));
    // The member request reached the (mocked) blob layer.
    expect(mocks.getContainerClient).toHaveBeenCalledWith('forestgeo-testing-plot1-census2', { createIfMissing: false });
  });
});
