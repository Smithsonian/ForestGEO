import { describe, expect, it, vi } from 'vitest';
import type ConnectionManager from '@/lib/db/connectionmanager';
import { UploadMode } from '@/config/uploadmodes';
import {
  claimReferenceTableReplacement,
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
