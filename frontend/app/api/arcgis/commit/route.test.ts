import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HTTPResponses } from '@/config/macros';

const mocks = vi.hoisted(() => ({ commit: vi.fn(), ownership: vi.fn(), scope: vi.fn(), batchGuard: vi.fn() }));
vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { email: 'arcgis-owner@example.com', userStatus: 'global', sites: [] } })) }));
vi.mock('@/ailogger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/db/connectionmanager', () => ({ default: { getInstance: () => ({}) } }));
vi.mock('@/config/editplan/scopeguard', async importOriginal => ({
  ...(await importOriginal<typeof import('@/config/editplan/scopeguard')>()),
  assertCanEditMeasurementScope: mocks.scope
}));
vi.mock('@/config/uploadsessiontracker', async importOriginal => ({
  ...(await importOriginal<typeof import('@/config/uploadsessiontracker')>()),
  requireUploadSessionOwnership: mocks.ownership
}));
vi.mock('@/lib/uploads/arcgis-commit', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/uploads/arcgis-commit')>()),
  commitArcgisImport: mocks.commit
}));
vi.mock('@/lib/arcgis/import-session', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/arcgis/import-session')>()),
  assertCallerBatchAcceptedForImport: mocks.batchGuard
}));

import { POST } from './route';
import { ArcgisCommitSupersededError, StaleArcgisClientBatchError } from '@/lib/arcgis/import-session';
import { ArcgisCensusReplacementIncompleteError, ArcgisCommitVerificationError } from '@/lib/uploads/arcgis-commit';

const DERIVED_BATCH = 'arc0000000000000000000000561';
const LEGACY_CLIENT_BATCH = 'lg1k2a-legacyclient0';
const STALE_PAGE_BATCH = 'm9x7k2a-8fh3k9d2x5p';
const UPLOAD_SESSION_ID = 'upload-session-B';
const BODY = {
  schema: 'forestgeo_testing',
  plotID: 22,
  censusID: 6,
  importSessionId: '6f1c2d3e-4a5b-4c6d-8e7f-901234567890',
  fileName: 'arcgis.xlsx',
  uploadMode: 'clean_reupload'
};

function request(body: Record<string, unknown>) {
  return new Request('http://localhost/api/arcgis/commit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-upload-session-id': UPLOAD_SESSION_ID },
    body: JSON.stringify(body)
  }) as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.scope.mockResolvedValue(undefined);
  mocks.ownership.mockResolvedValue({ sessionId: UPLOAD_SESSION_ID });
  mocks.commit.mockResolvedValue({ rowCount: 3, fileName: 'arcgis.xlsx', alreadyCommitted: false, batchID: DERIVED_BATCH });
  mocks.batchGuard.mockResolvedValue(undefined);
});

describe('POST /api/arcgis/commit (#561)', () => {
  it('accepts a body without batchID and returns the server batch (D28)', async () => {
    const response = await POST(request(BODY));
    const payload = await response.json();
    console.log(`[route] status=${response.status} payload=${JSON.stringify(payload)} commit args=${JSON.stringify(mocks.commit.mock.calls[0]?.[1])}`);
    expect(response.status).toBe(HTTPResponses.OK);
    expect(payload.batchID).toBe(DERIVED_BATCH);
    expect(mocks.commit.mock.calls[0][1].batchID).toBeUndefined();
    expect(mocks.batchGuard).not.toHaveBeenCalled();
  });

  it('checks a sent batch with the stale-batch guard and forwards it when accepted (legacy replay)', async () => {
    await POST(request({ ...BODY, batchID: LEGACY_CLIENT_BATCH }));
    expect(mocks.batchGuard).toHaveBeenCalledWith(expect.anything(), {
      schema: BODY.schema,
      importSessionId: BODY.importSessionId,
      batchID: LEGACY_CLIENT_BATCH
    });
    expect(mocks.commit.mock.calls[0][1].batchID).toBe(LEGACY_CLIENT_BATCH);
  });

  it('runs the stale-batch guard after the scope and upload-session checks, and before the commit', async () => {
    const callOrder: string[] = [];
    mocks.scope.mockImplementationOnce(async () => void callOrder.push('scope'));
    mocks.ownership.mockImplementationOnce(async () => (callOrder.push('ownership'), { sessionId: UPLOAD_SESSION_ID }));
    mocks.batchGuard.mockImplementationOnce(async () => void callOrder.push('guard'));
    mocks.commit.mockImplementationOnce(
      async () => (callOrder.push('commit'), { rowCount: 3, fileName: 'arcgis.xlsx', alreadyCommitted: false, batchID: DERIVED_BATCH })
    );

    await POST(request({ ...BODY, batchID: LEGACY_CLIENT_BATCH }));

    console.log(`[route] call order: ${callOrder.join(' -> ')}`);
    expect(callOrder).toEqual(['scope', 'ownership', 'guard', 'commit']);
  });

  it('answers 409 "reload the page" to a stale bundle\'s random batch and never commits (M4)', async () => {
    mocks.batchGuard.mockRejectedValueOnce(new StaleArcgisClientBatchError(BODY.importSessionId));
    const response = await POST(request({ ...BODY, batchID: STALE_PAGE_BATCH }));
    const payload = await response.json();
    console.log(`[route] stale batch -> ${response.status} ${JSON.stringify(payload)}`);
    expect(response.status).toBe(HTTPResponses.CONFLICT);
    expect(payload.error).toMatch(/reload the page/i);
    expect(mocks.commit).not.toHaveBeenCalled();
  });

  it('still rejects a body that is missing a required parameter with 400 that no longer names batchID', async () => {
    const response = await POST(request({ ...BODY, fileName: '' }));
    const payload = await response.json();
    console.log(`[route] missing fileName -> ${response.status} ${JSON.stringify(payload)}`);
    expect(response.status).toBe(HTTPResponses.INVALID_REQUEST);
    expect(payload.error).not.toMatch(/batchID/);
    expect(mocks.commit).not.toHaveBeenCalled();
  });

  it.each([
    [
      'ArcgisCommitVerificationError',
      new ArcgisCommitVerificationError({
        importSessionId: BODY.importSessionId,
        expectedStagedRows: 3,
        foundStagedRows: 2,
        expectedFailureRows: 0,
        foundFailureRows: 0
      }),
      HTTPResponses.CONFLICT,
      /re-run the import/i
    ],
    [
      'ArcgisCensusReplacementIncompleteError',
      new ArcgisCensusReplacementIncompleteError(BODY.importSessionId, UPLOAD_SESSION_ID),
      HTTPResponses.CONFLICT,
      /re-run the import/i
    ],
    [
      'ArcgisCommitSupersededError',
      new ArcgisCommitSupersededError(BODY.importSessionId, 'attempt-old', 'attempt-new'),
      HTTPResponses.CONFLICT,
      /newer commit attempt/i
    ],
    ['an unexpected error', new Error('connection reset'), HTTPResponses.INTERNAL_SERVER_ERROR, /connection reset/]
  ])('maps %s to its status (AC 19)', async (label, error, status, messagePattern) => {
    mocks.commit.mockRejectedValueOnce(error);
    const response = await POST(request(BODY));
    const payload = await response.json();
    console.log(`[route] ${label} -> ${response.status} ${JSON.stringify(payload)}`);
    expect(response.status).toBe(status);
    expect(payload.error).toMatch(messagePattern);
  });
});
