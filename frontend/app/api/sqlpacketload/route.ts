import ConnectionManager from '@/lib/db/connectionmanager';
import { HTTPResponses, InsertUpdateProcessingProps } from '@/config/macros';
import { FileRow, FileRowSet, FormType, normalizeSourceFormat, RequiredTableHeadersByFormType, SourceFormat } from '@/config/macros/formdetails';
import { NextRequest, NextResponse } from 'next/server';
import { Plot } from '@/lib/db/definitions/zones';
import { OrgCensus } from '@/lib/db/definitions/timekeeping';
import { insertOrUpdate } from '@/components/processors/processorhelperfunctions';
import moment from 'moment/moment';
import { generateShortBatchID, handleUpsert } from '@/config/utils';
import { getCookie } from '@/app/actions/cookiemanager';
import ailogger from '@/ailogger';
import { auth } from '@/auth';
import { format } from 'mysql2/promise';
import { isValidSchema, safeFormatQuery } from '@/lib/db/sqlsecurity';
import crypto from 'crypto';
import { insertIngestionFailureRows } from '@/config/measurementerrors';
import { requireUploadSessionOwnership, UploadSessionOwnershipError, UploadSessionState as TrackedUploadSessionState } from '@/config/uploadsessiontracker';
import { normalizeUploadMode, UploadMode } from '@/config/uploadmodes';
import { buildDivergentQuadratUploadError, quadratRevisionAppendsDivergentSet } from '@/lib/ingestion/quadrat-upload-guards';
import {
  acknowledgmentCoversLayout,
  QUADRAT_OVERLAP_ACKNOWLEDGMENT_STATEMENT,
  summarizeQuadratOverlaps,
  toQuadratGeometry,
  validateQuadratCollectionDetailed,
  type QuadratCollectionIssue,
  type QuadratOverlapSummary
} from '@/lib/provisioning/quadrat-collection-validation';
import {
  DEFAULT_REFERENCE_CORNER,
  isQuadratReferenceCorner,
  normalizeToSouthwest,
  type QuadratReferenceCorner
} from '@/lib/provisioning/coordinate-reference-corner';
import type { QuadratCsvRow } from '@/lib/provisioning/types';
import { MAX_GENERATED_QUADRATS } from '@/lib/provisioning/grid-generator';
import { FamilyResult, GenusResult } from '@/lib/db/definitions/taxonomies';
import { RoleResult } from '@/lib/db/definitions/personnel';
import { requireSession } from '@/lib/auth-helpers';
import { assertSchemaAccess } from '@/lib/authz';
import { isColumnMappingShape } from '@/lib/column-mapping/mapping';
import { resolveMeasurementChunk } from '@/lib/column-mapping/measurement-rows';
import {
  buildDroppedMeasurementFailureReason,
  cleanupPreviousFileUploads,
  cleanupStaleMeasurementBatchesForFile,
  ensureTemporaryMeasurementsSourceFormatColumn,
  findDroppedMeasurementCandidates,
  insertTemporaryMeasurementsInBatches,
  isUnsignedIntFieldInvalid,
  type DroppedMeasurementRow
} from '@/lib/ingestion/temporary-measurements';

/**
 * Generate idempotency key for a batch of data
 * This allows us to detect and skip duplicate submissions
 * IMPORTANT: Uses content hash to differentiate chunks from the same file
 */
function generateIdempotencyKey(fileName: string, plotId: number, censusId: number, rowCount: number, contentHash: string): string {
  return `${fileName}_${plotId}_${censusId}_${rowCount}_${contentHash}`;
}

/**
 * Generate a hash of the chunk content for idempotency checking
 * CRITICAL: Hashes ALL rows in the chunk to uniquely identify this specific chunk
 * This prevents false duplicate detection when different chunks have the same row count
 *
 * Uses full SHA-256 hash (64 chars) instead of truncated MD5 for:
 * - Stronger collision resistance
 * - Better uniqueness guarantees for large datasets
 */
function hashChunkContent(fileRowSet: FileRowSet): string {
  const rows = Object.values(fileRowSet);
  if (rows.length === 0) return 'empty';
  // Sort rows by a consistent key to ensure same data produces same hash regardless of order
  const sortedRows = rows.map(row => JSON.stringify(row)).sort();
  const data = sortedRows.join('|');
  // Use full SHA-256 hash for better collision resistance
  return crypto.createHash('sha256').update(data).digest('hex');
}

function buildUploadId(schema: string, plotID: number, censusID: number, fileID: string, batchID: string, purpose: string = 'upload'): string {
  return crypto.createHash('sha256').update([schema, plotID, censusID, fileID, batchID, purpose].join('#')).digest('hex').slice(0, 40);
}

function toNullableNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * `FileRow` is documented as `Record<string, string | null>`, but the request body is raw
 * `JSON.parse` output that TypeScript cannot actually enforce -- a non-browser caller may send
 * a JSON number instead of a string (e.g. `startx: 0`). Stringify defensively so a well-formed
 * numeric value is parsed correctly by `toQuadratGeometry` instead of throwing a raw TypeError
 * that would surface as an infrastructure failure rather than the intended geometry validation.
 */
function coerceGeometryField(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return String(value);
}

function toPositiveInteger(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function buildMeasurementScopeErrorResponse(status: HTTPResponses, message: string, details: Record<string, unknown>): NextResponse {
  return new NextResponse(
    JSON.stringify({
      responseMessage: 'Measurement upload context mismatch',
      error: message,
      details
    }),
    { status }
  );
}

interface FixedDataProcessingResult {
  insertedCount: number;
  updatedCount: number;
  skippedCount: number;
  // Quadrat uploads only: bounded overlap reports plus complete layout signatures explicitly
  // acknowledged as field measurements and recorded in the file changelog.
  acknowledgedOverlapSummaries?: QuadratOverlapSummary[];
}

function normalizeOptionalString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized === '' ? null : normalized;
}

function authenticatedSessionIdentity(sessionUser: unknown): string {
  if (!sessionUser || typeof sessionUser !== 'object' || Array.isArray(sessionUser)) return 'authenticated-user';
  const record = sessionUser as Record<string, unknown>;
  for (const key of ['email', 'name', 'id']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return 'authenticated-user';
}

function normalizeRequiredString(value: unknown): string {
  return String(value ?? '').trim();
}

function findDuplicateSpeciesCodes(rows: FileRow[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const row of rows) {
    const speciesCode = normalizeOptionalString(row.spcode)?.toLowerCase();
    if (!speciesCode) continue;
    if (seen.has(speciesCode)) {
      duplicates.add(speciesCode);
      continue;
    }
    seen.add(speciesCode);
  }

  return Array.from(duplicates).sort();
}

/** Shared cap for every user-facing list of blocked values / validation issues below, so a
 *  single bad file (hundreds of blocked names, hundreds of failed rows) cannot produce an
 *  unbounded run-on error message. */
const MAX_LISTED_ISSUES = 20;

/** Joins `items` with `separator`, truncating at `maxItems` and appending an "...and N more"
 *  tail instead of listing everything. Shared by every truncated-list message in this file so
 *  there is one truncation style, not one per caller. */
function truncateAndJoin(items: string[], separator: string, maxItems: number = MAX_LISTED_ISSUES): string {
  const truncatedItems = items.slice(0, maxItems);
  const remainingCount = items.length - truncatedItems.length;
  return truncatedItems.join(separator) + (remainingCount > 0 ? `${separator}...and ${remainingCount} more` : '');
}

function formatBlockedCleanReuploadValues(values: string[], maxValues: number = MAX_LISTED_ISSUES): string {
  const uniqueValues = Array.from(new Set(values.map(value => String(value ?? '').trim()).filter(Boolean))).sort((left, right) => left.localeCompare(right));
  return truncateAndJoin(uniqueValues, ', ', maxValues);
}

/**
 * Thrown when a quadrat upload's declared geometry is unusable (missing/blank/non-numeric
 * coordinates, an unsupported reference corner, or a layout that is out of the plot's bounds).
 * The route treats this as a client error (400), never as a
 * retryable infrastructure failure -- see the fixed-data catch block.
 */
class QuadratGeometryValidationError extends Error {}

/**
 * Overlapping quadrat footprints are field reality (surveyed widths can exceed the grid
 * pitch), not necessarily data errors — so unlike QuadratGeometryValidationError they are
 * not an outright refusal. The upload proceeds only when the request carries an explicit
 * acknowledgment that the overlaps reflect field measurements; without it, this error tells
 * the uploader exactly which pairs overlap and how to proceed.
 */
class QuadratOverlapAcknowledgmentRequiredError extends Error {
  constructor(
    message: string,
    readonly overlapSummary: QuadratOverlapSummary
  ) {
    super(message);
    this.name = 'QuadratOverlapAcknowledgmentRequiredError';
  }
}
const QUADRAT_OVERLAP_ACKNOWLEDGMENT_REQUIRED_CODE = 'QUADRAT_OVERLAPS_REQUIRE_ACKNOWLEDGMENT';

/** Stored quadrat rows are always canonical south-west, regardless of what the upload declared. */
const CANONICAL_SOUTHWEST_CORNER: QuadratReferenceCorner = 'SW';

function parseReferenceCorner(value: unknown): QuadratReferenceCorner {
  if (value === undefined || value === null) return DEFAULT_REFERENCE_CORNER;
  if (!isQuadratReferenceCorner(value)) {
    throw new QuadratGeometryValidationError('coordinateReferenceCorner must be SW, SE, NW, or NE');
  }
  return value;
}

function isSupportedUploadMode(value: unknown): value is UploadMode {
  return value === UploadMode.CLEAN_REUPLOAD || value === UploadMode.REVISIONS;
}

function formatQuadratGeometryMessages(messages: string[]): string {
  return `Quadrat geometry validation failed: ${truncateAndJoin(messages, ' ')}`;
}

function formatQuadratGeometryIssues(issues: QuadratCollectionIssue[]): string {
  return formatQuadratGeometryMessages(issues.map(issue => issue.message));
}

async function rollbackPreservingOriginalError(connectionManager: ConnectionManager, transactionID: string, context: Record<string, unknown>): Promise<void> {
  try {
    await connectionManager.rollbackTransaction(transactionID);
  } catch (rollbackError: unknown) {
    const error = rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError));
    ailogger.error(`Failed to roll back transaction ${transactionID}; preserving the original upload error`, error, context);
  }
}

function isRetryableUploadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const candidate = error as Error & { code?: string };
  return (
    candidate.message.includes('Lock wait timeout') ||
    candidate.message.includes('Deadlock') ||
    candidate.message.includes('Connection lost') ||
    candidate.message.includes('server has gone away') ||
    candidate.code === 'PROTOCOL_CONNECTION_LOST' ||
    candidate.code === 'ECONNRESET'
  );
}

function getUploadRetryDelayMs(attemptNumber: number): number {
  return Math.min(1000 * Math.pow(2, attemptNumber - 1), 10000);
}

async function upsertAttributeRows(
  connectionManager: ConnectionManager,
  schema: string,
  rows: FileRow[],
  uploadMode: UploadMode,
  transactionID: string
): Promise<FixedDataProcessingResult> {
  let insertedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;

  if (uploadMode === UploadMode.CLEAN_REUPLOAD) {
    const deleteSQL = format(`DELETE FROM ??.attributes WHERE IsActive = 1`, [schema]);
    await connectionManager.executeQuery(deleteSQL, [], transactionID);
  }

  for (const row of rows) {
    const code = normalizeRequiredString(row.code || row.codes);
    if (!code) {
      skippedCount += 1;
      continue;
    }

    const description = normalizeOptionalString(row.description || row.comments);
    const status = normalizeOptionalString(row.status);

    if (uploadMode === UploadMode.REVISIONS) {
      const existingSQL = format(`SELECT Code FROM ??.attributes WHERE LOWER(Code) = LOWER(?) AND IsActive = 1 LIMIT 1`, [schema]);
      const existingRows = await connectionManager.executeQuery(existingSQL, [code], transactionID);

      if (existingRows.length > 0) {
        const existingCode = existingRows[0].Code;
        const updateSQL = format(`UPDATE ??.attributes SET Code = ?, Description = ?, Status = ?, DeletedAt = NULL WHERE Code = ? AND IsActive = 1`, [schema]);
        await connectionManager.executeQuery(updateSQL, [code, description, status, existingCode], transactionID);
        updatedCount += 1;
        continue;
      }
    }

    const insertSQL = format(`INSERT INTO ??.attributes (Code, Description, Status, IsActive, DeletedAt) VALUES (?, ?, ?, 1, NULL)`, [schema]);
    await connectionManager.executeQuery(insertSQL, [code, description, status], transactionID);
    insertedCount += 1;
  }

  return { insertedCount, updatedCount, skippedCount };
}

