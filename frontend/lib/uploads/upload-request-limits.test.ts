import { describe, expect, it } from 'vitest';
import { SourceFormat } from '@/config/macros/formdetails';
import {
  ARCGIS_UPLOAD_RECOVERY_ADVICE,
  CSV_UPLOAD_RECOVERY_ADVICE,
  MAX_UPLOAD_FILE_BYTES,
  MAX_UPLOAD_FILE_MB,
  MAX_UPLOAD_REQUEST_BODY_BYTES,
  MAX_UPLOAD_REQUEST_BODY_MB,
  UNKNOWN_FORMAT_UPLOAD_RECOVERY_ADVICE,
  UPLOAD_REQUEST_BODY_HEADROOM_BYTES,
  uploadFileSizeSelectionIssue,
  uploadFileTooLargeMessage,
  uploadRecoveryAdvice,
  uploadRequestBodyTooLargeMessage
} from './upload-request-limits';

const BYTES_PER_MEBIBYTE = 1024 * 1024;
const RABI_CENSUS_2_BYTES = 13_085_355;

describe('upload request limits', () => {
  it('defines the per-file limit as 100 MiB and the request ceiling as file limit plus 1 MiB headroom', () => {
    expect(MAX_UPLOAD_FILE_BYTES, `MAX_UPLOAD_FILE_BYTES=${MAX_UPLOAD_FILE_BYTES}`).toBe(100 * BYTES_PER_MEBIBYTE);
    expect(MAX_UPLOAD_FILE_MB).toBe(MAX_UPLOAD_FILE_BYTES / BYTES_PER_MEBIBYTE);
    expect(UPLOAD_REQUEST_BODY_HEADROOM_BYTES).toBe(BYTES_PER_MEBIBYTE);
    expect(
      MAX_UPLOAD_REQUEST_BODY_BYTES,
      `request ceiling ${MAX_UPLOAD_REQUEST_BODY_BYTES} must equal file limit ${MAX_UPLOAD_FILE_BYTES} + headroom ${UPLOAD_REQUEST_BODY_HEADROOM_BYTES}`
    ).toBe(MAX_UPLOAD_FILE_BYTES + UPLOAD_REQUEST_BODY_HEADROOM_BYTES);
    expect(MAX_UPLOAD_REQUEST_BODY_MB).toBe(101);
  });

  it('selects recovery advice by source format and never invents a format', () => {
    expect(uploadRecoveryAdvice(SourceFormat.csv)).toBe(CSV_UPLOAD_RECOVERY_ADVICE);
    expect(uploadRecoveryAdvice(SourceFormat.arcgis_xlsx)).toBe(ARCGIS_UPLOAD_RECOVERY_ADVICE);
    expect(uploadRecoveryAdvice(null)).toBe(UNKNOWN_FORMAT_UPLOAD_RECOVERY_ADVICE);
  });

  it('never tells an ArcGIS uploader to select several workbooks together', () => {
    expect(ARCGIS_UPLOAD_RECOVERY_ADVICE).not.toMatch(/select them together/i);
    expect(ARCGIS_UPLOAD_RECOVERY_ADVICE).toMatch(/one \.xlsx workbook at a time/);
    expect(UNKNOWN_FORMAT_UPLOAD_RECOVERY_ADVICE).not.toMatch(/select them together/i);
  });

  it('describes a request-body rejection as a request limit that includes metadata, not as a file size', () => {
    const message = uploadRequestBodyTooLargeMessage(SourceFormat.csv);
    expect(message).toContain(`${MAX_UPLOAD_REQUEST_BODY_MB} MiB request-body limit`);
    expect(message).toContain('including file data and metadata');
    expect(message).toContain(`maximum file size is ${MAX_UPLOAD_FILE_MB} MB`);
    expect(message).not.toMatch(/^File is/);
    expect(message.endsWith(CSV_UPLOAD_RECOVERY_ADVICE), message).toBe(true);
  });

  it('reports the parsed file size in the per-file message using binary megabytes', () => {
    const message = uploadFileTooLargeMessage(MAX_UPLOAD_FILE_BYTES + 5 * BYTES_PER_MEBIBYTE, SourceFormat.arcgis_xlsx);
    expect(message, message).toBe(`File is 105.00 MB; the maximum file size is 100 MB. ${ARCGIS_UPLOAD_RECOVERY_ADVICE}`);
  });

  it('formats the browser selection issue with the file size and format advice', () => {
    const issue = uploadFileSizeSelectionIssue(RABI_CENSUS_2_BYTES * 10, SourceFormat.csv);
    expect(issue, issue).toBe(`124.79 MB exceeds the 100 MB upload limit. ${CSV_UPLOAD_RECOVERY_ADVICE}`);
  });
});
