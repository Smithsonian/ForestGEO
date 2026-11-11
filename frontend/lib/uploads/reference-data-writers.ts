/**
 * Reference-data writers for the fixed-data upload path (attributes, species, personnel).
 *
 * These live outside `app/api/sqlpacketload/route.ts` for two reasons: a Next.js
 * route module may only export route fields, so nothing else can import them
 * from there; and DB write logic does not belong in a request handler. The route
 * dispatches to them by formType; the provisioned-site lifecycle test seeds a
 * fresh schema through them so its reference data is written by production code
 * rather than parallel test SQL.
 */
import type ConnectionManager from '@/lib/db/connectionmanager';
import type { FileRow } from '@/config/macros/formdetails';
import { UploadMode } from '@/config/uploadmodes';
import { format } from 'mysql2/promise';
import { handleUpsert, toTxExecutor } from '@/config/utils';
import { FamilyResult, GenusResult } from '@/lib/db/definitions/taxonomies';
import { RoleResult } from '@/lib/db/definitions/personnel';
import type { QuadratOverlapSummary } from '@/lib/provisioning/quadrat-collection-validation';
import { claimReferenceTableReplacement, recordReferenceTableReplacement } from '@/lib/uploads/upload-session-replacement-marker';
import { recordMutation, ChangelogOperation } from '@/lib/changelog/record-mutation';
import { auditHandleUpsertResult, auditCensusActivePersonnelLink } from '@/lib/changelog/reference-audit';
import { buildInPlaceholders } from '@/lib/db/sqlsecurity';

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

export class ReferenceUploadValidationError extends Error {}

function findDuplicateCodes(rows: FileRow[], codeForRow: (row: FileRow) => unknown): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const row of rows) {
    const code = normalizeOptionalString(codeForRow(row))?.toLowerCase();
    if (!code) continue;
    if (seen.has(code)) {
      duplicates.add(code);
      continue;
    }
    seen.add(code);
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

/** One DELETE's IN (...) list per batch, bounding packet size for a long-lived table's accumulated rows. */
const DELETE_BATCH_SIZE = 1000;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) chunks.push(items.slice(start, start + size));
  return chunks;
}

/**
 * Deletes exactly the rows an earlier `SELECT ... FOR UPDATE` captured and
 * locked, by primary key (#507). An empty capture deletes nothing: no row
 * exists to delete, and running the SELECT's original WHERE as a standalone
 * DELETE would also match rows a concurrent transaction committed after the
 * capture, deleting them unaudited. Throws if the delete count doesn't match
 * what was captured.
 */
async function deleteCapturedRows(
  connectionManager: ConnectionManager,
  schema: string,
  tableName: string,
  whereSQL: string,
  whereParams: unknown[],
  keyColumn: string,
  capturedRows: Array<Record<string, unknown>>,
  transactionID: string
): Promise<void> {
  if (capturedRows.length === 0) return;
  const keyValues = capturedRows.map(row => row[keyColumn]);
  let deletedCount = 0;
  for (const batch of chunk(keyValues, DELETE_BATCH_SIZE)) {
    const deleteSQL = format(`DELETE FROM ??.${tableName} WHERE ${whereSQL} AND ${keyColumn} IN (${buildInPlaceholders(batch.length)})`, [schema]);
    const result = await connectionManager.executeQuery(deleteSQL, [...whereParams, ...batch], transactionID);
    deletedCount += result?.affectedRows ?? 0;
  }
  if (deletedCount !== capturedRows.length) {
    throw new Error(
      `Clean re-upload delete count mismatch for ${tableName}: locked ${capturedRows.length} row(s) by ${keyColumn} but deleted ${deletedCount}.`
    );
  }
}

