import { SourceFormat } from '@/config/macros/formdetails';

// One definition for the measurement upload size limit, shared by the upload routes, the
// upload-job validator and the browser upload step. "MB" in user-facing text means MiB, matching
// formatFileSize in config/macros/uploadsystemmacros.ts.
const BYTES_PER_MEBIBYTE = 1024 * 1024;

export const MAX_UPLOAD_FILE_MB = 100;
export const MAX_UPLOAD_FILE_BYTES = MAX_UPLOAD_FILE_MB * BYTES_PER_MEBIBYTE;
// Multipart boundaries, part headers and side fields (fileRowErrors) travel with the file.
export const UPLOAD_REQUEST_BODY_HEADROOM_BYTES = BYTES_PER_MEBIBYTE;
export const MAX_UPLOAD_REQUEST_BODY_BYTES = MAX_UPLOAD_FILE_BYTES + UPLOAD_REQUEST_BODY_HEADROOM_BYTES;
export const MAX_UPLOAD_REQUEST_BODY_MB = MAX_UPLOAD_REQUEST_BODY_BYTES / BYTES_PER_MEBIBYTE;

export const CSV_UPLOAD_RECOVERY_ADVICE = 'Split the file into smaller files and select them together.';
export const ARCGIS_UPLOAD_RECOVERY_ADVICE =
  'ArcGIS import accepts one .xlsx workbook at a time. Export a smaller workbook that preserves the required tree and stem sheets and their relationships, or contact support.';
export const UNKNOWN_FORMAT_UPLOAD_RECOVERY_ADVICE = 'Reduce the request size or contact support.';

export const UPLOAD_LENGTH_REQUIRED_MESSAGE =
  'The upload request did not declare its size. Try selecting the file again; if it keeps failing, contact support.';
export const UPLOAD_UNREADABLE_MESSAGE = 'The upload could not be read. Try selecting the file again; if it keeps failing, contact support.';

function formatMebibytes(byteCount: number): string {
  return `${(byteCount / BYTES_PER_MEBIBYTE).toFixed(2)} MB`;
}

export function uploadRecoveryAdvice(sourceFormat: SourceFormat | null): string {
  if (sourceFormat === SourceFormat.csv) return CSV_UPLOAD_RECOVERY_ADVICE;
  if (sourceFormat === SourceFormat.arcgis_xlsx) return ARCGIS_UPLOAD_RECOVERY_ADVICE;
  return UNKNOWN_FORMAT_UPLOAD_RECOVERY_ADVICE;
}

export function uploadRequestBodyTooLargeMessage(sourceFormat: SourceFormat | null): string {
  return (
    `The upload request exceeds the ${MAX_UPLOAD_REQUEST_BODY_MB} MiB request-body limit, including file data and metadata. ` +
    `The maximum file size is ${MAX_UPLOAD_FILE_MB} MB. ${uploadRecoveryAdvice(sourceFormat)}`
  );
}

export function uploadFileTooLargeMessage(fileByteCount: number, sourceFormat: SourceFormat | null): string {
  return `File is ${formatMebibytes(fileByteCount)}; the maximum file size is ${MAX_UPLOAD_FILE_MB} MB. ${uploadRecoveryAdvice(sourceFormat)}`;
}

export function uploadFileSizeSelectionIssue(fileByteCount: number, sourceFormat: SourceFormat | null): string {
  return `${formatMebibytes(fileByteCount)} exceeds the ${MAX_UPLOAD_FILE_MB} MB upload limit. ${uploadRecoveryAdvice(sourceFormat)}`;
}
