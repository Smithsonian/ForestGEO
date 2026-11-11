import { createHash, createHmac } from 'crypto';
import { FileRow } from '@/config/macros/formdetails';
import { IngestionFailureRowInput, toFiniteNumber } from '@/config/measurementerrors';
import { isBlankOrNullPlaceholder } from './matchdiff';

const UPLOAD_ATTEMPT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** HMAC key for computeInvalidRowsIntegrityHash — a plain digest would be forgeable, since every hashed input is client-visible. */
function getIntegrityHashSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error('AUTH_SECRET is not configured — cannot compute invalid-row integrity hash');
  }
  return secret;
}

// Shared fileID tag for both route.ts (match) and apply/route.ts (apply);
// they must agree exactly or the apply route's recomputed hash can never
// match what match returned.
export const REVISION_UPLOAD_FILE_ID = 'revision-upload';

export function isValidUploadAttemptID(value: unknown): value is string {
  return typeof value === 'string' && UPLOAD_ATTEMPT_ID_PATTERN.test(value);
}

function rawStringOrNull(value: unknown): string | null {
  if (isBlankOrNullPlaceholder(value)) return null;
  return String(value).trim();
}

export interface InvalidRowForIntegrity {
  csvRow?: FileRow;
  csvIndex: number;
  reason: string;
}

/**
 * Persisted-field mapping for a rejected row, shared by the apply route's
 * failure-row write and the hash it's checked against. Omits `batchID`:
 * that's derived FROM this hash (deriveRevisionFailureBatchID), so including
 * it here would be circular.
 */
export function buildIngestionFailureRowContent(
  row: InvalidRowForIntegrity,
  plotID: number,
  censusID: number,
  fileID: string
): Omit<IngestionFailureRowInput, 'batchID'> {
  const csvRow = row.csvRow ?? {};
  return {
    plotID,
    censusID,
    tag: rawStringOrNull(csvRow.tag),
    stemTag: rawStringOrNull(csvRow.stemtag),
    spCode: rawStringOrNull(csvRow.spcode),
    quadrat: rawStringOrNull(csvRow.quadrat),
    x: toFiniteNumber(csvRow.lx),
    y: toFiniteNumber(csvRow.ly),
    plotX: toFiniteNumber(csvRow.px),
    plotY: toFiniteNumber(csvRow.py),
    dbh: toFiniteNumber(csvRow.dbh),
    hom: toFiniteNumber(csvRow.hom),
    date: rawStringOrNull(csvRow.date),
    codes: rawStringOrNull(csvRow.codes),
    comments: rawStringOrNull(csvRow.comments),
    failureReason: row.reason,
    fileID,
    sourceRowIndex: row.csvIndex,
    failureKind: 'parser_reject'
  };
}

/**
 * Authenticated HMAC over the complete rejected-row payload plus scope and
 * attempt identity. Apply recomputes this and 409s on mismatch before any
 * write. Sorted by sourceRowIndex so row order doesn't affect the hash.
 */
export function computeInvalidRowsIntegrityHash(
  schema: string,
  plotID: number,
  censusID: number,
  uploadAttemptID: string,
  fileID: string,
  invalidRows: InvalidRowForIntegrity[]
): string {
  const sortedContents = invalidRows
    .map(row => buildIngestionFailureRowContent(row, plotID, censusID, fileID))
    .sort((a, b) => (a.sourceRowIndex ?? 0) - (b.sourceRowIndex ?? 0));
  const payload = JSON.stringify({ schema, plotID, censusID, uploadAttemptID, rows: sortedContents });
  return createHmac('sha256', getIntegrityHashSecret()).update(payload).digest('hex');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isScalarCellValue(value: unknown): boolean {
  return value === null || value === undefined || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

/** Rejects a csvRow with nested object/array cells — a real CSV cell is always a scalar. */
export function isValidInvalidRowCsvRow(value: unknown): value is FileRow {
  return isPlainObject(value) && Object.values(value).every(isScalarCellValue);
}

const REVISION_FAILURE_BATCH_ID_PREFIX = 'rev-';
const REVISION_FAILURE_BATCH_ID_HASH_LENGTH = 32;

/**
 * Per-attempt UploadBatchID (UNIQUE with SourceRowIndex — makes
 * insertIngestionFailureRows idempotent on retry). Keyed on
 * (schema, plotID, censusID, uploadAttemptID) rather than the bulk plan
 * hash, which carries no schema/plot/census and would let two independent
 * uploads collide on the same batch ID.
 */
export function deriveRevisionFailureBatchID(schema: string, plotID: number, censusID: number, uploadAttemptID: string): string {
  const hash = createHash('sha256').update(`${schema}|${plotID}|${censusID}|${uploadAttemptID}`).digest('hex');
  return `${REVISION_FAILURE_BATCH_ID_PREFIX}${hash.slice(0, REVISION_FAILURE_BATCH_ID_HASH_LENGTH)}`;
}
