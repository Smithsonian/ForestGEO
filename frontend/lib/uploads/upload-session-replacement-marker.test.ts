import { describe, expect, it, vi } from 'vitest';
import type ConnectionManager from '@/lib/db/connectionmanager';
import { UploadMode } from '@/config/uploadmodes';
import { UploadSessionOwnershipError, UploadSessionState } from '@/config/uploadsessiontracker';
import { CENSUS_REPLACEMENT_STATEMENT, SESSION_LOCK_CLAUSE } from '@/tests/setup/census-replacement-statement-patterns';
import {
  claimReferenceTableReplacement,
  lockActiveUploadSessionForCensus,
  lockUploadSessionForCensusReplacement,
  recordReferenceTableReplacement,
  uploadSessionHasCompletedReplacement,
  markUploadSessionReplacementCompleted,
  CENSUS_REPLACEMENT_MARKER_COLUMN
} from './upload-session-replacement-marker';

vi.mock('@/ailogger', () => ({ default: { warn: vi.fn() } }));

function manager() {
  return {
    executeQuery: vi.fn(),
    acquireApplicationLock: vi.fn().mockResolvedValue(true)
  };
}

describe('reference replacement prerequisites', () => {
  it.each([null, '', '   '])('refuses an absent session (%s) without touching the database', async sessionId => {
    const db = manager();
    await expect(
      claimReferenceTableReplacement(db as unknown as ConnectionManager, 'forestgeo_testing', UploadMode.CLEAN_REUPLOAD, sessionId, 'tx')
    ).rejects.toThrow('Upload session is required');
    expect(db.executeQuery).not.toHaveBeenCalled();
    expect(db.acquireApplicationLock).not.toHaveBeenCalled();
  });

  it.each(['ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR'])('propagates %s instead of replacing without a marker', async code => {
    const db = manager();
    const error = Object.assign(new Error('upload_sessions prerequisite missing'), { code });
    db.executeQuery.mockRejectedValue(error);
    await expect(
      claimReferenceTableReplacement(db as unknown as ConnectionManager, 'forestgeo_testing', UploadMode.CLEAN_REUPLOAD, 'session', 'tx')
    ).rejects.toBe(error);
    expect(db.executeQuery).toHaveBeenCalledTimes(1);
    expect(db.executeQuery.mock.calls[0][0]).toMatch(/^SELECT reference_replacement_completed_at/);
    await expect(recordReferenceTableReplacement(db as unknown as ConnectionManager, 'forestgeo_testing', 'session', 'tx')).rejects.toBe(error);
  });

  it('requires a matching row for both reading and recording the marker', async () => {
    const db = manager();
    db.executeQuery.mockResolvedValueOnce([]).mockResolvedValueOnce({ affectedRows: 0 });
    await expect(
      claimReferenceTableReplacement(db as unknown as ConnectionManager, 'forestgeo_testing', UploadMode.CLEAN_REUPLOAD, 'session', 'tx')
    ).rejects.toThrow('was not found');
    await expect(recordReferenceTableReplacement(db as unknown as ConnectionManager, 'forestgeo_testing', 'session', 'tx')).rejects.toThrow(
      'could not be recorded'
    );
  });

  it('preserves the existing measurement compatibility behavior', async () => {
    const db = manager();
    db.executeQuery.mockRejectedValue(Object.assign(new Error("Table 'site.upload_sessions' doesn't exist"), { code: 'ER_NO_SUCH_TABLE' }));
    await expect(
      uploadSessionHasCompletedReplacement(db as unknown as ConnectionManager, 'forestgeo_testing', 'session', CENSUS_REPLACEMENT_MARKER_COLUMN, 'tx')
    ).resolves.toBe(false);
    await expect(
      markUploadSessionReplacementCompleted(db as unknown as ConnectionManager, 'forestgeo_testing', 'session', CENSUS_REPLACEMENT_MARKER_COLUMN, 'tx')
    ).resolves.toBeUndefined();
  });
});

const LIVENESS_SCOPE = { schema: 'forestgeo_testing', plotID: 22, censusID: 32, uploadSessionID: 'liveness-session' } as const;
const NO_SUCH_TABLE = Object.assign(new Error("Table 'forestgeo_testing.upload_sessions' doesn't exist"), { code: 'ER_NO_SUCH_TABLE', errno: 1146 });

function recordingManager(answer: () => unknown) {
  const statements: string[] = [];
  const connectionManager = {
    executeQuery: vi.fn(async (sql: string) => {
      statements.push(sql);
      return answer();
    })
  } as unknown as ConnectionManager;
  return { connectionManager, statements };
}

describe('lockActiveUploadSessionForCensus (#561 extraction)', () => {
  it('locks the session row with the #555 statement and returns it', async () => {
    const row = { state: UploadSessionState.UPLOADING, plot_id: 22, census_id: 32, census_replacement_completed_at: null };
    const { connectionManager, statements } = recordingManager(() => [row]);
    const locked = await lockActiveUploadSessionForCensus(connectionManager, LIVENESS_SCOPE, 'tx-1');
    console.log(`[AU11] statement: ${statements[0]}`);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(CENSUS_REPLACEMENT_STATEMENT.SESSION_LOCK);
    expect(statements[0]).toMatch(SESSION_LOCK_CLAUSE);
    expect(locked).toEqual(row);
  });

  it.each([
    ['no upload_sessions table', () => Promise.reject(NO_SUCH_TABLE), /has no upload_sessions table/],
    ['no row', () => [], /was not found/],
    [
      'an inactive session',
      () => [{ state: UploadSessionState.FAILED, plot_id: 22, census_id: 32, census_replacement_completed_at: null }],
      /no longer active/
    ],
    [
      'another census',
      () => [{ state: UploadSessionState.UPLOADING, plot_id: 22, census_id: 99, census_replacement_completed_at: null }],
      /belongs to plot 22 census 99/
    ]
  ])('throws UploadSessionOwnershipError for %s', async (label, answer, message) => {
    const { connectionManager } = recordingManager(answer);
    const attempt = lockActiveUploadSessionForCensus(connectionManager, LIVENESS_SCOPE, 'tx-1');
    await expect(attempt).rejects.toBeInstanceOf(UploadSessionOwnershipError);
    const error = await lockActiveUploadSessionForCensus(connectionManager, LIVENESS_SCOPE, 'tx-1').catch((thrown: unknown) => thrown);
    console.log(`[AU11] ${label}: ${(error as Error).message}`);
    expect((error as Error).message).toMatch(message);
    expect((error as Error).message, 'earlier units may have committed deletes, so a refusal must not claim nothing was deleted').not.toMatch(
      /Nothing was deleted/
    );
    expect((error as Error).message).toMatch(/already committed/);
  });

  it('lockUploadSessionForCensusReplacement still issues the same single statement and reads the marker (regression)', async () => {
    const { connectionManager, statements } = recordingManager(() => [
      { state: UploadSessionState.UPLOADING, plot_id: 22, census_id: 32, census_replacement_completed_at: '2026-10-28 00:00:00' }
    ]);
    const outcome = await lockUploadSessionForCensusReplacement(connectionManager, LIVENESS_SCOPE, 'tx-1');
    console.log(`[AU11] replacement lock outcome=${outcome} statements=${statements.length}`);
    expect(outcome).toBe('marker_already_set');
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(CENSUS_REPLACEMENT_STATEMENT.SESSION_LOCK);
  });
});
