import path from 'path';

/**
 * Maximum canonical filename carried through the measurement-ingestion FileID
 * chain. Keep this synchronized with temporarymeasurements.FileID,
 * bulkingestionprocess.vFileID, uploadmetrics.fileID, and
 * uploadintegrityalerts.fileID.
 */
export const MAX_MEASUREMENT_FILE_ID_LENGTH = 50;

/** MySQL VARCHAR length is measured in characters, not UTF-16 code units. */
export function measurementFileIDLength(fileName: string): number {
  return Array.from(fileName).length;
}

export function measurementFileIDValidationError(fileName: string): string | null {
  const length = measurementFileIDLength(fileName);
  return length <= MAX_MEASUREMENT_FILE_ID_LENGTH
    ? null
    : `Measurement file names must be ${MAX_MEASUREMENT_FILE_ID_LENGTH} characters or fewer (received ${length}).`;
}

/**
 * Canonical blob-safe form of an uploaded file's name.
 *
 * `/api/files/upload` stores the blob under this name and echoes it back, so it
 * — not the raw browser `File.name` — is the identity every later reference
 * uses: upload-job `files[].fileName`, the payload maps the worker looks up
 * delimiters and column mappings by, and the ArcGIS pre-flight cross-check.
 * Comparing a raw name against a stored one rejects any file whose name
 * contains a space, parenthesis, comma, or accented character.
 *
 * Unicode is normalized to NFC FIRST. macOS hands filenames to the browser in
 * NFD (decomposed), so `café.csv` picked on a Mac and the same name typed
 * elsewhere are different byte sequences that sanitize to different canonical
 * names — one becoming `cafe_.csv`. Normalizing first makes the two agree, and
 * it is a no-op for already-composed and pure-ASCII names.
 */
export function sanitizeUploadFileName(fileName: string): string {
  const baseName = path.basename(fileName.normalize('NFC'));
  return baseName.replace(/[^a-zA-Z0-9._-]/g, '_');
}

/** Two or more selected files whose canonical names are the same. */
export interface UploadFileNameCollision {
  /** The canonical name they all reduce to. */
  canonicalName: string;
  /** The original names as the user selected them, in selection order. */
  originalNames: string[];
}

/**
 * Finds selected file names that canonicalize to the same identity.
 *
 * Sanitizing is lossy — `a b.csv` and `a_b.csv` both become `a_b.csv` — and the
 * canonical name is the job's file identity. Detected LATE, this shows up as a
 * duplicate-file-name rejection at job creation, after both files have already
 * been uploaded to storage; detected here, before any upload, the user can be
 * told which two of their files clash and rename one.
 *
 * Comparison is case-insensitive because the duplicate check at job creation is
 * too, and Azure blob names are case-sensitive — so two names differing only in
 * case would upload to two distinct blobs and still be rejected as one job file.
 */
export function findUploadFileNameCollisions(fileNames: readonly string[]): UploadFileNameCollision[] {
  const byCanonicalName = new Map<string, { canonicalName: string; originalNames: string[] }>();

  for (const fileName of fileNames) {
    const canonicalName = sanitizeUploadFileName(fileName);
    const key = canonicalName.toLowerCase();
    const existing = byCanonicalName.get(key);
    if (existing) existing.originalNames.push(fileName);
    else byCanonicalName.set(key, { canonicalName, originalNames: [fileName] });
  }

  return [...byCanonicalName.values()].filter(entry => entry.originalNames.length > 1);
}

/** Human-readable explanation naming every clashing original, for the user to act on. */
export function describeUploadFileNameCollisions(collisions: readonly UploadFileNameCollision[]): string {
  return collisions
    .map(collision => `${collision.originalNames.map(name => `"${name}"`).join(' and ')} are both stored as "${collision.canonicalName}"`)
    .join('; ');
}

/**
 * Blob path for one file of one upload attempt.
 *
 * Attempt-scoped so two attempts can never contend for the same blob name.
 * Without it, allocation was "probe with exists(), then uploadData() to whatever
 * name looked free" — a TOCTOU race in which two concurrent attempts both see a
 * name available and both write it, and either attempt's cleanup then deletes a
 * blob the other is relying on.
 */