export async function upsertAttributeRows(
  connectionManager: ConnectionManager,
  schema: string,
  rows: FileRow[],
  uploadMode: UploadMode,
  uploadSessionID: string | null,
  transactionID: string,
  changedBy: string
): Promise<FixedDataProcessingResult> {
  let insertedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  const tx = toTxExecutor(connectionManager, transactionID);

  const duplicateCodes = findDuplicateCodes(rows, row => row.code || row.codes);
  if (duplicateCodes.length > 0) {
    throw new ReferenceUploadValidationError(`Attribute upload contains duplicate Code values: ${truncateAndJoin(duplicateCodes, ', ')}`);
  }

  const replacesExistingRows = await claimReferenceTableReplacement(connectionManager, schema, uploadMode, uploadSessionID, transactionID);
  if (replacesExistingRows) {
    // FOR UPDATE: locks the active rows until commit, for deleteCapturedRows below.
    const activeRowsSQL = format(`SELECT * FROM ??.attributes WHERE IsActive = 1 FOR UPDATE`, [schema]);
    const activeRows = await connectionManager.executeQuery(activeRowsSQL, [], transactionID);

    await deleteCapturedRows(connectionManager, schema, 'attributes', 'IsActive = 1', [], 'Code', activeRows, transactionID);

    for (const deletedRow of activeRows) {
      await recordMutation({
        tx,
        schema,
        tableName: 'attributes',
        recordID: String(deletedRow.Code),
        operation: ChangelogOperation.DELETE,
        oldRowState: deletedRow,
        changedBy,
        plotID: null,
        censusID: null
      });
    }
  }

  // Rows can already be present when this request did not perform the reset: a
  // revisions upload, a later file of a session that already replaced the table,
  // or a retry of a request that committed after the client timed out. Matching
  // first makes all three idempotent instead of colliding with the unique key.
  const rowsMayAlreadyExist = !replacesExistingRows;

  for (const row of rows) {
    const code = normalizeRequiredString(row.code || row.codes);
    if (!code) {
      skippedCount += 1;
      continue;
    }

    const description = normalizeOptionalString(row.description || row.comments);
    const status = normalizeOptionalString(row.status);

    if (rowsMayAlreadyExist) {
      const existingSQL = format(`SELECT * FROM ??.attributes WHERE LOWER(Code) = LOWER(?) AND IsActive = 1 LIMIT 1 FOR UPDATE`, [schema]);
      const existingRows = await connectionManager.executeQuery(existingSQL, [code], transactionID);

      if (existingRows.length > 0) {
        const existingRow = existingRows[0];
        const updateSQL = format(`UPDATE ??.attributes SET Code = ?, Description = ?, Status = ?, DeletedAt = NULL WHERE Code = ? AND IsActive = 1`, [schema]);
        await connectionManager.executeQuery(updateSQL, [code, description, status, existingRow.Code], transactionID);
        updatedCount += 1;

        const noOpUpdate =
          existingRow.Code === code && existingRow.Description === description && existingRow.Status === status && existingRow.DeletedAt === null;
        if (!noOpUpdate) {
          await recordMutation({
            tx,
            schema,
            tableName: 'attributes',
            recordID: code,
            operation: ChangelogOperation.UPDATE,
            oldRowState: existingRow,
            newRowState: { ...existingRow, Code: code, Description: description, Status: status, DeletedAt: null },
            changedBy,
            plotID: null,
            censusID: null
          });
        }
        continue;
      }
    }

    const insertSQL = format(`INSERT INTO ??.attributes (Code, Description, Status, IsActive, DeletedAt) VALUES (?, ?, ?, 1, NULL)`, [schema]);
    await connectionManager.executeQuery(insertSQL, [code, description, status], transactionID);
    insertedCount += 1;
    await recordMutation({
      tx,
      schema,
      tableName: 'attributes',
      recordID: code,
      operation: ChangelogOperation.INSERT,
      newRowState: { Code: code, Description: description, Status: status, IsActive: 1, DeletedAt: null },
      changedBy,
      plotID: null,
      censusID: null
    });
  }

  if (replacesExistingRows) {
    await recordReferenceTableReplacement(connectionManager, schema, uploadSessionID, transactionID);
  }

  return { insertedCount, updatedCount, skippedCount };
}

