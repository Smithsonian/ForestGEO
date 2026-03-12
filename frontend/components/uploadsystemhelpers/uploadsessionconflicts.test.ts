import { describe, expect, it } from 'vitest';
import {
  buildUploadSessionRestartRequiredError,
  getApiErrorMessage,
  parseUploadSessionConflict
} from './uploadsessionconflicts';

describe('upload session conflict helpers', () => {
  it('detects restart-required conflicts for cleaned_up sessions', () => {
    const conflict = parseUploadSessionConflict({
      responseMessage: 'Upload session conflict',
      error: 'Upload session upload_abc is in state cleaned_up, not one of: initialized, uploading'
    });

    expect(conflict).toEqual({
      message: 'Upload session upload_abc is in state cleaned_up, not one of: initialized, uploading',
      reason: 'invalid_state',
      sessionState: 'cleaned_up',
      restartRequired: true
    });
  });

  it('detects restart-required conflicts for expired sessions without an explicit state', () => {
    const conflict = parseUploadSessionConflict({
      responseMessage: 'Upload session conflict',
      error: 'Upload session upload_abc expired before measurement chunk upload for census.csv-batch-1'
    });

    expect(conflict?.reason).toBe('stale_session');
    expect(conflict?.restartRequired).toBe(true);
    expect(conflict?.sessionState).toBeNull();
  });

  it('ignores non-upload-session client errors', () => {
    expect(
      parseUploadSessionConflict({
        responseMessage: 'Measurement upload context mismatch',
        error: 'Existing batch scope does not match incoming plot/census'
      })
    ).toBeNull();
  });

  it('builds a clear restart message for terminal session conflicts', () => {
    const error = buildUploadSessionRestartRequiredError('uploading census.csv', {
      responseMessage: 'Upload session conflict',
      error: 'Upload session upload_abc is in state abandoned, not one of: initialized, uploading'
    });

    expect(error.name).toBe('UploadSessionRestartRequiredError');
    expect(error.message).toContain("'abandoned'");
    expect(error.message).toContain('Restart the upload');
  });

  it('extracts a usable API error message from structured payloads', () => {
    expect(
      getApiErrorMessage({
        responseMessage: 'Upload session conflict',
        error: 'Upload session upload_abc was not found'
      })
    ).toBe('Upload session upload_abc was not found');
  });
});
