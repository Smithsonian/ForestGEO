import ailogger from '@/ailogger';
import type ConnectionManager from '@/lib/db/connectionmanager';
import { safeFormatQuery } from '@/lib/db/sqlsecurity';
import type { FileRow } from '@/config/macros/formdetails';
import { UploadMode } from '@/config/uploadmodes';
import { buildDivergentQuadratUploadError, quadratRevisionAppendsDivergentSet } from './quadrat-upload-guards';
import {
  acknowledgmentCoversLayout,
  isBlankQuadratPaddingRow,
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

const MAX_LISTED_ISSUES = 20;
const CANONICAL_SOUTHWEST_CORNER: QuadratReferenceCorner = 'SW';

export interface QuadratWriteResult {
  insertedCount: number;
  updatedCount: number;
  skippedCount: number;
  acknowledgedOverlapSummaries?: QuadratOverlapSummary[];
}

export class QuadratGeometryValidationError extends Error {}

export class QuadratOverlapAcknowledgmentRequiredError extends Error {
  constructor(
    message: string,
    readonly overlapSummary: QuadratOverlapSummary
  ) {
    super(message);
    this.name = 'QuadratOverlapAcknowledgmentRequiredError';
  }
}

export function parseQuadratReferenceCorner(value: unknown): QuadratReferenceCorner {
  if (value === undefined || value === null) return DEFAULT_REFERENCE_CORNER;
  if (!isQuadratReferenceCorner(value)) {
    throw new QuadratGeometryValidationError('coordinateReferenceCorner must be SW, SE, NW, or NE');
  }
  return value;
}

function toNullableNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function coerceGeometryField(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return String(value);
}

function normalizeOptionalString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized === '' ? null : normalized;
}

function normalizeRequiredString(value: unknown): string {
  return String(value ?? '').trim();
}

function truncateAndJoin(items: string[], separator: string, maxItems: number = MAX_LISTED_ISSUES): string {
  const truncatedItems = items.slice(0, maxItems);
  const remainingCount = items.length - truncatedItems.length;
  return truncatedItems.join(separator) + (remainingCount > 0 ? `${separator}...and ${remainingCount} more` : '');
}

function formatBlockedValues(values: string[], maxValues: number = MAX_LISTED_ISSUES): string {
  const uniqueValues = Array.from(new Set(values.map(value => String(value ?? '').trim()).filter(Boolean))).sort((left, right) => left.localeCompare(right));
  return truncateAndJoin(uniqueValues, ', ', maxValues);
}

function formatGeometryMessages(messages: string[]): string {
  return `Quadrat geometry validation failed: ${truncateAndJoin(messages, ' ')}`;
}

function formatGeometryIssues(issues: QuadratCollectionIssue[]): string {
  return formatGeometryMessages(issues.map(issue => issue.message));
}