async function upsertQuadratRows(
  connectionManager: ConnectionManager,
  schema: string,
  plotID: number | undefined,
  rows: FileRow[],
  uploadMode: UploadMode,
  referenceCorner: QuadratReferenceCorner,
  overlapAcknowledgment: unknown,
  transactionID: string
): Promise<FixedDataProcessingResult> {
  if (!plotID) {
    throw new Error('PlotID is required for quadrat uploads');
  }
  if (rows.length === 0) {
    throw new QuadratGeometryValidationError('Quadrat upload must contain at least one row.');
  }
  if (rows.length > MAX_GENERATED_QUADRATS) {
    throw new QuadratGeometryValidationError(`Quadrat upload contains ${rows.length} rows; maximum allowed per request is ${MAX_GENERATED_QUADRATS}.`);
  }

  let insertedCount = 0;
  let updatedCount = 0;
  // Only entirely-empty rows (no name AND no geometry values -- e.g. trailing padding lines
  // in a hand-edited CSV) are skipped, and they are counted so the response accounts for
  // every input row. A row carrying ANY data that cannot be interpreted throws instead of
  // being silently dropped or inserted with raw, unparsed values.
  let skippedCount = 0;

  // Trust boundary: authoritative plot bounds come from the database row selected by
  // plotID. Client-supplied plot dimensions in the request body are never consulted here,
  // so they cannot widen what a quadrat is allowed to occupy.
  const plotBoundsSQL = safeFormatQuery(schema, `SELECT DimensionX, DimensionY FROM ??.plots WHERE PlotID = ? LIMIT 1`);
  const plotBoundsResult = await connectionManager.executeQuery(plotBoundsSQL, [plotID], transactionID);
  const plotBoundsRow = Array.isArray(plotBoundsResult) ? plotBoundsResult[0] : undefined;
  const plotDimensionX = toNullableNumber(plotBoundsRow?.DimensionX);
  const plotDimensionY = toNullableNumber(plotBoundsRow?.DimensionY);

  // Plots recorded without usable dimensions (nullable columns, and rows written before this
  // boundary existed) must not lock their sites out of quadrat management: degrade to bounds-less
  // validation instead of rejecting. Overlap, duplicate-name, and non-positive-dimension checks
  // still run in full; only the plot-edge checks are skipped, and the gap is logged.
  const plotBoundsUsable = !!plotBoundsRow && plotDimensionX !== null && plotDimensionY !== null && plotDimensionX > 0 && plotDimensionY > 0;
  const plotBounds = plotBoundsUsable ? { dimensionX: plotDimensionX, dimensionY: plotDimensionY } : null;
  if (!plotBounds) {
    ailogger.warn(
      `Plot ${plotID} has no valid DimensionX/DimensionY on record; quadrat plot-bounds checks are skipped for this upload. ` +
        `Overlap and duplicate-name validation still applies. Record the plot dimensions to restore full validation.`
    );
  }

  // Convert every incoming row to canonical geometry up front. A row that cannot be
  // interpreted is a hard error: it is never filtered out and never inserted using its
  // raw, unparsed values -- that is how rows go missing without anyone noticing.
  //
  // Every row is checked, not just the first bad one: a file with a systemic problem
  // (wrong delimiter, a shifted column mapping, a whole blank column) can have hundreds
  // of unusable rows, and reporting only row 1 forces a guess-and-check loop where the
  // user re-uploads once per bad row. Collect every failure and throw once, capped by
  // truncateAndJoin the same way the geometry-issue and blocked-value messages already are.
  const rowConversionFailures: string[] = [];
  const incomingGeometry: QuadratCsvRow[] = [];
  rows.forEach((row, index) => {
    const quadratName = normalizeRequiredString(row.quadrat);
    if (!quadratName) {
      const hasGeometryValues = [row.startx, row.starty, row.dimx, row.dimy].some(value => normalizeRequiredString(value) !== '');
      if (!hasGeometryValues) {
        skippedCount += 1;
        return;
      }
      rowConversionFailures.push(`Quadrat upload row ${index + 1} has a missing or blank QuadratName.`);
      return;
    }

    const geometry = toQuadratGeometry({
      quadrat: quadratName,
      startx: coerceGeometryField(row.startx),
      starty: coerceGeometryField(row.starty),
      dimx: coerceGeometryField(row.dimx),
      dimy: coerceGeometryField(row.dimy)
    });
    if (!geometry) {
      rowConversionFailures.push(
        `Quadrat upload row ${index + 1} (QuadratName "${quadratName}") has missing, blank, or non-numeric ` +
          `geometry (startx/starty/dimx/dimy). Fix the file and re-upload.`
      );
      return;
    }
    incomingGeometry.push(geometry);
  });

  if (rowConversionFailures.length > 0) {
    throw new QuadratGeometryValidationError(`Quadrat upload has unusable rows: ${truncateAndJoin(rowConversionFailures, ' ')}`);
  }
  // A request that was all padding rows must not fall through: in CLEAN_REUPLOAD it would
  // validate an empty layout and then wipe the plot's quadrats without inserting anything.
  if (incomingGeometry.length === 0) {
    throw new QuadratGeometryValidationError(`Quadrat upload contains no usable rows (${skippedCount} blank row(s) skipped).`);
  }

  const normalizedIncoming = incomingGeometry.map(row => normalizeToSouthwest(row, referenceCorner));

  // Overlap policy: overlapping footprints can be genuine field measurements, so 'overlap'
  // issues never reject outright — they require the request's explicit acknowledgment, and
  // acknowledged pairs are returned so the caller can record them for provenance. Every
  // other issue kind (missing/bad geometry, duplicate names, out of bounds) stays fatal.
  const acknowledgedOverlapSummaries: QuadratOverlapSummary[] = [];
  const requireOverlapAcknowledgment = (overlapSummary: QuadratOverlapSummary | null) => {
    if (!overlapSummary) return;
    if (!acknowledgmentCoversLayout(overlapAcknowledgment, overlapSummary.layoutSignature)) {
      const pairMessages = overlapSummary.pairs.map(pair => pair.message);
      const truncationNotice = overlapSummary.truncated
        ? ` At least ${overlapSummary.minimumPairCount} pairs overlap; the response includes a ${overlapSummary.reportedPairCount}-pair sample.`
        : '';
      throw new QuadratOverlapAcknowledgmentRequiredError(
        `Quadrat footprints overlap: ${truncateAndJoin(pairMessages, ' ')}${truncationNotice} ` +
          `If these overlaps reflect field measurements, review and confirm the overlap acknowledgment, then re-submit.`,
        overlapSummary
      );
    }
    acknowledgedOverlapSummaries.push(overlapSummary);
  };

  if (uploadMode === UploadMode.CLEAN_REUPLOAD) {
    // Validate the incoming layout BEFORE the stem-safety check and before deleting anything.
    // Rows are already normalized to canonical south-west above, so pass CANONICAL_SOUTHWEST_CORNER
    // here (matching the REVISIONS branch below) rather than re-declaring referenceCorner and
    // making validateQuadratCollection normalize the same rows a second time internally.
    const cleanValidation = validateQuadratCollectionDetailed(normalizedIncoming, plotBounds, CANONICAL_SOUTHWEST_CORNER);
    const cleanReuploadIssues = cleanValidation.issues;
    const cleanFatalIssues = cleanReuploadIssues.filter(issue => issue.kind !== 'overlap');
    if (cleanFatalIssues.length > 0) {
      throw new QuadratGeometryValidationError(formatQuadratGeometryIssues(cleanFatalIssues));
    }
    requireOverlapAcknowledgment(cleanValidation.overlapSummary);

    // CLEAN_REUPLOAD deletes every active quadrat in the plot before re-inserting
    // the upload contents. Because stems references quadrats via ON DELETE CASCADE,
    // removing a quadrat that is already in use would also destroy its stems and
    // any downstream measurements, even if the same QuadratName appears again in
    // the upload. Only allow this path when the plot has no stems attached to any
    // active quadrat rows yet.
    // safeFormatQuery fills BOTH ?? with the schema; mysql2 format() with
    // [schema, schema] would put the second schema into `q.PlotID = ?` and
    // leave the second ?? to be misfilled by plotID at execute time.
    // Only stems with IsActive = 1 block the wipe: soft-deleted stems were
    // already discarded by the user, so cascade-removing their tombstone rows
    // is part of the intended reset, not a loss of live census data.
    const blockingQuadratSQL = safeFormatQuery(
      schema,
      `SELECT q.QuadratID, q.QuadratName
       FROM ??.quadrats q
       WHERE q.PlotID = ?
         AND q.IsActive = 1
         AND EXISTS (
           SELECT 1
           FROM ??.stems s
           WHERE s.QuadratID = q.QuadratID
             AND s.IsActive = 1
         )
       ORDER BY q.QuadratName`
    );
    const blockingQuadratRows = await connectionManager.executeQuery(blockingQuadratSQL, [plotID], transactionID);
    const blockingQuadrats = Array.isArray(blockingQuadratRows) ? blockingQuadratRows : [];

    // The refusal must key off the presence of blocking rows, not the name list:
    // a quadrat whose name is NULL or whitespace-only still cascades its stems
    // away on DELETE, so it must block even though it has no displayable name.
    const blockingQuadratNames = blockingQuadrats.map((row: any) => {
      const quadratName = String(row.QuadratName ?? '').trim();
      return quadratName || `(unnamed QuadratID ${row.QuadratID})`;
    });

    if (blockingQuadrats.length > 0) {
      throw new Error(
        `Clean re-upload refused: active quadrat rows in plot ${plotID} are already referenced ` +
          `by stems for the following QuadratName value(s): ${formatBlockedCleanReuploadValues(blockingQuadratNames)}. ` +
          `Deleting quadrats would cascade-delete stems and downstream measurements even if the same names appear in the upload. ` +
          `Use Revisions Upload instead.`
      );
    }

    const deleteSQL = safeFormatQuery(schema, `DELETE FROM ??.quadrats WHERE PlotID = ? AND IsActive = 1`);
    await connectionManager.executeQuery(deleteSQL, [plotID], transactionID);
  }

  if (uploadMode === UploadMode.REVISIONS) {
    // A Revisions upload updates by QuadratName and appends every non-matching row, so the
    // set that must be geometrically valid is the PROSPECTIVE FINAL LAYOUT: every existing
    // active quadrat NOT named by this upload, plus every incoming row exactly as declared
    // (duplicates included, so a duplicate incoming name still surfaces as a validation
    // issue instead of being silently deduplicated before this check runs). NULL-named
    // rows are deliberately included: an unnamed quadrat still occupies plot area, so it
    // must participate in the overlap check even though no upload row can ever replace it.
    const existingQuadratsSQL = safeFormatQuery(
      schema,
      `SELECT QuadratID, QuadratName, StartX, StartY, DimensionX, DimensionY FROM ??.quadrats WHERE PlotID = ? AND IsActive = 1`
    );
    const existingQuadratRows = await connectionManager.executeQuery(existingQuadratsSQL, [plotID], transactionID);
    const existingQuadratList: any[] = Array.isArray(existingQuadratRows) ? existingQuadratRows : [];

    // Divergent-placeholder guard runs FIRST: it needs only names, and its guidance message
    // ("this plot still holds the provisioning placeholder grid, here is how to proceed") is
    // strictly more actionable than the raw pairwise-overlap errors the geometry check would
    // produce for the same replacement-grid upload. Running it after geometry validation made
    // it unreachable in exactly its primary scenario, since a replacement grid always overlaps
    // the placeholder grid it replaces.
    const existingActiveNames = existingQuadratList.map(row => String(row.QuadratName ?? ''));
    const incomingNames = rows.map(row => normalizeRequiredString(row.quadrat)).filter(Boolean);
    if (quadratRevisionAppendsDivergentSet(existingActiveNames, incomingNames)) {
      throw new Error(buildDivergentQuadratUploadError(plotID, existingActiveNames, incomingNames.length));
    }

    const incomingNamesLower = new Set(normalizedIncoming.map(row => row.quadratName.toLowerCase()));

    // Build the carry-over set. Rows named by the upload are being replaced, so their stored
    // geometry is irrelevant (and must not be parsed: rejecting a revision because the very
    // row it repairs has malformed stored geometry would make that row permanently unfixable).
    // A carry-over row whose stored geometry cannot be parsed -- legacy rows written before
    // this boundary enforced geometry -- cannot participate in geometry math, so it is
    // excluded from the prospective layout with a logged warning rather than rejecting the
    // upload outright, which would lock the plot out of quadrat revisions entirely.
    const carryOverExisting: QuadratCsvRow[] = [];
    const unvalidatableExistingNames: string[] = [];
    for (const existingRow of existingQuadratList) {
      const storedName = String(existingRow.QuadratName ?? '').trim();
      if (storedName && incomingNamesLower.has(storedName.toLowerCase())) continue;

      // Unnamed rows get a synthetic display name: it keeps them visible in issue messages
      // and cannot collide with incoming names, which are non-blank by this point.
      const displayName = storedName || `(unnamed QuadratID ${existingRow.QuadratID})`;
      // Stored rows are always canonical south-west, so toQuadratGeometry here is a pure
      // parse -- not a re-declaration of the reference corner. coerceGeometryField is reused
      // rather than a second near-identical coercer: it maps undefined to undefined and
      // everything else through String(), which toQuadratGeometry treats the same as null.
      const geometry = toQuadratGeometry({
        quadrat: displayName,
        startx: coerceGeometryField(existingRow.StartX),
        starty: coerceGeometryField(existingRow.StartY),
        dimx: coerceGeometryField(existingRow.DimensionX),
        dimy: coerceGeometryField(existingRow.DimensionY)
      });
      if (!geometry) {
        unvalidatableExistingNames.push(displayName);
        continue;
      }
      carryOverExisting.push(geometry);
    }
    if (unvalidatableExistingNames.length > 0) {
      ailogger.warn(
        `Plot ${plotID} has ${unvalidatableExistingNames.length} existing active quadrat(s) with malformed stored geometry; ` +
          `they were excluded from revision geometry validation: ${truncateAndJoin(unvalidatableExistingNames, ', ')}. ` +
          `Re-upload those quadrats with valid geometry to restore full validation.`
      );
    }

    const prospectiveLayout = [...carryOverExisting, ...normalizedIncoming];
    if (prospectiveLayout.length > MAX_GENERATED_QUADRATS) {
      throw new QuadratGeometryValidationError(
        `Prospective quadrat layout contains ${prospectiveLayout.length} rows; maximum allowed per plot is ${MAX_GENERATED_QUADRATS}.`
      );
    }

    // Reject only defects this upload INTRODUCES. Issues confined to carry-over rows are
    // pre-existing database state the uploader neither caused nor can repair in this file
    // (repairing them is itself a Revisions upload, which would re-run this same check --
    // blocking on them would deadlock the plot). Issue rowIndexes map into prospectiveLayout,
    // so everything at or past carryOverExisting.length was introduced by an incoming row;
    // an incoming row overlapping a carry-over row still blocks via the incoming row's entry.
    const incomingStartIndex = carryOverExisting.length;
    const revisionIssues = validateQuadratCollectionDetailed(prospectiveLayout, plotBounds, CANONICAL_SOUTHWEST_CORNER).issues;
    const preExistingIssues = revisionIssues.filter(issue => issue.rowIndex < incomingStartIndex);
    const introducedIssues = revisionIssues.filter(issue => issue.rowIndex >= incomingStartIndex);
    if (preExistingIssues.length > 0) {
      ailogger.warn(
        `Plot ${plotID} has pre-existing quadrat layout defects not caused by this upload: ` +
          `${truncateAndJoin(
            preExistingIssues.map(issue => issue.message),
            ' '
          )}`
      );
    }

    // Supplemental cap-proof overlap sweep. validateQuadratCollection caps how many overlapping
    // pairs it reports, and on a plot whose existing layout is saturated with overlaps (a real
    // production case: every quadrat stacked at the same coordinates) pre-existing pairs can
    // exhaust that cap and mask a NEW overlap this upload introduces. Only incoming-involving
    // pairs are reportable here, so pre-existing pairs cannot crowd them out. Rows are already
    // canonical south-west; non-positive-dimension rows are excluded from the sweep the same
    // way the shared validator excludes them (they surface via their own dimension issue).
    const incomingRowSet = new Set<QuadratCsvRow>(normalizedIncoming);
    const sweepableLayout = prospectiveLayout.filter(row => row.dimensionX > 0 && row.dimensionY > 0);
    const introducedOverlapSummary = summarizeQuadratOverlaps(sweepableLayout, (a, b) => incomingRowSet.has(a) || incomingRowSet.has(b));

    const fatalIntroducedMessages = new Set<string>(introducedIssues.filter(issue => issue.kind !== 'overlap').map(issue => issue.message));
    if (fatalIntroducedMessages.size > 0) {
      throw new QuadratGeometryValidationError(formatQuadratGeometryMessages([...fatalIntroducedMessages]));
    }

    requireOverlapAcknowledgment(introducedOverlapSummary);
  }

  // Every incoming row was validated above (unique, in-bounds, with any overlaps explicitly
  // acknowledged for this exact layout), so this
  // lookup is guaranteed to hit for every row processed below.
  const canonicalByName = new Map<string, QuadratCsvRow>();
  for (const row of normalizedIncoming) {
    canonicalByName.set(row.quadratName.toLowerCase(), row);
  }

  for (const row of rows) {
    const quadratName = normalizeRequiredString(row.quadrat);
    // Blank name here means an entirely-blank padding row: it was counted in skippedCount
    // above (a blank name WITH data present already threw during row conversion).
    if (!quadratName) continue;
    const canonical = canonicalByName.get(quadratName.toLowerCase());
    if (!canonical) {
      throw new QuadratGeometryValidationError(`Internal error: no canonical geometry resolved for quadrat "${quadratName}".`);
    }

    const payload = {
      StartX: canonical.startX,
      StartY: canonical.startY,
      DimensionX: canonical.dimensionX,
      DimensionY: canonical.dimensionY,
      Area: row.area,
      QuadratShape: normalizeOptionalString(row.quadratshape)
    };

    if (uploadMode === UploadMode.REVISIONS) {
      const existingSQL = safeFormatQuery(
        schema,
        `SELECT QuadratID FROM ??.quadrats WHERE PlotID = ? AND LOWER(QuadratName) = LOWER(?) AND IsActive = 1 LIMIT 1`
      );
      const existingRows = await connectionManager.executeQuery(existingSQL, [plotID, quadratName], transactionID);

      if (existingRows.length > 0) {
        const updateSQL = safeFormatQuery(
          schema,
          `UPDATE ??.quadrats
           SET QuadratName = ?, StartX = ?, StartY = ?, DimensionX = ?, DimensionY = ?, Area = ?, QuadratShape = ?, DeletedAt = NULL
           WHERE QuadratID = ?`
        );
        await connectionManager.executeQuery(
          updateSQL,
          [quadratName, payload.StartX, payload.StartY, payload.DimensionX, payload.DimensionY, payload.Area, payload.QuadratShape, existingRows[0].QuadratID],
          transactionID
        );
        updatedCount += 1;
        continue;
      }
    }

    const insertSQL = safeFormatQuery(
      schema,
      `INSERT INTO ??.quadrats
       (PlotID, QuadratName, StartX, StartY, DimensionX, DimensionY, Area, QuadratShape, IsActive, DeletedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NULL)`
    );
    await connectionManager.executeQuery(
      insertSQL,
      [plotID, quadratName, payload.StartX, payload.StartY, payload.DimensionX, payload.DimensionY, payload.Area, payload.QuadratShape],
      transactionID
    );
    insertedCount += 1;
  }

  return {
    insertedCount,
    updatedCount,
    skippedCount,
    ...(acknowledgedOverlapSummaries.length > 0 ? { acknowledgedOverlapSummaries } : {})
  };
}

