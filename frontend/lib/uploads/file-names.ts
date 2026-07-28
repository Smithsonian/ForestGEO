import path from 'path';

/**
 * Canonical blob-safe form of an uploaded file's name.
 *
 * `/api/files/upload` stores the blob under this name and echoes it back, so it
 * — not the raw browser `File.name` — is the identity every later reference
 * uses: upload-job `files[].fileName`, the payload maps the worker looks up
 * delimiters and column mappings by, and the ArcGIS pre-flight cross-check.
 * Comparing a raw name against a stored one rejects any file whose name
 * contains a space, parenthesis, comma, or accented character.
 */
export function sanitizeUploadFileName(fileName: string): string {
  const baseName = path.basename(fileName);
  return baseName.replace(/[^a-zA-Z0-9._-]/g, '_');
}