export async function writeQuadratUpload(
  connectionManager: ConnectionManager,
  schema: string,
  plotID: number | undefined,
  rows: FileRow[],
  uploadMode: UploadMode,
  referenceCorner: QuadratReferenceCorner,
  overlapAcknowledgment: unknown,
  transactionID: string
): Promise<QuadratWriteResult> {
  if (!plotID) {
    throw new Error('PlotID is required for quadrat uploads');
  }
  if (rows.length === 0) {
    throw new QuadratGeometryValidationError('Quadrat upload must contain at least one row.');
  }
  let insertedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;

  const rowConversionFailures: string[] = [];
  const incomingGeometry: QuadratCsvRow[] = [];
  rows.forEach((row, index) => {
    const quadratName = normalizeRequiredString(row.quadrat);
    if (!quadratName) {
      if (isBlankQuadratPaddingRow(row)) {
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
  if (incomingGeometry.length > MAX_GENERATED_QUADRATS) {
    throw new QuadratGeometryValidationError(
      `Quadrat upload contains ${incomingGeometry.length} usable rows; maximum allowed per request is ${MAX_GENERATED_QUADRATS}.`
    );
  }
  if (incomingGeometry.length === 0) {
    throw new QuadratGeometryValidationError(`Quadrat upload contains no usable rows (${skippedCount} blank row(s) skipped).`);
  }

  const plotBoundsSQL = safeFormatQuery(schema, `SELECT DimensionX, DimensionY FROM ??.plots WHERE PlotID = ? LIMIT 1`);
  const plotBoundsResult = await connectionManager.executeQuery(plotBoundsSQL, [plotID], transactionID);
  const plotBoundsRow = Array.isArray(plotBoundsResult) ? plotBoundsResult[0] : undefined;
  const plotDimensionX = toNullableNumber(plotBoundsRow?.DimensionX);
  const plotDimensionY = toNullableNumber(plotBoundsRow?.DimensionY);
  const plotBoundsUsable = !!plotBoundsRow && plotDimensionX !== null && plotDimensionY !== null && plotDimensionX > 0 && plotDimensionY > 0;
  const plotBounds = plotBoundsUsable ? { dimensionX: plotDimensionX, dimensionY: plotDimensionY } : null;
  if (!plotBounds) {
    ailogger.warn(
      `Plot ${plotID} has no valid DimensionX/DimensionY on record; quadrat plot-bounds checks are skipped for this upload. ` +
        `Overlap and duplicate-name validation still applies. Record the plot dimensions to restore full validation.`
    );
  }

  const normalizedIncoming = incomingGeometry.map(row => normalizeToSouthwest(row, referenceCorner));
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
    const cleanValidation = validateQuadratCollectionDetailed(normalizedIncoming, plotBounds, CANONICAL_SOUTHWEST_CORNER);
    if (cleanValidation.fatalIssues.length > 0) {
      throw new QuadratGeometryValidationError(formatGeometryIssues(cleanValidation.fatalIssues));
    }
    requireOverlapAcknowledgment(cleanValidation.overlapSummary);

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
    const blockingQuadratNames = blockingQuadrats.map((row: any) => {
      const quadratName = String(row.QuadratName ?? '').trim();
      return quadratName || `(unnamed QuadratID ${row.QuadratID})`;
    });

    if (blockingQuadrats.length > 0) {
      throw new Error(
        `Clean re-upload refused: active quadrat rows in plot ${plotID} are already referenced ` +
          `by stems for the following QuadratName value(s): ${formatBlockedValues(blockingQuadratNames)}. ` +
          `Deleting quadrats would cascade-delete stems and downstream measurements even if the same names appear in the upload. ` +
          `Use Revisions Upload instead.`
      );
    }

    const deleteSQL = safeFormatQuery(schema, `DELETE FROM ??.quadrats WHERE PlotID = ? AND IsActive = 1`);
    await connectionManager.executeQuery(deleteSQL, [plotID], transactionID);
  }

  if (uploadMode === UploadMode.REVISIONS) {
    const existingQuadratsSQL = safeFormatQuery(
      schema,
      `SELECT QuadratID, QuadratName, StartX, StartY, DimensionX, DimensionY FROM ??.quadrats WHERE PlotID = ? AND IsActive = 1`
    );
    const existingQuadratRows = await connectionManager.executeQuery(existingQuadratsSQL, [plotID], transactionID);
    const existingQuadratList: any[] = Array.isArray(existingQuadratRows) ? existingQuadratRows : [];

    const existingActiveNames = existingQuadratList.map(row => String(row.QuadratName ?? ''));
    const incomingNames = rows.map(row => normalizeRequiredString(row.quadrat)).filter(Boolean);
    if (quadratRevisionAppendsDivergentSet(existingActiveNames, incomingNames)) {
      throw new Error(buildDivergentQuadratUploadError(plotID, existingActiveNames, incomingNames.length));
    }

    const incomingNamesLower = new Set(normalizedIncoming.map(row => row.quadratName.toLowerCase()));
    const carryOverExisting: QuadratCsvRow[] = [];
    const unvalidatableExistingNames: string[] = [];
    for (const existingRow of existingQuadratList) {
      const storedName = String(existingRow.QuadratName ?? '').trim();
      if (storedName && incomingNamesLower.has(storedName.toLowerCase())) continue;

      const displayName = storedName || `(unnamed QuadratID ${existingRow.QuadratID})`;
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

    const incomingStartIndex = carryOverExisting.length;
    const revisionFatalIssues = validateQuadratCollectionDetailed(prospectiveLayout, plotBounds, CANONICAL_SOUTHWEST_CORNER).fatalIssues;
    const preExistingIssues = revisionFatalIssues.filter(issue => issue.rowIndex < incomingStartIndex);
    const introducedIssues = revisionFatalIssues.filter(issue => issue.rowIndex >= incomingStartIndex);
    if (preExistingIssues.length > 0) {
      ailogger.warn(
        `Plot ${plotID} has pre-existing quadrat layout defects not caused by this upload: ` +
          `${truncateAndJoin(
            preExistingIssues.map(issue => issue.message),
            ' '
          )}`
      );
    }
    const preExistingOverlapSummary = summarizeQuadratOverlaps(carryOverExisting);
    if (preExistingOverlapSummary) {
      ailogger.warn(
        `Plot ${plotID} has pre-existing quadrat layout defects not caused by this upload: ` +
          `${truncateAndJoin(
            preExistingOverlapSummary.pairs.map(pair => pair.message),
            ' '
          )}`
      );
    }

    const incomingRowSet = new Set<QuadratCsvRow>(normalizedIncoming);
    const sweepableLayout = prospectiveLayout.filter(row => row.dimensionX > 0 && row.dimensionY > 0);
    const introducedOverlapSummary = summarizeQuadratOverlaps(sweepableLayout, (a, b) => incomingRowSet.has(a) || incomingRowSet.has(b));

    const fatalIntroducedMessages = new Set<string>(introducedIssues.map(issue => issue.message));
    if (fatalIntroducedMessages.size > 0) {
      throw new QuadratGeometryValidationError(formatGeometryMessages([...fatalIntroducedMessages]));
    }
    requireOverlapAcknowledgment(introducedOverlapSummary);
  }

  const canonicalByName = new Map<string, QuadratCsvRow>();
  for (const row of normalizedIncoming) {
    canonicalByName.set(row.quadratName.toLowerCase(), row);
  }

  for (const row of rows) {
    const quadratName = normalizeRequiredString(row.quadrat);
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