async function upsertSpeciesRows(
  connectionManager: ConnectionManager,
  schema: string,
  rows: FileRow[],
  uploadMode: UploadMode,
  transactionID: string
): Promise<FixedDataProcessingResult> {
  let insertedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;

  const duplicateSpeciesCodes = findDuplicateSpeciesCodes(rows);
  if (duplicateSpeciesCodes.length > 0) {
    throw new Error(`Species upload contains duplicate SpeciesCode values: ${duplicateSpeciesCodes.join(', ')}`);
  }

  if (uploadMode === UploadMode.CLEAN_REUPLOAD) {
    // CLEAN_REUPLOAD deletes every active species row before re-inserting the file.
    // That DELETE is only safe when no live records depend on those SpeciesIDs yet.
    // trees and specieslimits both reference species via ON DELETE CASCADE, so
    // including the same SpeciesCode in the upload does NOT preserve downstream data:
    // the delete would still remove the dependent rows before the replacement
    // SpeciesID exists. Block the mode entirely once any active species row is in use.
    const blockingSpeciesSQL = format(
      `SELECT DISTINCT s.SpeciesCode
       FROM ??.species s
       WHERE s.IsActive = 1
         AND s.SpeciesCode IS NOT NULL
         AND (
           EXISTS (
             SELECT 1
             FROM ??.trees t
             WHERE t.SpeciesID = s.SpeciesID
           )
           OR EXISTS (
             SELECT 1
             FROM ??.specieslimits sl
             WHERE sl.SpeciesID = s.SpeciesID
           )
         )
       ORDER BY s.SpeciesCode`,
      [schema, schema, schema]
    );
    const blockingSpeciesRows = await connectionManager.executeQuery(blockingSpeciesSQL, [], transactionID);
    const blockingCodes = Array.isArray(blockingSpeciesRows) ? blockingSpeciesRows.map((row: any) => String(row.SpeciesCode ?? '').trim()).filter(Boolean) : [];

    if (blockingCodes.length > 0) {
      throw new Error(
        `Clean re-upload refused: active species rows are already referenced by trees or species limits ` +
          `for the following SpeciesCode value(s): ${formatBlockedCleanReuploadValues(blockingCodes)}. ` +
          `Deleting species would cascade-delete dependent records even if the same codes appear in the upload. ` +
          `Use Revisions Upload instead.`
      );
    }

    const deleteSQL = format(`DELETE FROM ??.species WHERE IsActive = 1`, [schema]);
    await connectionManager.executeQuery(deleteSQL, [], transactionID);
  }

  for (const row of rows) {
    const speciesCode = normalizeRequiredString(row.spcode);
    if (!speciesCode) {
      skippedCount += 1;
      continue;
    }

    let familyID: number | undefined;
    if (normalizeOptionalString(row.family)) {
      familyID = (
        await handleUpsert<FamilyResult>(connectionManager, schema, 'family', { Family: normalizeOptionalString(row.family)! }, 'FamilyID', transactionID)
      ).id;
    }

    let genusID: number | undefined;
    if (normalizeOptionalString(row.genus)) {
      const genusPayload: Partial<GenusResult> = {
        Genus: normalizeOptionalString(row.genus)!
      };
      if (familyID) {
        genusPayload.FamilyID = familyID;
      }
      genusID = (await handleUpsert<GenusResult>(connectionManager, schema, 'genus', genusPayload, 'GenusID', transactionID)).id;
    }

    const speciesPayload = {
      GenusID: genusID ?? null,
      SpeciesName: normalizeOptionalString(row.species),
      SubspeciesName: normalizeOptionalString(row.subspecies),
      IDLevel: normalizeOptionalString(row.idlevel),
      SpeciesAuthority: normalizeOptionalString(row.authority),
      SubspeciesAuthority: normalizeOptionalString(row.subauthority)
    };

    if (uploadMode === UploadMode.REVISIONS) {
      const existingSQL = format(`SELECT SpeciesID FROM ??.species WHERE LOWER(SpeciesCode) = LOWER(?) AND IsActive = 1 ORDER BY SpeciesID`, [schema]);
      const existingRows = await connectionManager.executeQuery(existingSQL, [speciesCode], transactionID);

      if (existingRows.length > 1) {
        throw new Error(`Duplicate active species rows already exist for SpeciesCode "${speciesCode}". Remove the duplicates before uploading revisions.`);
      }

      if (existingRows.length > 0) {
        // REVISIONS source-of-truth semantics: every column that the species upload
        // CSV format can carry is overwritten unconditionally. Fields the row omits
        // are normalized to NULL by normalizeOptionalString and so wipe whatever was
        // previously in the database. This is intentional -- the user explicitly
        // chose Option (a) ("Replace the whole row") when this behavior was
        // confirmed. If the CSV format ever grows new columns, add them here to
        // keep the overwrite semantics complete.
        const updateSQL = format(
          `UPDATE ??.species
           SET SpeciesCode = ?, GenusID = ?, SpeciesName = ?, SubspeciesName = ?, IDLevel = ?, SpeciesAuthority = ?, SubspeciesAuthority = ?, DeletedAt = NULL
           WHERE SpeciesID = ?`,
          [schema]
        );
        await connectionManager.executeQuery(
          updateSQL,
          [
            speciesCode,
            speciesPayload.GenusID,
            speciesPayload.SpeciesName,
            speciesPayload.SubspeciesName,
            speciesPayload.IDLevel,
            speciesPayload.SpeciesAuthority,
            speciesPayload.SubspeciesAuthority,
            existingRows[0].SpeciesID
          ],
          transactionID
        );
        updatedCount += 1;
        continue;
      }
    }

    const insertSQL = format(
      `INSERT INTO ??.species
       (GenusID, SpeciesCode, SpeciesName, SubspeciesName, IDLevel, SpeciesAuthority, SubspeciesAuthority, IsActive, DeletedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, NULL)`,
      [schema]
    );
    await connectionManager.executeQuery(
      insertSQL,
      [
        speciesPayload.GenusID,
        speciesCode,
        speciesPayload.SpeciesName,
        speciesPayload.SubspeciesName,
        speciesPayload.IDLevel,
        speciesPayload.SpeciesAuthority,
        speciesPayload.SubspeciesAuthority
      ],
      transactionID
    );
    insertedCount += 1;
  }

  return { insertedCount, updatedCount, skippedCount };
}

