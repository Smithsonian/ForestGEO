import ConnectionManager from '@/config/connectionmanager';
import { HTTPResponses, InsertUpdateProcessingProps } from '@/config/macros';
import { FileRow, FileRowSet, FormType, normalizeSourceFormat, SourceFormat } from '@/config/macros/formdetails';
import { NextRequest, NextResponse } from 'next/server';
import { Plot } from '@/config/sqlrdsdefinitions/zones';
import { OrgCensus } from '@/config/sqlrdsdefinitions/timekeeping';
import { insertOrUpdate } from '@/components/processors/processorhelperfunctions';
import moment from 'moment/moment';
import { generateShortBatchID, handleUpsert } from '@/config/utils';
import { getCookie } from '@/app/actions/cookiemanager';
import ailogger from '@/ailogger';
import { auth } from '@/auth';
import { format } from 'mysql2/promise';
import { isValidSchema } from '@/config/utils/sqlsecurity';
import crypto from 'crypto';
import { insertIngestionFailureRows } from '@/config/measurementerrors';
import { requireUploadSessionOwnership, UploadSessionOwnershipError, UploadSessionState as TrackedUploadSessionState } from '@/config/uploadsessiontracker';
import { normalizeUploadMode, UploadMode } from '@/config/uploadmodes';
import { FamilyResult, GenusResult } from '@/config/sqlrdsdefinitions/taxonomies';
import { RoleResult } from '@/config/sqlrdsdefinitions/personnel';
import { getSessionUserId, requireSession } from '@/lib/auth-helpers';
import { ArcgisImportSessionError, loadArcgisImportRows } from '@/lib/arcgis/import-session';
import {
  buildDroppedMeasurementFailureReason,
  cleanupPreviousFileUploads,
  cleanupStaleMeasurementBatchesForFile,
  ensureTemporaryMeasurementsSourceFormatColumn,
  findDroppedMeasurementCandidates,
  insertTemporaryMeasurementsInBatches,
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

const MAX_ARCGIS_IMPORT_CHUNK_SIZE = 5000;

function toPositiveInteger(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function toNonNegativeInteger(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
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
}

function normalizeOptionalString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized === '' ? null : normalized;
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

function formatBlockedCleanReuploadValues(values: string[], maxValues: number = 20): string {
  const uniqueValues = Array.from(new Set(values.map(value => String(value ?? '').trim()).filter(Boolean))).sort((left, right) => left.localeCompare(right));

  const truncatedValues = uniqueValues.slice(0, maxValues);
  const remainingCount = uniqueValues.length - truncatedValues.length;
  return truncatedValues.join(', ') + (remainingCount > 0 ? `, ...and ${remainingCount} more` : '');
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
  transactionID: string
): Promise<FixedDataProcessingResult> {
  if (!plotID) {
    throw new Error('PlotID is required for quadrat uploads');
  }

  let insertedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;

  if (uploadMode === UploadMode.CLEAN_REUPLOAD) {
    // CLEAN_REUPLOAD deletes every active quadrat in the plot before re-inserting
    // the upload contents. Because stems references quadrats via ON DELETE CASCADE,
    // removing a quadrat that is already in use would also destroy its stems and
    // any downstream measurements, even if the same QuadratName appears again in
    // the upload. Only allow this path when the plot has no stems attached to any
    // active quadrat rows yet.
    const blockingQuadratSQL = format(
      `SELECT DISTINCT q.QuadratName
       FROM ??.quadrats q
       WHERE q.PlotID = ?
         AND q.IsActive = 1
         AND q.QuadratName IS NOT NULL
         AND EXISTS (
           SELECT 1
           FROM ??.stems s
           WHERE s.QuadratID = q.QuadratID
         )
       ORDER BY q.QuadratName`,
      [schema, schema]
    );
    const blockingQuadratRows = await connectionManager.executeQuery(blockingQuadratSQL, [plotID], transactionID);
    const blockingQuadratNames = Array.isArray(blockingQuadratRows)
      ? blockingQuadratRows.map((row: any) => String(row.QuadratName ?? '').trim()).filter(Boolean)
      : [];

    if (blockingQuadratNames.length > 0) {
      throw new Error(
        `Clean re-upload refused: active quadrat rows in plot ${plotID} are already referenced ` +
          `by stems for the following QuadratName value(s): ${formatBlockedCleanReuploadValues(blockingQuadratNames)}. ` +
          `Deleting quadrats would cascade-delete stems and downstream measurements even if the same names appear in the upload. ` +
          `Use Revisions Upload instead.`
      );
    }

    const deleteSQL = format(`DELETE FROM ??.quadrats WHERE PlotID = ? AND IsActive = 1`, [schema]);
    await connectionManager.executeQuery(deleteSQL, [plotID], transactionID);
  }

  for (const row of rows) {
    const quadratName = normalizeRequiredString(row.quadrat);
    if (!quadratName) {
      skippedCount += 1;
      continue;
    }

    const payload = {
      StartX: row.startx,
      StartY: row.starty,
      DimensionX: row.dimx,
      DimensionY: row.dimy,
      Area: row.area,
      QuadratShape: normalizeOptionalString(row.quadratshape)
    };

    if (uploadMode === UploadMode.REVISIONS) {
      const existingSQL = format(`SELECT QuadratID FROM ??.quadrats WHERE PlotID = ? AND LOWER(QuadratName) = LOWER(?) AND IsActive = 1 LIMIT 1`, [schema]);
      const existingRows = await connectionManager.executeQuery(existingSQL, [plotID, quadratName], transactionID);

      if (existingRows.length > 0) {
        const updateSQL = format(
          `UPDATE ??.quadrats
           SET QuadratName = ?, StartX = ?, StartY = ?, DimensionX = ?, DimensionY = ?, Area = ?, QuadratShape = ?, DeletedAt = NULL
           WHERE QuadratID = ?`,
          [schema]
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

    const insertSQL = format(
      `INSERT INTO ??.quadrats
       (PlotID, QuadratName, StartX, StartY, DimensionX, DimensionY, Area, QuadratShape, IsActive, DeletedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NULL)`,
      [schema]
    );
    await connectionManager.executeQuery(
      insertSQL,
      [plotID, quadratName, payload.StartX, payload.StartY, payload.DimensionX, payload.DimensionY, payload.Area, payload.QuadratShape],
      transactionID
    );
    insertedCount += 1;
  }

  return { insertedCount, updatedCount, skippedCount };
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
  const formType: string = body.formType;
  const sourceFormat = normalizeSourceFormat(body.sourceFormat ?? SourceFormat.csv);
  if (!sourceFormat) {
    return new NextResponse(
      JSON.stringify({
        responseMessage: 'Invalid source format',
        error: 'sourceFormat must be csv or arcgis_xlsx'
      }),
      { status: HTTPResponses.INVALID_REQUEST }
    );
  }
  if (sourceFormat === SourceFormat.arcgis_xlsx && formType !== FormType.measurements) {
    return new NextResponse(
      JSON.stringify({
        responseMessage: 'Invalid source format for form type',
        error: 'arcgis_xlsx sourceFormat is only valid for measurements uploads'
      }),
      { status: HTTPResponses.INVALID_REQUEST }
    );
  }
  const uploadMode = normalizeUploadMode(body.uploadMode);
  const plot: Plot = body.plot;
  const census: OrgCensus = body.census;
  const user: string = body.user;
  let fileRowSet: FileRowSet = body.fileRowSet ?? {};
  const fileName: string = body.fileName;
  let transactionID: string | undefined;
  const failingRows: Set<FileRow> = new Set<FileRow>();
  const connectionManager = ConnectionManager.getInstance();
  const maxRetries = 3;
  let retryCount = 0;
  if (formType === 'measurements') {
    let chunkRows = Object.values(fileRowSet ?? {});
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

    if (sourceFormat === SourceFormat.arcgis_xlsx) {
      const authenticatedUserId = getSessionUserId(session!);
      const importSessionId =
        typeof body.arcgisImportSessionId === 'string' && body.arcgisImportSessionId.trim() !== '' ? body.arcgisImportSessionId.trim() : null;
      const arcgisRowOffset = toNonNegativeInteger(body.arcgisRowOffset);
      const arcgisRowLimit = toPositiveInteger(body.arcgisRowLimit);

      if (!authenticatedUserId) {
        return new NextResponse(JSON.stringify({ responseMessage: 'Missing authenticated user identifier' }), { status: HTTPResponses.UNAUTHORIZED });
      }
      if (!importSessionId || arcgisRowOffset === null || arcgisRowLimit === null || arcgisRowLimit > MAX_ARCGIS_IMPORT_CHUNK_SIZE) {
        return new NextResponse(
          JSON.stringify({
            responseMessage: 'Invalid ArcGIS import chunk request',
            error: `ArcGIS uploads require importSessionId, non-negative row offset, and row limit <= ${MAX_ARCGIS_IMPORT_CHUNK_SIZE}`
          }),
          { status: HTTPResponses.INVALID_REQUEST }
        );
      }

      try {
        const loadedImportRows = await loadArcgisImportRows({
          schema,
          importSessionId,
          plotID: resolvedPlotID,
          censusID: resolvedCensusID,
          userId: authenticatedUserId,
          fileName,
          offset: arcgisRowOffset,
          limit: arcgisRowLimit
        });
        chunkRows = loadedImportRows.rows;
        fileRowSet = {};
        chunkRows.forEach((row, index) => {
          fileRowSet[`row-${arcgisRowOffset + index}`] = row;
        });
      } catch (error: unknown) {
        if (error instanceof ArcgisImportSessionError) {
          return new NextResponse(
            JSON.stringify({
              responseMessage: 'Invalid ArcGIS import session',
              error: error.message,
              fileName,
              batchID
            }),
            { status: error.status }
          );
        }
        throw error;
      }

      if (chunkRows.length === 0) {
        return new NextResponse(
          JSON.stringify({
            responseMessage: 'ArcGIS import chunk is empty',
            error: 'Requested ArcGIS import row range produced no rows',
            fileName,
            batchID
          }),
          { status: HTTPResponses.INVALID_REQUEST }
        );
      }
    }

    const rowCount = chunkRows.length;
    const contentHash = hashChunkContent(fileRowSet);
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
            idempotencyKey
          }),
          { status: HTTPResponses.OK }
        );
      } catch (e: any) {
        if (transactionID) {
          await connectionManager.rollbackTransaction(transactionID);
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
          fixedDataProcessingResult = await upsertQuadratRows(connectionManager, schema, plot?.plotID, uploadRows, uploadMode, transactionID);
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

        await connectionManager.commitTransaction(transactionID ?? '');
        transactionID = undefined;

        // Track file upload in unifiedchangelog (single row per file)
        try {
          const batchRowCount = Object.keys(fileRowSet).length;
          const censusID = census?.dateRanges?.[0]?.censusID;

          // Check if we've already logged this file upload - use format() for schema
          const existingEntrySQL = format(
            `SELECT ChangeID, NewRowState FROM ??.unifiedchangelog
             WHERE TableName = 'file_upload' AND RecordID = ? AND CensusID = ?
             ORDER BY ChangeID DESC LIMIT 1`,
            [schema]
          );
          const existingEntry = await connectionManager.executeQuery(existingEntrySQL, [fileName, censusID]);

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
              batchCount: 1
            });
            const insertChangelogSQL = format(
              `INSERT INTO ??.unifiedchangelog
              (TableName, RecordID, Operation, NewRowState, ChangeTimestamp, ChangedBy, PlotID, CensusID)
              VALUES (?, ?, ?, ?, NOW(), ?, ?, ?)`,
              [schema]
            );
            await connectionManager.executeQuery(insertChangelogSQL, ['file_upload', fileName, 'INSERT', uploadMetadata, user, plot?.plotID, censusID]);
          } else {
            // Subsequent batch - update the existing entry with accumulated count
            // Handle both string and already-parsed object (MySQL driver may auto-parse JSON columns)
            const metadata = typeof existingEntry[0].NewRowState === 'string' ? JSON.parse(existingEntry[0].NewRowState) : existingEntry[0].NewRowState;
            metadata.uploadMode = uploadMode;
            metadata.rowCount = (metadata.rowCount || 0) + batchRowCount;
            metadata.insertedCount = (metadata.insertedCount || 0) + fixedDataProcessingResult.insertedCount;
            metadata.updatedCount = (metadata.updatedCount || 0) + fixedDataProcessingResult.updatedCount;
            metadata.skippedCount = (metadata.skippedCount || 0) + fixedDataProcessingResult.skippedCount;
            metadata.batchCount = (metadata.batchCount || 1) + 1;
            const updateChangelogSQL = format(`UPDATE ??.unifiedchangelog SET NewRowState = ?, ChangeTimestamp = NOW() WHERE ChangeID = ?`, [schema]);
            await connectionManager.executeQuery(updateChangelogSQL, [JSON.stringify(metadata), existingEntry[0].ChangeID]);
          }
        } catch (logError: any) {
          // Log but don't fail the upload if changelog tracking fails
          ailogger.error('Failed to log file upload to changelog', logError);
        }

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
          await connectionManager.rollbackTransaction(transactionID);
          transactionID = undefined;
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
