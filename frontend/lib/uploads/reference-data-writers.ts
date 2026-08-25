/**
 * Reference-data writers for the fixed-data upload path (attributes, species).
 *
 * These live outside `app/api/sqlpacketload/route.ts` for two reasons: a Next.js
 * route module may only export route fields, so nothing else can import them
 * from there; and DB write logic does not belong in a request handler. The route
 * dispatches to them by formType; the provisioned-site lifecycle test seeds a
 * fresh schema through them so its reference data is written by production code
 * rather than parallel test SQL.
 *
 * Moved verbatim from the route — no behavior change.
 */
import type ConnectionManager from '@/lib/db/connectionmanager';
import type { FileRow } from '@/config/macros/formdetails';
import { UploadMode } from '@/config/uploadmodes';
import { format } from 'mysql2/promise';
import { handleUpsert } from '@/config/utils';
import { FamilyResult, GenusResult } from '@/lib/db/definitions/taxonomies';
import type { QuadratOverlapSummary } from '@/lib/provisioning/quadrat-collection-validation';

export interface FixedDataProcessingResult {
  insertedCount: number;
  updatedCount: number;
  skippedCount: number;
  // Quadrat uploads only: bounded overlap reports plus complete layout signatures explicitly
  // acknowledged as field measurements and recorded in the file changelog.
  acknowledgedOverlapSummaries?: QuadratOverlapSummary[];
}

export function normalizeOptionalString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized === '' ? null : normalized;
}

export function normalizeRequiredString(value: unknown): string {
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

/** Shared cap for every user-facing list of blocked values / validation issues, so a
 *  single bad file (hundreds of blocked names, hundreds of failed rows) cannot produce an
 *  unbounded run-on error message. */
export const MAX_LISTED_ISSUES = 20;

/** Joins `items` with `separator`, truncating at `maxItems` and appending an "...and N more"
 *  tail instead of listing everything, so there is one truncation style, not one per caller. */
export function truncateAndJoin(items: string[], separator: string, maxItems: number = MAX_LISTED_ISSUES): string {
  const truncatedItems = items.slice(0, maxItems);
  const remainingCount = items.length - truncatedItems.length;
  return truncatedItems.join(separator) + (remainingCount > 0 ? `${separator}...and ${remainingCount} more` : '');
}

function formatBlockedCleanReuploadValues(values: string[], maxValues: number = MAX_LISTED_ISSUES): string {
  const uniqueValues = Array.from(new Set(values.map(value => String(value ?? '').trim()).filter(Boolean))).sort((left, right) => left.localeCompare(right));
  return truncateAndJoin(uniqueValues, ', ', maxValues);
}

export async function upsertAttributeRows(
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

export async function upsertSpeciesRows(
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
