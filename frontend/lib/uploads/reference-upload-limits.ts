// Bytes bound the file buffered in the browser; rows bound the sequential DB work.
// Neither is a promise about server latency. See docs/notes/reference-upload-limits.md.
export const MAX_SINGLE_REQUEST_FILE_SIZE_BYTES = 8 * 1024 * 1024;
export const MAX_SINGLE_REQUEST_FILE_SIZE_MB = 8;
export const MAX_REFERENCE_UPLOAD_ROWS = 10_000;

export function referenceUploadRowLimitError(rowCount: number): string | null {
  if (rowCount <= MAX_REFERENCE_UPLOAD_ROWS) return null;
  return `This file contains ${rowCount.toLocaleString('en-US')} rows; reference uploads allow up to ${MAX_REFERENCE_UPLOAD_ROWS.toLocaleString('en-US')} rows per file. Split it into smaller files and upload them together.`;
}