export function attemptScopedBlobName(attemptID: string, canonicalFileName: string): string {
  return `${attemptID}/${canonicalFileName}`;
}

/**
 * An upload attempt id is generated client-side and reaches storage as blob
 * metadata, so it is constrained to what is safe in a blob path and in an Azure
 * metadata value: ASCII alphanumerics, dash, and underscore.
 */
const ATTEMPT_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export function isValidUploadAttemptID(attemptID: string): boolean {
  return ATTEMPT_ID_PATTERN.test(attemptID);
}

/**
 * `unifiedchangelog.RecordID` for a `file_upload` row (issue #507).
 *
 * Two independent upload attempts for the same (fileName, census) must never
 * be merged into one changelog row — accumulating one attempt's rowCount into
 * an unrelated attempt's metadata is wrong regardless of how the merge
 * happens. The identity therefore includes the attempt, not just the
 * filename: `${fileName}::${attemptIdentity}`. Retries of the SAME attempt
 * (same uploadSessionID, or the same batch family when there is no session)
 * still accumulate into their own row as later batches/chunks land — this
 * changes WHICH row a write targets, not whether same-attempt writes merge.
 *
 * `attemptIdentity` should be the caller's `uploadSessionID` when one exists
 * (the synchronous upload route, the background worker, and ArcGIS commits
 * all have one). When it is null (a live case — see
 * upload-pipeline-equivalence.test.ts), the caller's batch id is the
 * fallback: distinct ingestion attempts for the same file still get distinct
 * batch ids, so this still separates them.
 *
 * Truncated to 255 chars: `unifiedchangelog.RecordID` is VARCHAR(255). Older
 * rows written before this fix used plain `fileName` as RecordID; those rows
 * are untouched and readers must still tolerate them (see
 * tests/integration/file-upload-attempt-identity.integration.test.ts).
 */
export const FILE_UPLOAD_RECORD_ID_SEPARATOR = '::';
export const FILE_UPLOAD_RECORD_ID_MAX_LENGTH = 255;

export function buildFileUploadChangelogRecordID(fileName: string, attemptIdentity: string): string {
  return `${fileName}${FILE_UPLOAD_RECORD_ID_SEPARATOR}${attemptIdentity}`.slice(0, FILE_UPLOAD_RECORD_ID_MAX_LENGTH);
}

/** One chunk's contribution to a `file_upload` changelog row's running totals (#507). */
export interface FileUploadChunkSummary {
  rowCount: number;
  droppedCount: number;
}

/**
 * Merges one chunk's counts into a `file_upload` changelog row's metadata,
 * keyed by `chunkIdentity` (#507) — NOT by `batchID`: the worker stages every
 * chunk of one file under the SAME batchID (one chunkIndex per chunk), so
 * keying by batchID collapsed every chunk but the last. `chunkIdentity` must
 * be stable across a retry of the SAME chunk (REPLACES, no double-count) and
 * distinct per genuinely different chunk (ADDS). Attempt separation comes
 * from buildFileUploadChangelogRecordID's RecordID, not from this.
 *
 * Mutates `metadata` in place and returns it for convenience.
 */
export function mergeFileUploadChunkIntoMetadata<T extends Record<string, unknown>>(metadata: T, chunkIdentity: string, chunk: FileUploadChunkSummary): T {
  const existingChunks = metadata.chunksByIdentity;
  const chunksByIdentity: Record<string, FileUploadChunkSummary> =
    existingChunks && typeof existingChunks === 'object' ? { ...(existingChunks as Record<string, FileUploadChunkSummary>) } : {};

  chunksByIdentity[chunkIdentity] = chunk;

  let rowCount = 0;
  let droppedCount = 0;
  for (const summary of Object.values(chunksByIdentity)) {
    rowCount += summary.rowCount;
    droppedCount += summary.droppedCount;
  }

  Object.assign(metadata, {
    chunksByIdentity,
    rowCount,
    droppedCount,
    batchCount: Object.keys(chunksByIdentity).length
  });

  return metadata;
}