export async function upsertSpeciesRows(
  connectionManager: ConnectionManager,
  schema: string,
  rows: FileRow[],
  uploadMode: UploadMode,
  uploadSessionID: string | null,
  transactionID: string,
  changedBy: string
): Promise<FixedDataProcessingResult> {
  let insertedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  const tx = toTxExecutor(connectionManager, transactionID);

  const duplicateSpeciesCodes = findDuplicateCodes(rows, row => row.spcode);
  if (duplicateSpeciesCodes.length > 0) {
    throw new Error(`Species upload contains duplicate SpeciesCode values: ${duplicateSpeciesCodes.join(', ')}`);
  }

  const replacesExistingRows = await claimReferenceTableReplacement(connectionManager, schema, uploadMode, uploadSessionID, transactionID);
  // See upsertAttributeRows: anything that is not this session's reset must match before writing.
  const rowsMayAlreadyExist = !replacesExistingRows;

  if (replacesExistingRows) {
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

    // FOR UPDATE: locks the active rows until commit, for deleteCapturedRows below.
    const activeSpeciesRowsSQL = format(`SELECT * FROM ??.species WHERE IsActive = 1 FOR UPDATE`, [schema]);
    const activeSpeciesRows = await connectionManager.executeQuery(activeSpeciesRowsSQL, [], transactionID);

    await deleteCapturedRows(connectionManager, schema, 'species', 'IsActive = 1', [], 'SpeciesID', activeSpeciesRows, transactionID);

    for (const deletedRow of activeSpeciesRows) {
      await recordMutation({
        tx,
        schema,
        tableName: 'species',
        recordID: Number(deletedRow.SpeciesID),
        operation: ChangelogOperation.DELETE,
        oldRowState: deletedRow,
        changedBy,
        plotID: null,
        censusID: null
      });
    }
  }

  for (const row of rows) {
    const speciesCode = normalizeRequiredString(row.spcode);
    if (!speciesCode) {
      skippedCount += 1;
      continue;
    }

    let familyID: number | undefined;
    if (normalizeOptionalString(row.family)) {
      const familyResult = await handleUpsert<FamilyResult>(
        connectionManager,
        schema,
        'family',
        { Family: normalizeOptionalString(row.family)! },
        'FamilyID',
        transactionID
      );
      familyID = familyResult.id;
      await auditHandleUpsertResult(connectionManager, schema, transactionID, 'family', 'FamilyID', familyResult, changedBy);
    }

    let genusID: number | undefined;
    if (normalizeOptionalString(row.genus)) {
      const genusPayload: Partial<GenusResult> = {
        Genus: normalizeOptionalString(row.genus)!
      };
      if (familyID) {
        genusPayload.FamilyID = familyID;
      }
      const genusResult = await handleUpsert<GenusResult>(connectionManager, schema, 'genus', genusPayload, 'GenusID', transactionID);
      genusID = genusResult.id;
      await auditHandleUpsertResult(connectionManager, schema, transactionID, 'genus', 'GenusID', genusResult, changedBy);
    }

    const speciesPayload = {
      GenusID: genusID ?? null,
      SpeciesName: normalizeOptionalString(row.species),
      SubspeciesName: normalizeOptionalString(row.subspecies),
      IDLevel: normalizeOptionalString(row.idlevel),
      SpeciesAuthority: normalizeOptionalString(row.authority),
      SubspeciesAuthority: normalizeOptionalString(row.subauthority)
    };

    if (rowsMayAlreadyExist) {
      const existingSQL = format(`SELECT * FROM ??.species WHERE LOWER(SpeciesCode) = LOWER(?) AND IsActive = 1 ORDER BY SpeciesID FOR UPDATE`, [schema]);
      const existingRows = await connectionManager.executeQuery(existingSQL, [speciesCode], transactionID);

      if (existingRows.length > 1) {
        throw new Error(`Duplicate active species rows already exist for SpeciesCode "${speciesCode}". Remove the duplicates before re-uploading.`);
      }

      if (existingRows.length > 0) {
        const existingRow = existingRows[0];
        // Source-of-truth semantics (revisions, and every file after the one that
        // performed this session's reset): every column that the species upload
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
            existingRow.SpeciesID
          ],
          transactionID
        );
        updatedCount += 1;

        const newRow = {
          ...existingRow,
          SpeciesCode: speciesCode,
          GenusID: speciesPayload.GenusID,
          SpeciesName: speciesPayload.SpeciesName,
          SubspeciesName: speciesPayload.SubspeciesName,
          IDLevel: speciesPayload.IDLevel,
          SpeciesAuthority: speciesPayload.SpeciesAuthority,
          SubspeciesAuthority: speciesPayload.SubspeciesAuthority,
          DeletedAt: null
        };
        const noOpUpdate =
          existingRow.SpeciesCode === speciesCode &&
          existingRow.GenusID === speciesPayload.GenusID &&
          existingRow.SpeciesName === speciesPayload.SpeciesName &&
          existingRow.SubspeciesName === speciesPayload.SubspeciesName &&
          existingRow.IDLevel === speciesPayload.IDLevel &&
          existingRow.SpeciesAuthority === speciesPayload.SpeciesAuthority &&
          existingRow.SubspeciesAuthority === speciesPayload.SubspeciesAuthority &&
          existingRow.DeletedAt === null;
        if (!noOpUpdate) {
          await recordMutation({
            tx,
            schema,
            tableName: 'species',
            recordID: existingRow.SpeciesID,
            operation: ChangelogOperation.UPDATE,
            oldRowState: existingRow,
            newRowState: newRow,
            changedBy,
            plotID: null,
            censusID: null
          });
        }
        continue;
      }
    }

    const insertSQL = format(
      `INSERT INTO ??.species
       (GenusID, SpeciesCode, SpeciesName, SubspeciesName, IDLevel, SpeciesAuthority, SubspeciesAuthority, IsActive, DeletedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, NULL)`,
      [schema]
    );
    const insertResult = await connectionManager.executeQuery(
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
    if (!insertResult?.insertId) {
      throw new Error(`Species insert for SpeciesCode "${speciesCode}" did not return an insertId; cannot audit the new row.`);
    }
    const speciesID = Number(insertResult.insertId);
    await recordMutation({
      tx,
      schema,
      tableName: 'species',
      recordID: speciesID,
      operation: ChangelogOperation.INSERT,
      newRowState: { SpeciesID: speciesID, SpeciesCode: speciesCode, ...speciesPayload, IsActive: 1, DeletedAt: null },
      changedBy,
      plotID: null,
      censusID: null
    });
    insertedCount += 1;
  }

  if (replacesExistingRows) {
    await recordReferenceTableReplacement(connectionManager, schema, uploadSessionID, transactionID);
  }

  return { insertedCount, updatedCount, skippedCount };
}