async function upsertPersonnelRows(
  connectionManager: ConnectionManager,
  schema: string,
  censusID: number | undefined,
  rows: FileRow[],
  uploadMode: UploadMode,
  transactionID: string
): Promise<FixedDataProcessingResult> {
  if (!censusID) {
    throw new Error('CensusID is required for personnel uploads');
  }

  let insertedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;

  if (uploadMode === UploadMode.CLEAN_REUPLOAD) {
    // Remove all census-active links for this census
    const deleteCapSQL = format(`DELETE FROM ??.censusactivepersonnel WHERE CensusID = ?`, [schema]);
    await connectionManager.executeQuery(deleteCapSQL, [censusID], transactionID);
    // Remove personnel who are no longer linked to any census
    const deleteOrphanedSQL = format(
      `DELETE p FROM ??.personnel p
       LEFT JOIN ??.censusactivepersonnel cap ON cap.PersonnelID = p.PersonnelID
       WHERE cap.PersonnelID IS NULL AND p.IsActive = 1`,
      [schema, schema]
    );
    await connectionManager.executeQuery(deleteOrphanedSQL, [], transactionID);
  }

  for (const row of rows) {
    const firstName = normalizeRequiredString(row.firstname);
    const lastName = normalizeRequiredString(row.lastname);
    const roleName = normalizeRequiredString(row.role);
    const roleDescription = normalizeOptionalString(row.roledescription);

    if (!firstName || !lastName || !roleName) {
      skippedCount += 1;
      continue;
    }

    const normalizedRole = roleName
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/\s+/g, ' ')
      .toLowerCase()
      .trim();

    const roleID = (
      await handleUpsert<RoleResult>(
        connectionManager,
        schema,
        'roles',
        {
          RoleName: normalizedRole,
          RoleDescription: roleDescription
        },
        'RoleID',
        transactionID
      )
    ).id;

    if (uploadMode === UploadMode.REVISIONS) {
      const existingSQL = format(
        `SELECT p.PersonnelID FROM ??.personnel p
         WHERE LOWER(p.FirstName) = LOWER(?) AND LOWER(p.LastName) = LOWER(?) AND p.IsActive = 1
         LIMIT 1`,
        [schema]
      );
      const existingRows = await connectionManager.executeQuery(existingSQL, [firstName, lastName], transactionID);

      if (existingRows.length > 0) {
        const personnelID = Number(existingRows[0].PersonnelID);
        const updateSQL = format(`UPDATE ??.personnel SET FirstName = ?, LastName = ?, RoleID = ?, DeletedAt = NULL WHERE PersonnelID = ?`, [schema]);
        await connectionManager.executeQuery(updateSQL, [firstName, lastName, roleID, personnelID], transactionID);
        const capSQL = format(`INSERT IGNORE INTO ??.censusactivepersonnel (CensusID, PersonnelID) VALUES (?, ?)`, [schema]);
        await connectionManager.executeQuery(capSQL, [censusID, personnelID], transactionID);
        updatedCount += 1;
        continue;
      }
    }

    const insertSQL = format(`INSERT INTO ??.personnel (FirstName, LastName, RoleID, IsActive, DeletedAt) VALUES (?, ?, ?, 1, NULL)`, [schema]);
    const insertResult = await connectionManager.executeQuery(insertSQL, [firstName, lastName, roleID], transactionID);
    const personnelID = Number(insertResult.insertId);
    const capSQL = format(`INSERT IGNORE INTO ??.censusactivepersonnel (CensusID, PersonnelID) VALUES (?, ?)`, [schema]);
    await connectionManager.executeQuery(capSQL, [censusID, personnelID], transactionID);
    insertedCount += 1;
  }

  return { insertedCount, updatedCount, skippedCount };
}