/**
 * Personnel is a reference table like species and attributes: a CLEAN_REUPLOAD
 * clears the census's active roster before writing the incoming rows. It lived in
 * the route handler until #472; DB write logic belongs beside its siblings, where
 * the writer-level tests can reach it.
 */
export async function upsertPersonnelRows(
  connectionManager: ConnectionManager,
  schema: string,
  censusID: number | undefined,
  rows: FileRow[],
  uploadMode: UploadMode,
  uploadSessionID: string | null,
  transactionID: string,
  changedBy: string
): Promise<FixedDataProcessingResult> {
  if (!censusID) {
    throw new Error('CensusID is required for personnel uploads');
  }

  let insertedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  const tx = toTxExecutor(connectionManager, transactionID);

  const replacesExistingRows = await claimReferenceTableReplacement(connectionManager, schema, uploadMode, uploadSessionID, transactionID);
  // See upsertAttributeRows: anything that is not this session's reset must match before writing.
  const rowsMayAlreadyExist = !replacesExistingRows;

  if (replacesExistingRows) {
    // FOR UPDATE: locks this census's links until commit, for deleteCapturedRows below.
    const activeCapRowsSQL = format(`SELECT * FROM ??.censusactivepersonnel WHERE CensusID = ? FOR UPDATE`, [schema]);
    const activeCapRows = await connectionManager.executeQuery(activeCapRowsSQL, [censusID], transactionID);

    await deleteCapturedRows(connectionManager, schema, 'censusactivepersonnel', 'CensusID = ?', [censusID], 'CAPID', activeCapRows, transactionID);
    for (const deletedCapRow of activeCapRows) {
      await recordMutation({
        tx,
        schema,
        tableName: 'censusactivepersonnel',
        recordID: Number(deletedCapRow.CAPID),
        operation: ChangelogOperation.DELETE,
        oldRowState: deletedCapRow,
        changedBy,
        plotID: null,
        censusID
      });
    }

    // Personnel orphaned by the cap delete above (no link left in ANY census).
    // Selected after that delete, before this one, so the changelog records
    // the row as it actually existed. FOR UPDATE locks the candidates.
    const orphanedPersonnelSQL = format(
      `SELECT p.* FROM ??.personnel p
       LEFT JOIN ??.censusactivepersonnel cap ON cap.PersonnelID = p.PersonnelID
       WHERE cap.PersonnelID IS NULL AND p.IsActive = 1
       FOR UPDATE`,
      [schema, schema]
    );
    const orphanedPersonnelRows = await connectionManager.executeQuery(orphanedPersonnelSQL, [], transactionID);

    // Not deleteCapturedRows: "orphaned" is a join condition, not a single-table
    // WHERE. Same exact-ID bounding; empty capture deletes nothing.
    if (orphanedPersonnelRows.length > 0) {
      const orphanedPersonnelIDs = orphanedPersonnelRows.map((row: Record<string, unknown>) => row.PersonnelID);
      let orphanedDeletedCount = 0;
      for (const batch of chunk(orphanedPersonnelIDs, DELETE_BATCH_SIZE)) {
        const deleteOrphanedSQL = format(
          `DELETE p FROM ??.personnel p
           LEFT JOIN ??.censusactivepersonnel cap ON cap.PersonnelID = p.PersonnelID
           WHERE cap.PersonnelID IS NULL AND p.IsActive = 1 AND p.PersonnelID IN (${buildInPlaceholders(batch.length)})`,
          [schema, schema]
        );
        const deleteOrphanedResult = await connectionManager.executeQuery(deleteOrphanedSQL, batch, transactionID);
        orphanedDeletedCount += deleteOrphanedResult?.affectedRows ?? 0;
      }
      if (orphanedDeletedCount !== orphanedPersonnelRows.length) {
        throw new Error(
          `Clean re-upload delete count mismatch for personnel: locked ${orphanedPersonnelRows.length} orphaned row(s) but deleted ${orphanedDeletedCount}.`
        );
      }
    }
    for (const deletedPersonnelRow of orphanedPersonnelRows) {
      await recordMutation({
        tx,
        schema,
        tableName: 'personnel',
        recordID: Number(deletedPersonnelRow.PersonnelID),
        operation: ChangelogOperation.DELETE,
        oldRowState: deletedPersonnelRow,
        changedBy,
        plotID: null,
        censusID
      });
    }
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

    const roleResult = await handleUpsert<RoleResult>(
      connectionManager,
      schema,
      'roles',
      {
        RoleName: normalizedRole,
        RoleDescription: roleDescription
      },
      'RoleID',
      transactionID
    );
    const roleID = roleResult.id;
    await auditHandleUpsertResult(connectionManager, schema, transactionID, 'roles', 'RoleID', roleResult, changedBy);

    if (rowsMayAlreadyExist) {
      const existingSQL = format(
        `SELECT p.* FROM ??.personnel p
         WHERE LOWER(p.FirstName) = LOWER(?) AND LOWER(p.LastName) = LOWER(?) AND p.IsActive = 1
         LIMIT 1
         FOR UPDATE`,
        [schema]
      );
      const existingRows = await connectionManager.executeQuery(existingSQL, [firstName, lastName], transactionID);

      if (existingRows.length > 0) {
        const existingRow = existingRows[0];
        const personnelID = Number(existingRow.PersonnelID);
        const updateSQL = format(`UPDATE ??.personnel SET FirstName = ?, LastName = ?, RoleID = ?, DeletedAt = NULL WHERE PersonnelID = ?`, [schema]);
        await connectionManager.executeQuery(updateSQL, [firstName, lastName, roleID, personnelID], transactionID);
        await auditCensusActivePersonnelLink(connectionManager, schema, transactionID, censusID, personnelID, changedBy);
        updatedCount += 1;

        const noOpUpdate =
          existingRow.FirstName === firstName && existingRow.LastName === lastName && existingRow.RoleID === roleID && existingRow.DeletedAt === null;
        if (!noOpUpdate) {
          await recordMutation({
            tx,
            schema,
            tableName: 'personnel',
            recordID: personnelID,
            operation: ChangelogOperation.UPDATE,
            oldRowState: existingRow,
            newRowState: { ...existingRow, FirstName: firstName, LastName: lastName, RoleID: roleID, DeletedAt: null },
            changedBy,
            plotID: null,
            censusID
          });
        }
        continue;
      }
    }

    const insertSQL = format(`INSERT INTO ??.personnel (FirstName, LastName, RoleID, IsActive, DeletedAt) VALUES (?, ?, ?, 1, NULL)`, [schema]);
    const insertResult = await connectionManager.executeQuery(insertSQL, [firstName, lastName, roleID], transactionID);
    if (!insertResult?.insertId) {
      throw new Error(`Personnel insert for "${firstName} ${lastName}" did not return an insertId; cannot audit the new row.`);
    }
    const personnelID = Number(insertResult.insertId);
    await auditCensusActivePersonnelLink(connectionManager, schema, transactionID, censusID, personnelID, changedBy);
    await recordMutation({
      tx,
      schema,
      tableName: 'personnel',
      recordID: personnelID,
      operation: ChangelogOperation.INSERT,
      newRowState: { PersonnelID: personnelID, FirstName: firstName, LastName: lastName, RoleID: roleID, IsActive: 1, DeletedAt: null },
      changedBy,
      plotID: null,
      censusID
    });
    insertedCount += 1;
  }

  if (replacesExistingRows) {
    await recordReferenceTableReplacement(connectionManager, schema, uploadSessionID, transactionID);
  }

  return { insertedCount, updatedCount, skippedCount };
}