async function validateMeasurementUploadScope(
  connectionManager: ConnectionManager,
  schema: string,
  fileName: string,
  batchID: string,
  plot: Plot | undefined,
  census: OrgCensus | undefined
): Promise<{ plotID: number; censusID: number } | NextResponse> {
  const bodyPlotID = toPositiveInteger(plot?.plotID);
  const bodyCensusID = toPositiveInteger(census?.dateRanges?.[0]?.censusID);
  const cookiePlotID = toPositiveInteger(await getCookie('plotID'));
  const cookieCensusID = toPositiveInteger(await getCookie('censusID'));

  if (bodyPlotID !== null && cookiePlotID !== null && bodyPlotID !== cookiePlotID) {
    ailogger.warn(`Measurement upload for ${fileName} has plotID mismatch between request body and cookie; preferring request body`, {
      fileName,
      batchID,
      bodyPlotID,
      cookiePlotID
    });
  }

  if (bodyCensusID !== null && cookieCensusID !== null && bodyCensusID !== cookieCensusID) {
    ailogger.warn(`Measurement upload for ${fileName} has censusID mismatch between request body and cookie; preferring request body`, {
      fileName,
      batchID,
      bodyCensusID,
      cookieCensusID
    });
  }

  const resolvedPlotID = bodyPlotID ?? cookiePlotID;
  const resolvedCensusID = bodyCensusID ?? cookieCensusID;

  if (resolvedPlotID === null || resolvedCensusID === null) {
    return buildMeasurementScopeErrorResponse(HTTPResponses.INVALID_REQUEST, 'Missing plotID or censusID for measurement upload', {
      fileName,
      batchID,
      bodyPlotID,
      bodyCensusID,
      cookiePlotID,
      cookieCensusID
    });
  }

  const censusScopeSQL = format(`SELECT PlotID FROM ??.census WHERE CensusID = ? LIMIT 1`, [schema]);
  const censusScopeResult = await connectionManager.executeQuery(censusScopeSQL, [resolvedCensusID]);
  const censusPlotID = toPositiveInteger(censusScopeResult?.[0]?.PlotID);

  if (censusPlotID === null) {
    ailogger.warn(`Rejected measurement upload for ${fileName}: census ${resolvedCensusID} not found in schema ${schema}`, {
      fileName,
      batchID,
      resolvedPlotID,
      resolvedCensusID
    });
    return buildMeasurementScopeErrorResponse(HTTPResponses.INVALID_REQUEST, `Census ${resolvedCensusID} was not found in schema ${schema}`, {
      fileName,
      batchID,
      resolvedPlotID,
      resolvedCensusID
    });
  }

  if (censusPlotID !== resolvedPlotID) {
    ailogger.warn(`Rejected measurement upload for ${fileName}: census ${resolvedCensusID} belongs to plot ${censusPlotID}, not ${resolvedPlotID}`, {
      fileName,
      batchID,
      resolvedPlotID,
      resolvedCensusID,
      censusPlotID
    });
    return buildMeasurementScopeErrorResponse(HTTPResponses.CONFLICT, 'censusID does not belong to the provided plotID', {
      fileName,
      batchID,
      resolvedPlotID,
      resolvedCensusID,
      censusPlotID
    });
  }

  const batchScopeSQL = format(
    `SELECT COUNT(DISTINCT PlotID) as distinctPlotCount,
            COUNT(DISTINCT CensusID) as distinctCensusCount,
            MIN(PlotID) as plotID,
            MIN(CensusID) as censusID
     FROM ??.temporarymeasurements
     WHERE FileID = ? AND BatchID = ?`,
    [schema]
  );
  const batchScopeResult = await connectionManager.executeQuery(batchScopeSQL, [fileName, batchID]);
  const batchScope = batchScopeResult?.[0] ?? {};
  const distinctPlotCount = Number(batchScope.distinctPlotCount ?? 0);
  const distinctCensusCount = Number(batchScope.distinctCensusCount ?? 0);
  const batchPlotID = toPositiveInteger(batchScope.plotID ?? batchScope.PlotID);
  const batchCensusID = toPositiveInteger(batchScope.censusID ?? batchScope.CensusID);

  if (distinctPlotCount > 1 || distinctCensusCount > 1) {
    ailogger.error(
      `Rejected measurement upload for ${fileName}: existing batch ${batchID} already contains mixed plot/census scope ` +
        `(plots=${distinctPlotCount}, censuses=${distinctCensusCount}, batchPlotID=${batchPlotID}, batchCensusID=${batchCensusID})`
    );
    return buildMeasurementScopeErrorResponse(HTTPResponses.CONFLICT, 'Existing batch contains mixed plot/census scope', {
      fileName,
      batchID,
      distinctPlotCount,
      distinctCensusCount,
      batchPlotID,
      batchCensusID
    });
  }

  if ((batchPlotID !== null && batchPlotID !== resolvedPlotID) || (batchCensusID !== null && batchCensusID !== resolvedCensusID)) {
    ailogger.warn(`Rejected measurement upload for ${fileName}: existing batch scope does not match incoming plot/census`, {
      fileName,
      batchID,
      resolvedPlotID,
      resolvedCensusID,
      batchPlotID,
      batchCensusID
    });
    return buildMeasurementScopeErrorResponse(HTTPResponses.CONFLICT, 'Existing batch scope does not match incoming plot/census', {
      fileName,
      batchID,
      resolvedPlotID,
      resolvedCensusID,
      batchPlotID,
      batchCensusID
    });
  }

  return { plotID: resolvedPlotID, censusID: resolvedCensusID };
}

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  // Authentication check
  const session = await auth();
  const authError = requireSession(session);
  if (authError) {
    ailogger.warn('Unauthorized upload attempt - no session');
    return authError;
  }

  let body;

  try {
    body = await request.json();
  } catch (error: any) {
    ailogger.error('Error parsing JSON body:', error);
    return new NextResponse(
      JSON.stringify({
        responseMessage: 'Invalid or empty JSON body in the request',
        error: error.message
      }),
      { status: HTTPResponses.INVALID_REQUEST }
    );
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: 'Request body must be a JSON object', code: 'INVALID_REQUEST_BODY' }, { status: HTTPResponses.INVALID_REQUEST });
  }

  const schema: string = body.schema;

  // SQL Injection Prevention: Validate schema against whitelist
  if (!isValidSchema(schema)) {
    ailogger.error(`Invalid schema provided: ${schema}. Allowed schemas: forestgeo, forestgeo_testing, forestgeo_testing_alternate, catalog`);
    return new NextResponse(
      JSON.stringify({
        responseMessage: 'Invalid schema',
        error: 'The provided schema is not allowed'
      }),
      { status: HTTPResponses.INVALID_REQUEST }
    );
  }

  // Phase-3: user→schema membership enforced INLINE rather than via `withRouteAuthz` +
  // `fromBody('schema')`. This route accepts a potentially large upload body; `fromBody`
  // clones and fully re-parses the whole body to read one field, doubling parse cost on
  // the hot upload path. The handler already parsed the body and authenticated the session
  // above, so we reuse the resolved `schema` and `session` directly. The measurements branch
  // below retains `requireUploadSessionOwnership` for plot/census token ownership — this adds
  // the missing user→schema check on top. The meta-test (app/api/route-policy.test.ts)
  // recognises the `assertSchemaAccess` + `if (denied) return denied` pair as a valid signal.
  const denied = assertSchemaAccess(session!, schema);
  if (denied) return denied;

  const formType: string = body.formType;
  const sourceFormat = normalizeSourceFormat(body.sourceFormat ?? SourceFormat.csv);
  if (sourceFormat !== SourceFormat.csv) {
    return new NextResponse(
      JSON.stringify({
        responseMessage: 'Invalid source format',
        error: `sourceFormat must be ${SourceFormat.csv}`
      }),
      { status: HTTPResponses.INVALID_REQUEST }
    );
  }
  if (body.uploadMode !== undefined && !isSupportedUploadMode(body.uploadMode)) {
    return NextResponse.json(
      {
        error: `uploadMode must be ${UploadMode.CLEAN_REUPLOAD} or ${UploadMode.REVISIONS}`,
        code: 'INVALID_UPLOAD_MODE'
      },
      { status: HTTPResponses.INVALID_REQUEST }
    );
  }
  const uploadMode = normalizeUploadMode(body.uploadMode);
  const plot: Plot = body.plot;
  const census: OrgCensus = body.census;
  const user: string = body.user;
  const fileRowSet: FileRowSet = body.fileRowSet ?? {};
  const fileName: string = body.fileName;
  // Optional RAW-rows path (#6, server half): when present, the server re-resolves/keys/validates
  // CSV headers via the shared pipeline instead of trusting client-computed keys in fileRowSet.
  const rawRows: Record<string, string>[] | undefined = Array.isArray(body.rawRows) ? body.rawRows : undefined;
  const csvHeaders: string[] = Array.isArray(body.csvHeaders) ? body.csvHeaders : [];
  const clientMapping: unknown = body.mapping;
  const csvDelimiter: string = typeof body.delimiter === 'string' && body.delimiter.length > 0 ? body.delimiter : ',';
  let transactionID: string | undefined;
  const failingRows: Set<FileRow> = new Set<FileRow>();
  const connectionManager = ConnectionManager.getInstance();
  const maxRetries = 3;
  let retryCount = 0;
  if (formType === 'measurements') {
    let chunkRows = Object.values(fileRowSet ?? {});
    let mappingDiagnostics: { invalidDateValues: string[]; extraColumnRows: number; ignoredColumnCount: number } | null = null;
    const batchID = body.batchID || generateShortBatchID();
    const sessionId = request.headers.get('x-upload-session-id');
    let scopeValidation: Awaited<ReturnType<typeof validateMeasurementUploadScope>>;
    try {
      scopeValidation = await validateMeasurementUploadScope(connectionManager, schema, fileName, batchID, plot, census);
    } catch (error: any) {
      ailogger.error(`Failed to validate measurement upload scope for ${fileName}-${batchID}`, error);
      return new NextResponse(
        JSON.stringify({
          responseMessage: 'Failed to validate measurement upload scope',
          error: error.message,
          fileName,
          batchID
        }),
        { status: HTTPResponses.SERVICE_UNAVAILABLE }
      );
    }
    if (scopeValidation instanceof NextResponse) {
      return scopeValidation;
    }
    const { plotID: resolvedPlotID, censusID: resolvedCensusID } = scopeValidation;

    try {
      await requireUploadSessionOwnership({
        schema,
        sessionId,
        plotId: resolvedPlotID,
        censusId: resolvedCensusID,
        allowedStates: [TrackedUploadSessionState.INITIALIZED, TrackedUploadSessionState.UPLOADING],
        contextLabel: `measurement chunk upload for ${fileName}-${batchID}`
      });
    } catch (error: unknown) {
      if (error instanceof UploadSessionOwnershipError) {
        ailogger.warn(`Rejected measurement upload for ${fileName}-${batchID}: ${error.message}`);
        return new NextResponse(
          JSON.stringify({
            responseMessage: 'Upload session conflict',
            error: error.message,
            fileName,
            batchID
          }),
          { status: error.status }
        );
      }
      throw error;
    }

    // SERVER-RESOLUTION STAGE (#6): when the client sends RAW rows, the server is authoritative
    // over CSV header resolution. We re-key/validate via the shared pipeline rather than trusting
    // client-computed keys. Gated on rawRows + non-revisions so the legacy fileRowSet path is byte
    // identical. Revisions uploads keep their existing measurementID-matching path untouched.
    if (rawRows && uploadMode !== UploadMode.REVISIONS) {
      // Reject a malformed/tampered mapping at the wire boundary (parity with the arcgis preflight route).
      if (clientMapping !== undefined && clientMapping !== null && !isColumnMappingShape(clientMapping)) {
        return new NextResponse(JSON.stringify({ responseMessage: 'Invalid mapping payload', fileName, batchID }), { status: HTTPResponses.INVALID_REQUEST });
      }
      const requiredHeaders = RequiredTableHeadersByFormType[FormType.measurements] ?? [];
      const resolved = resolveMeasurementChunk(rawRows, csvHeaders.length, {
        formType: FormType.measurements,
        uploadMode: 'other',
        delimiter: csvDelimiter,
        requiredHeaders,
        csvHeaders,
        storedMapping: isColumnMappingShape(clientMapping) ? clientMapping : undefined
      });
      if (resolved.columnCountMismatch) {
        return new NextResponse(JSON.stringify({ responseMessage: 'Header plan misalignment for the uploaded file', fileName, batchID }), {
          status: HTTPResponses.UNPROCESSABLE_ENTITY
        });
      }
      chunkRows = resolved.validRows;
      for (const invalid of resolved.invalidRows) failingRows.add(invalid);
      // Surface resolution diagnostics so silently-dropped columns / unparseable inputs are visible to
      // the client instead of vanishing. Logged here too for server-side observability.
      mappingDiagnostics = resolved.diagnostics;
      if (mappingDiagnostics.ignoredColumnCount > 0) {
        ailogger.warn(
          `Column mapping for ${fileName}-${batchID} dropped ${mappingDiagnostics.ignoredColumnCount} unmatched column(s); they will not be ingested.`
        );
      }
    }

    const rowCount = chunkRows.length;
    // On the rawRows path fileRowSet is `{}`, which would make the hash constant across distinct
    // chunks and break idempotency. Hash the rows actually being inserted instead.
    const effectiveRowSet: FileRowSet = rawRows ? Object.fromEntries(chunkRows.map((row, index) => [`row-${index}`, row] as const)) : fileRowSet;
    const contentHash = hashChunkContent(effectiveRowSet);
    const idempotencyKey = generateIdempotencyKey(fileName, resolvedPlotID, resolvedCensusID, rowCount, contentHash);
    await ensureTemporaryMeasurementsSourceFormatColumn(connectionManager, schema);

    // NOTE:
    // Sample-row duplicate short-circuit checks were removed because they could
    // falsely classify unique chunks as duplicates. We now always ingest the chunk
    // and rely on downstream dedupe + explicit dropped-row tracking.

    // Retry logic for database operations
    while (retryCount <= maxRetries) {
      try {
        transactionID = await connectionManager.beginTransaction();

        // Count rows BEFORE insert so we can measure the delta (important when
        // multiple chunks share a single BatchID under batch consolidation).
        const expectedRowCount = chunkRows.length;
        const countSQL = format(`SELECT COUNT(*) as count FROM ??.temporarymeasurements WHERE FileID = ? AND BatchID = ?`, [schema]);
        const preInsertResult = await connectionManager.executeQuery(countSQL, [fileName, batchID], transactionID);
        const preInsertCount = preInsertResult[0]?.count || 0;

        // A retry of the same file should not inherit stale batches that were left
        // behind by an earlier interrupted upload for the same plot/census.
        if (preInsertCount === 0) {
          if (uploadMode === UploadMode.CLEAN_REUPLOAD) {
            // Clean up data from any previous uploads for this census.
            // Clean re-upload is census replacement, not filename replacement.
            await cleanupPreviousFileUploads(connectionManager, schema, fileName, batchID, resolvedPlotID, resolvedCensusID, transactionID);
          }

          await cleanupStaleMeasurementBatchesForFile(connectionManager, schema, fileName, batchID, resolvedPlotID, resolvedCensusID, transactionID);
        }

        await insertTemporaryMeasurementsInBatches(
          connectionManager,
          schema,
          chunkRows,
          fileName,
          batchID,
          sessionId,
          sourceFormat,
          resolvedPlotID,
          resolvedCensusID,
          transactionID
        );

        // A present-but-unparseable PublishedStemID is coerced to NULL at staging so the row still
        // ingests, but the SI-assigned identifier the upload carried is lost. Surface it as a
        // visible warning alert rather than dropping it silently.
        const invalidPublishedStemIdRows = chunkRows
          .map((row, index) => ({ value: row.publishedstemid, sourceRowIndex: index + 1 }))
          .filter(candidate => isUnsignedIntFieldInvalid(candidate.value));

        if (invalidPublishedStemIdRows.length > 0) {
          ailogger.warn(
            `Coerced ${invalidPublishedStemIdRows.length} unparseable PublishedStemID value(s) to NULL for ${fileName}-${batchID}; ` +
              `the SI-assigned identifier was not stored for those rows.`
          );
          try {
            const publishedStemIdAlertSQL = format(
              `INSERT INTO ??.uploadintegrityalerts
               (uploadId, fileID, batchID, plotID, censusID, type, message, severity,
                sourceRecords, processedRecords, failedRecords, missingRecords)
               VALUES (?, ?, ?, ?, ?, 'INVALID_PUBLISHED_STEMID', ?, 'warning', ?, ?, ?, ?)`,
              [schema]
            );
            const publishedStemIdAlertMessage = JSON.stringify({
              coercedToNullCount: invalidPublishedStemIdRows.length,
              sample: invalidPublishedStemIdRows.slice(0, 10).map(candidate => ({
                sourceRowIndex: candidate.sourceRowIndex,
                value: `${candidate.value}`
              })),
              note: 'PublishedStemID values that are present but not a positive integer were stored as NULL; the row was still ingested.'
            });
            await connectionManager.executeQuery(
              publishedStemIdAlertSQL,
              [
                buildUploadId(schema, resolvedPlotID, resolvedCensusID, fileName, batchID, 'invalid-published-stemid'),
                fileName,
                batchID,
                resolvedPlotID,
                resolvedCensusID,
                publishedStemIdAlertMessage,
                expectedRowCount,
                expectedRowCount,
                0,
                0
              ],
              transactionID
            );
          } catch (alertError: unknown) {
            const message = alertError instanceof Error ? alertError.message : String(alertError);
            ailogger.error(`Failed to log INVALID_PUBLISHED_STEMID alert for ${fileName}-${batchID}: ${message}`);
          }
        }

        // CRITICAL FIX: Verify expected vs actual row count to detect silent data loss from INSERT IGNORE
        const postInsertResult = await connectionManager.executeQuery(countSQL, [fileName, batchID], transactionID);
        const postInsertCount = postInsertResult[0]?.count || 0;
        const actualInsertedCount = postInsertCount - preInsertCount;

        // Check for discrepancy - this would indicate INSERT IGNORE silently dropped rows
        const droppedRowCount = expectedRowCount - actualInsertedCount;

        if (droppedRowCount > 0) {
          ailogger.error(
            `DATA INTEGRITY WARNING: Expected ${expectedRowCount} rows but only ${actualInsertedCount} were inserted for ${fileName}-${batchID}. ` +
              `${droppedRowCount} row(s) were silently dropped by INSERT IGNORE (likely duplicates). This indicates potential data loss!`
          );

          const droppedCandidates = await findDroppedMeasurementCandidates(
            connectionManager,
            schema,
            fileName,
            batchID,
            resolvedPlotID,
            resolvedCensusID,
            chunkRows,
            transactionID
          );
          const droppedRows: DroppedMeasurementRow[] = droppedCandidates.map(candidate => {
            const row = chunkRows[candidate.rowOrdinal - 1];
            return Object.assign({}, row, {
              failureReason: buildDroppedMeasurementFailureReason(row, candidate.existingBatch),
              sourceRowIndex: candidate.rowOrdinal
            }) as DroppedMeasurementRow;
          });

          if (droppedRows.length !== droppedRowCount) {
            ailogger.warn(
              `Dropped-row batch detection identified ${droppedRows.length} of ${droppedRowCount} dropped row(s) for ${fileName}-${batchID}. ` +
                `Persisted unresolved ingestion errors may be incomplete for this chunk.`
            );
          }

          // Persist dropped rows as unresolved ingestion errors in coremeasurements.
          if (droppedRows.length > 0) {
            try {
              await insertIngestionFailureRows(
                connectionManager,
                schema,
                droppedRows.map(row => ({
                  plotID: resolvedPlotID,
                  censusID: resolvedCensusID,
                  tag: row.tag,
                  stemTag: row.stemtag || null,
                  spCode: row.spcode,
                  quadrat: row.quadrat,
                  x: toNullableNumber(row.lx),
                  y: toNullableNumber(row.ly),
                  dbh: toNullableNumber(row.dbh),
                  hom: toNullableNumber(row.hom),
                  date: row.date ? moment(row.date).format('YYYY-MM-DD') : null,
                  codes: row.codes || null,
                  comments: null,
                  fileID: fileName,
                  batchID,
                  sourceRowIndex: row.sourceRowIndex,
                  failureReason: row.failureReason || 'Unknown error during insert'
                })),
                transactionID
              );
              ailogger.info(`Persisted ${droppedRows.length} dropped rows as unresolved ingestion errors for ${fileName}-${batchID}`);
            } catch (failedInsertError: any) {
              ailogger.error(`Failed to persist dropped rows as unresolved ingestion errors (attempt 1): ${failedInsertError.message}`);

              // Retry once before giving up
              try {
                await insertIngestionFailureRows(
                  connectionManager,
                  schema,
                  droppedRows.map(row => ({
                    plotID: resolvedPlotID,
                    censusID: resolvedCensusID,
                    tag: row.tag,
                    stemTag: row.stemtag || null,
                    spCode: row.spcode,
                    quadrat: row.quadrat,
                    x: toNullableNumber(row.lx),
                    y: toNullableNumber(row.ly),
                    dbh: toNullableNumber(row.dbh),
                    hom: toNullableNumber(row.hom),
                    date: row.date ? moment(row.date).format('YYYY-MM-DD') : null,
                    codes: row.codes || null,
                    comments: null,
                    fileID: fileName,
                    batchID,
                    sourceRowIndex: row.sourceRowIndex,
                    failureReason: row.failureReason || 'Unknown error during insert'
                  })),
                  transactionID
                );
                ailogger.info(`Retry successful: persisted ${droppedRows.length} dropped rows as unresolved ingestion errors for ${fileName}-${batchID}`);
              } catch (retryError: any) {
                ailogger.error(`Failed to persist dropped rows as unresolved ingestion errors (attempt 2): ${retryError.message}`);

                // Critical: log to uploadintegrityalerts so data loss is not silent.
                try {
                  const alertUploadId = buildUploadId(
                    schema,
                    resolvedPlotID,
                    resolvedCensusID,
                    fileName,
                    batchID,
                    'failed-insert-to-unresolved-coremeasurements'
                  );
                  const alertSQL = format(
                    `INSERT INTO ??.uploadintegrityalerts
                     (uploadId, fileID, batchID, plotID, censusID, type, message, severity,
                      sourceRecords, processedRecords, failedRecords, missingRecords)
                     VALUES (?, ?, ?, ?, ?, 'FAILED_INSERT_TO_UNRESOLVED_COREMEASUREMENTS', ?, 'critical', ?, ?, ?, ?)`,
                    [schema]
                  );
                  const alertMessage = JSON.stringify({
                    error: retryError.message,
                    droppedRowCount: droppedRows.length,
                    timestamp: new Date().toISOString(),
                    note: 'These rows were dropped during upload and could not be persisted as unresolved ingestion errors'
                  });
                  await connectionManager.executeQuery(
                    alertSQL,
                    [
                      alertUploadId,
                      fileName,
                      batchID,
                      resolvedPlotID,
                      resolvedCensusID,
                      alertMessage,
                      expectedRowCount,
                      actualInsertedCount,
                      droppedRows.length,
                      0
                    ],
                    transactionID
                  );
                  ailogger.error(`Logged failed insert to uploadintegrityalerts for ${fileName}-${batchID}`);
                } catch (alertError: any) {
                  ailogger.error(`CRITICAL: Failed to log data loss to uploadintegrityalerts: ${alertError.message}. Dropped rows: ${droppedRows.length}`);
                }
              }
            }
          }
        } else {
          ailogger.info(`Successfully inserted ${actualInsertedCount} rows for ${fileName}-${batchID} (expected: ${expectedRowCount}, no data loss detected)`);
        }

        // Track file upload in unifiedchangelog (single row per file, not per batch)
        try {
          // Check if we've already logged this file upload - use format() for schema
          const existingEntrySQL = format(
            `SELECT ChangeID, NewRowState FROM ??.unifiedchangelog
             WHERE TableName = 'file_upload' AND RecordID = ? AND CensusID = ?
             ORDER BY ChangeID DESC LIMIT 1`,
            [schema]
          );
          const existingEntry = await connectionManager.executeQuery(existingEntrySQL, [fileName, resolvedCensusID], transactionID);

          if (existingEntry.length === 0) {
            // First batch for this file - insert new entry
            const uploadMetadata = JSON.stringify({
              fileName,
              formType,
              sourceFormat,
              uploadMode,
              rowCount: actualInsertedCount,
              droppedCount: droppedRowCount,
              batchCount: 1
            });
            const insertChangelogSQL = format(
              `INSERT INTO ??.unifiedchangelog
              (TableName, RecordID, Operation, NewRowState, ChangeTimestamp, ChangedBy, PlotID, CensusID)
              VALUES (?, ?, ?, ?, NOW(), ?, ?, ?)`,
              [schema]
            );
            await connectionManager.executeQuery(
              insertChangelogSQL,
              ['file_upload', fileName, 'INSERT', uploadMetadata, user, resolvedPlotID, resolvedCensusID],
              transactionID
            );
          } else {
            // Subsequent batch - update the existing entry with accumulated count
            // Handle both string and already-parsed object (MySQL driver may auto-parse JSON columns)
            const metadata = typeof existingEntry[0].NewRowState === 'string' ? JSON.parse(existingEntry[0].NewRowState) : existingEntry[0].NewRowState;
            metadata.sourceFormat = sourceFormat;
            metadata.uploadMode = uploadMode;
            metadata.rowCount = (metadata.rowCount || 0) + actualInsertedCount;
            metadata.droppedCount = (metadata.droppedCount || 0) + droppedRowCount;
            metadata.batchCount = (metadata.batchCount || 1) + 1;
            const updateChangelogSQL = format(`UPDATE ??.unifiedchangelog SET NewRowState = ?, ChangeTimestamp = NOW() WHERE ChangeID = ?`, [schema]);
            await connectionManager.executeQuery(updateChangelogSQL, [JSON.stringify(metadata), existingEntry[0].ChangeID], transactionID);
          }
        } catch (logError: any) {
          // Log but don't fail the upload if changelog tracking fails
          ailogger.error('Failed to log file upload to changelog', logError);
        }

        await connectionManager.commitTransaction(transactionID);
        transactionID = undefined;

        return new NextResponse(
          JSON.stringify({
            responseMessage:
              droppedRowCount > 0
                ? `Bulk insert completed with ${droppedRowCount} row(s) dropped - check unresolved ingestion errors`
                : `Bulk insert to SQL completed`,
            failingRows: Array.from(failingRows),
            insertedCount: actualInsertedCount,
            expectedCount: expectedRowCount,
            droppedCount: droppedRowCount,
            dataIntegrityWarning: droppedRowCount > 0,
            transactionCompleted: true,
            batchID: batchID,
            uploadMode,
            idempotencyKey,
            ...(mappingDiagnostics ? { mappingDiagnostics } : {})
          }),
          { status: HTTPResponses.OK }
        );
      } catch (e: any) {
        if (transactionID) {
          const failedTransactionID = transactionID;
          transactionID = undefined;
          await rollbackPreservingOriginalError(connectionManager, failedTransactionID, {
            schema,
            formType,
            fileName,
            uploadMode,
            branch: 'measurements'
          });
        }

        retryCount++;
        if (isRetryableUploadError(e) && retryCount <= maxRetries) {
          const delay = getUploadRetryDelayMs(retryCount);
          ailogger.warn(`Retryable error for ${fileName} (attempt ${retryCount}/${maxRetries + 1}), retrying in ${delay}ms: ${e.message}`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        ailogger.error(`Error processing file ${fileName} after ${retryCount} attempts:`, e.message);
        return new NextResponse(
          JSON.stringify({
            responseMessage: `Error processing file ${fileName}: ${e.message}`,
            failingRows: Array.from(failingRows),
            retryCount
          }),
          { status: HTTPResponses.INTERNAL_SERVER_ERROR }
        );
      }
    }
  } else {
    const uploadRows = Object.values(fileRowSet);

    while (retryCount <= maxRetries) {
      let rowId = '';
      let fixedDataProcessingResult: FixedDataProcessingResult = { insertedCount: 0, updatedCount: 0, skippedCount: 0 };

      try {
        transactionID = await connectionManager.beginTransaction();

        if (formType === 'quadrats') {
          const referenceCorner = parseReferenceCorner(body.coordinateReferenceCorner);
          const overlapAcknowledgment: unknown = body.quadratOverlapAcknowledgment;
          fixedDataProcessingResult = await upsertQuadratRows(
            connectionManager,
            schema,
            plot?.plotID,
            uploadRows,
            uploadMode,
            referenceCorner,
            overlapAcknowledgment,
            transactionID
          );
        } else if (formType === 'attributes') {
          fixedDataProcessingResult = await upsertAttributeRows(connectionManager, schema, uploadRows, uploadMode, transactionID);
        } else if (formType === 'species') {
          fixedDataProcessingResult = await upsertSpeciesRows(connectionManager, schema, uploadRows, uploadMode, transactionID);
        } else if (formType === 'personnel') {
          fixedDataProcessingResult = await upsertPersonnelRows(
            connectionManager,
            schema,
            census?.dateRanges?.[0]?.censusID,
            uploadRows,
            uploadMode,
            transactionID
          );
        } else {
          for (rowId in fileRowSet) {
            const row = fileRowSet[rowId];
            const props: InsertUpdateProcessingProps = {
              schema,
              connectionManager: connectionManager,
              formType,
              rowData: row,
              plot,
              census,
              fullName: user
            };
            try {
              await insertOrUpdate(props);
              fixedDataProcessingResult.updatedCount += 1;
            } catch (e: any) {
              ailogger.error(`Error processing row for file ${fileName}:`, e.message);
              failingRows.add(row);
            }
          }
        }

        // Track file upload in unifiedchangelog (single row per file)
        try {
          const batchRowCount = Object.keys(fileRowSet).length;
          const censusID = census?.dateRanges?.[0]?.censusID;
          // Provenance for acknowledged quadrat overlaps: the fixed statement, authoritative
          // session identity, complete layout signature, and either an exhaustive pair list or
          // an explicitly truncated sample. This record is part of the quadrat transaction.
          const overlapAcknowledgmentRecord = fixedDataProcessingResult.acknowledgedOverlapSummaries?.length
            ? {
                statement: QUADRAT_OVERLAP_ACKNOWLEDGMENT_STATEMENT,
                acknowledgedBy: authenticatedSessionIdentity(session?.user),
                summaries: fixedDataProcessingResult.acknowledgedOverlapSummaries
              }
            : null;

          // Check if we've already logged this file upload - use format() for schema
          const existingEntrySQL = format(
            `SELECT ChangeID, NewRowState FROM ??.unifiedchangelog
             WHERE TableName = 'file_upload' AND RecordID = ? AND CensusID = ?
             ORDER BY ChangeID DESC LIMIT 1`,
            [schema]
          );
          const existingEntry = await connectionManager.executeQuery(existingEntrySQL, [fileName, censusID], transactionID);

          if (existingEntry.length === 0) {
            // First batch for this file - insert new entry
            const uploadMetadata = JSON.stringify({
              fileName,
              formType,
              uploadMode,
              rowCount: batchRowCount,
              insertedCount: fixedDataProcessingResult.insertedCount,
              updatedCount: fixedDataProcessingResult.updatedCount,
              skippedCount: fixedDataProcessingResult.skippedCount,
              batchCount: 1,
              ...(overlapAcknowledgmentRecord ? { overlapAcknowledgment: overlapAcknowledgmentRecord } : {})
            });
            const insertChangelogSQL = format(
              `INSERT INTO ??.unifiedchangelog
              (TableName, RecordID, Operation, NewRowState, ChangeTimestamp, ChangedBy, PlotID, CensusID)
              VALUES (?, ?, ?, ?, NOW(), ?, ?, ?)`,
              [schema]
            );
            await connectionManager.executeQuery(
              insertChangelogSQL,
              ['file_upload', fileName, 'INSERT', uploadMetadata, user, plot?.plotID, censusID],
              transactionID
            );
          } else {
            // Subsequent batch - update the existing entry with accumulated count
            // Handle both string and already-parsed object (MySQL driver may auto-parse JSON columns)
            const metadata = typeof existingEntry[0].NewRowState === 'string' ? JSON.parse(existingEntry[0].NewRowState) : existingEntry[0].NewRowState;
            // Preserve the user's initial mode across chunked fixed-data uploads. Later
            // quadrat chunks intentionally execute as revisions after the first clean-reset
            // chunk, but the file-level changelog must continue to say clean_reupload.
            metadata.uploadMode = metadata.uploadMode || uploadMode;
            metadata.lastChunkMode = uploadMode;
            metadata.rowCount = (metadata.rowCount || 0) + batchRowCount;
            if (overlapAcknowledgmentRecord) {
              const existingSummaries = Array.isArray(metadata.overlapAcknowledgment?.summaries) ? metadata.overlapAcknowledgment.summaries : [];
              const summariesBySignature = new Map<string, QuadratOverlapSummary>();
              for (const summary of [...existingSummaries, ...overlapAcknowledgmentRecord.summaries]) {
                if (summary && typeof summary.layoutSignature === 'string') {
                  summariesBySignature.set(summary.layoutSignature, summary);
                }
              }
              metadata.overlapAcknowledgment = {
                ...overlapAcknowledgmentRecord,
                summaries: [...summariesBySignature.values()]
              };
            }
            metadata.insertedCount = (metadata.insertedCount || 0) + fixedDataProcessingResult.insertedCount;
            metadata.updatedCount = (metadata.updatedCount || 0) + fixedDataProcessingResult.updatedCount;
            metadata.skippedCount = (metadata.skippedCount || 0) + fixedDataProcessingResult.skippedCount;
            metadata.batchCount = (metadata.batchCount || 1) + 1;
            const updateChangelogSQL = format(`UPDATE ??.unifiedchangelog SET NewRowState = ?, ChangeTimestamp = NOW() WHERE ChangeID = ?`, [schema]);
            await connectionManager.executeQuery(updateChangelogSQL, [JSON.stringify(metadata), existingEntry[0].ChangeID], transactionID);
          }
        } catch (logError: any) {
          ailogger.error('Failed to log file upload to changelog', logError);
          // An overlap acknowledgment is part of the write authorization and provenance, not
          // optional telemetry. Keep it in the same transaction so an audit failure rolls the
          // quadrat data back. Preserve the legacy best-effort behavior for unrelated uploads.
          if (fixedDataProcessingResult.acknowledgedOverlapSummaries?.length) {
            throw new Error(`Failed to persist quadrat overlap acknowledgment: ${logError instanceof Error ? logError.message : String(logError)}`);
          }
        }

        await connectionManager.commitTransaction(transactionID ?? '');
        transactionID = undefined;

        return new NextResponse(
          JSON.stringify({
            responseMessage: uploadMode === UploadMode.REVISIONS ? `Revisions upload completed` : `Clean re-upload completed`,
            failingRows: Array.from(failingRows),
            insertedCount: fixedDataProcessingResult.insertedCount,
            updatedCount: fixedDataProcessingResult.updatedCount,
            skippedCount: fixedDataProcessingResult.skippedCount,
            uploadMode,
            transactionCompleted: true
          }),
          { status: HTTPResponses.OK }
        );
      } catch (error: any) {
        if (transactionID) {
          const failedTransactionID = transactionID;
          transactionID = undefined;
          await rollbackPreservingOriginalError(connectionManager, failedTransactionID, {
            schema,
            formType,
            fileName,
            uploadMode,
            branch: 'fixed-data'
          });
        }

        // Unacknowledged overlaps are a confirm-and-retry condition, not a data error: the
        // client re-submits the same file with the acknowledgment flag once the uploader
        // confirms the overlaps reflect field measurements. Distinct code so the UI can react.
        if (error instanceof QuadratOverlapAcknowledgmentRequiredError) {
          ailogger.warn(`Quadrat upload for ${fileName} requires overlap acknowledgment: ${error.message}`, {
            schema,
            plotID: plot?.plotID ?? null,
            uploadMode,
            code: QUADRAT_OVERLAP_ACKNOWLEDGMENT_REQUIRED_CODE
          });
          return NextResponse.json(
            {
              error: error.message,
              code: QUADRAT_OVERLAP_ACKNOWLEDGMENT_REQUIRED_CODE,
              overlapSummaries: [error.overlapSummary]
            },
            { status: HTTPResponses.INVALID_REQUEST }
          );
        }

        // A geometry validation failure is a client error, never a retryable infrastructure
        // failure -- check for it BEFORE retryCount/isRetryableUploadError so it can never be
        // retried and never falls through to the generic 503 responses below.
        if (error instanceof QuadratGeometryValidationError) {
          ailogger.warn(`Rejected quadrat upload for ${fileName}: ${error.message}`, {
            schema,
            plotID: plot?.plotID ?? null,
            uploadMode,
            coordinateReferenceCorner: body.coordinateReferenceCorner ?? DEFAULT_REFERENCE_CORNER,
            rowCount: uploadRows.length,
            code: 'INVALID_QUADRAT_GEOMETRY'
          });
          return NextResponse.json({ error: error.message, code: 'INVALID_QUADRAT_GEOMETRY' }, { status: HTTPResponses.INVALID_REQUEST });
        }

        retryCount++;
        if (isRetryableUploadError(error) && retryCount <= maxRetries) {
          const delay = getUploadRetryDelayMs(retryCount);
          ailogger.warn(`Retryable fixed-data error for ${fileName} (attempt ${retryCount}/${maxRetries + 1}), retrying in ${delay}ms: ${error.message}`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        ailogger.error('CATASTROPHIC ERROR: sqlpacketload: transaction rolled back.');
        ailogger.error(`Row ${rowId} failed processing:`, error);
        if (error instanceof Error) {
          ailogger.error(`Error processing row for file ${fileName}:`, error);
          return new NextResponse(
            JSON.stringify({
              responseMessage: `Error processing row in file ${fileName}`,
              error: error.message,
              failingRows: Array.from(failingRows),
              retryCount
            }),
            { status: HTTPResponses.SERVICE_UNAVAILABLE }
          );
        }

        ailogger.error('Unknown error processing row:', error);
        return new NextResponse(
          JSON.stringify({
            responseMessage: `Unknown processing error at row, in file ${fileName}`,
            failingRows: Array.from(failingRows),
            retryCount
          }),
          { status: HTTPResponses.SERVICE_UNAVAILABLE }
        );
      }
    }
  }
}
