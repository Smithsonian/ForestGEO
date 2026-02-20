import ConnectionManager from '@/config/connectionmanager';
import { HTTPResponses, InsertUpdateProcessingProps, SpecialBulkProcessingProps } from '@/config/macros';
import { FileRow, FileRowSet } from '@/config/macros/formdetails';
import { NextRequest, NextResponse } from 'next/server';
import { Plot, QuadratResult } from '@/config/sqlrdsdefinitions/zones';
import { OrgCensus } from '@/config/sqlrdsdefinitions/timekeeping';
import { insertOrUpdate } from '@/components/processors/processorhelperfunctions';
import moment from 'moment/moment';
import { buildBulkUpsertQuery, generateShortBatchID } from '@/config/utils';
import { AttributesResult } from '@/config/sqlrdsdefinitions/core';
import { processBulkSpecies } from '@/components/processors/processbulkspecies';
import { getCookie } from '@/app/actions/cookiemanager';
import ailogger from '@/ailogger';
import { auth } from '@/auth';
import { format } from 'mysql2/promise';
import { isValidSchema } from '@/config/utils/sqlsecurity';
import crypto from 'crypto';
import { insertIngestionFailureRows } from '@/config/measurementerrors';

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

function toNullableNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  // Authentication check
  const session = await auth();
  if (!session?.user) {
    ailogger.warn('Unauthorized upload attempt - no session');
    return new NextResponse(
      JSON.stringify({
        responseMessage: 'Unauthorized - authentication required',
        error: 'You must be logged in to upload data'
      }),
      { status: HTTPResponses.UNAUTHORIZED }
    );
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
  const plot: Plot = body.plot;
  const census: OrgCensus = body.census;
  const censusCookie = Number((await getCookie('censusID')) ?? census?.dateRanges?.[0]?.censusID ?? -1);
  const user: string = body.user;
  const fileRowSet: FileRowSet = body.fileRowSet;
  const fileName: string = body.fileName;
  let transactionID: string | undefined;
  const failingRows: Set<FileRow> = new Set<FileRow>();
  const connectionManager = ConnectionManager.getInstance();
  const maxRetries = 3;
  let retryCount = 0;
  if (formType === 'measurements') {
    const rowCount = Object.keys(fileRowSet ?? {}).length;
    const contentHash = hashChunkContent(fileRowSet);
    const idempotencyKey = generateIdempotencyKey(fileName, plot?.plotID ?? -1, censusCookie, rowCount, contentHash);

    // DUPLICATE DETECTION: Check for exact content match using sample data from the chunk
    // Checks first, middle, and last rows to increase detection accuracy while minimizing DB queries
    // This prevents false negatives where first/last match but middle differs (different chunks)
    try {
      const chunkRows = Object.values(fileRowSet);
      if (chunkRows.length > 0) {
        // Select sample rows: first, middle, and last for comprehensive coverage
        const firstRow = chunkRows[0];
        const lastRow = chunkRows[chunkRows.length - 1];
        const middleRow = chunkRows.length >= 3 ? chunkRows[Math.floor(chunkRows.length / 2)] : null;

        // Build a query to check for these specific rows
        const duplicateCheckSQL = format(
          `SELECT COUNT(*) as matchCount FROM ??.temporarymeasurements
           WHERE FileID = ? AND PlotID = ? AND CensusID = ?
           AND TreeTag = ? AND StemTag <=> ? AND SpeciesCode = ? AND QuadratName = ?
           AND LocalX <=> ? AND LocalY <=> ? AND DBH <=> ? AND MeasurementDate <=> ?`,
          [schema]
        );

        // Helper function to check a single row
        const checkRowExists = async (row: FileRow): Promise<boolean> => {
          const formattedDate = row.date ? moment(row.date).format('YYYY-MM-DD') : null;
          const result = await connectionManager.executeQuery(duplicateCheckSQL, [
            fileName,
            plot?.plotID ?? -1,
            censusCookie,
            row.tag,
            row.stemtag || null,
            row.spcode,
            row.quadrat,
            row.lx || null,
            row.ly || null,
            row.dbh || null,
            formattedDate
          ]);
          return result[0]?.matchCount > 0;
        };

        // Check all sample rows in parallel for efficiency
        const checksToPerform = [checkRowExists(firstRow), checkRowExists(lastRow)];
        if (middleRow) {
          checksToPerform.push(checkRowExists(middleRow));
        }

        const [firstExists, lastExists, middleExists] = await Promise.all(checksToPerform);

        // Require ALL checked rows to exist for duplicate detection
        // This reduces false positives while catching true duplicates
        const allCheckedRowsExist = middleRow ? firstExists && lastExists && middleExists : firstExists && lastExists;

        if (allCheckedRowsExist) {
          const rowsChecked = middleRow ? 'first, middle, and last' : 'first and last';
          ailogger.info(
            `Duplicate chunk detected for ${fileName} - ${rowsChecked} rows already exist in database. ` +
              `Content hash: ${contentHash}. Idempotency key: ${idempotencyKey}. Skipping to prevent data duplication.`
          );
          return new NextResponse(
            JSON.stringify({
              responseMessage: `Chunk already exists - duplicate submission detected`,
              failingRows: [],
              insertedCount: rowCount,
              transactionCompleted: true,
              batchID: 'duplicate-skipped',
              isDuplicate: true,
              idempotencyKey,
              contentHash
            }),
            { status: HTTPResponses.OK }
          );
        }
      }
    } catch (dupCheckError: any) {
      // Log but continue - better to potentially duplicate than to fail entirely
      ailogger.warn(`Content-based idempotency check failed for ${fileName}, proceeding with insert: ${dupCheckError.message}`);
    }

    const batchID = generateShortBatchID();
    const placeholders = Object.values(fileRowSet ?? [])
      .map(() => `(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .join(', ');
    const values = Object.values(fileRowSet ?? []).flatMap(row => {
      const { tag, stemtag, spcode, quadrat, lx, ly, dbh, hom, date, codes, comments } = row;
      const formattedDate = date ? moment(date).format('YYYY-MM-DD') : date;
      // Convert empty/non-numeric coordinate strings to null so MySQL stores NULL instead of 0
      const parsedLx = lx !== undefined && lx !== null && lx !== '' && !isNaN(Number(lx)) ? Number(lx) : null;
      const parsedLy = ly !== undefined && ly !== null && ly !== '' && !isNaN(Number(ly)) ? Number(ly) : null;
      return [fileName, batchID, plot?.plotID ?? -1, censusCookie, tag, stemtag, spcode, quadrat, parsedLx, parsedLy, dbh, hom, formattedDate, codes, comments];
    });
    // Retry logic for database operations
    while (retryCount <= maxRetries) {
      try {
        transactionID = await connectionManager.beginTransaction();

        // Use format() for safe identifier escaping (schema + table name)
        const insertSQL = format(
          `INSERT IGNORE INTO ??.temporarymeasurements
        (FileID, BatchID, PlotID, CensusID, TreeTag, StemTag, SpeciesCode, QuadratName, LocalX, LocalY, DBH, HOM, MeasurementDate, Codes, Comments)
        VALUES ${placeholders}`,
          [schema]
        );

        await connectionManager.executeQuery(insertSQL, values, transactionID);

        // CRITICAL FIX: Verify expected vs actual row count to detect silent data loss from INSERT IGNORE
        const expectedRowCount = Object.keys(fileRowSet ?? {}).length;
        const countSQL = format(`SELECT COUNT(*) as count FROM ??.temporarymeasurements WHERE FileID = ? AND BatchID = ?`, [schema]);
        const countResult = await connectionManager.executeQuery(countSQL, [fileName, batchID], transactionID);
        const actualInsertedCount = countResult[0]?.count || 0;

        // Check for discrepancy - this would indicate INSERT IGNORE silently dropped rows
        const droppedRowCount = expectedRowCount - actualInsertedCount;

        if (droppedRowCount > 0) {
          ailogger.error(
            `DATA INTEGRITY WARNING: Expected ${expectedRowCount} rows but only ${actualInsertedCount} were inserted for ${fileName}-${batchID}. ` +
              `${droppedRowCount} row(s) were silently dropped by INSERT IGNORE (likely duplicates). This indicates potential data loss!`
          );

          // Try to identify which rows were dropped by checking what's NOT in the temp table
          // This is expensive but necessary to track data integrity issues
          const droppedRows: FileRow[] = [];
          const chunkRows = Object.values(fileRowSet);

          for (const row of chunkRows) {
            const formattedDate = row.date ? moment(row.date).format('YYYY-MM-DD') : null;
            const checkSQL = format(
              `SELECT COUNT(*) as cnt FROM ??.temporarymeasurements
               WHERE FileID = ? AND BatchID = ? AND TreeTag = ? AND StemTag <=> ?
               AND SpeciesCode = ? AND QuadratName = ? AND MeasurementDate <=> ?`,
              [schema]
            );
            const checkResult = await connectionManager.executeQuery(
              checkSQL,
              [
                fileName,
                batchID,
                row.tag,
                row.stemtag || null,
                row.spcode,
                row.quadrat,
                formattedDate
              ],
              transactionID
            );

            if (checkResult[0]?.cnt === 0) {
              // This row was dropped - try to identify the specific reason
              let failureReason = 'Row dropped by INSERT IGNORE';

              // Check if there's a duplicate row with same key fields in this file (different batch)
              const duplicateCheckSQL = format(
                `SELECT BatchID, TreeTag, StemTag, QuadratName FROM ??.temporarymeasurements
                 WHERE FileID = ? AND PlotID = ? AND CensusID = ?
                 AND TreeTag = ? AND StemTag <=> ? AND QuadratName = ?
                 LIMIT 1`,
                [schema]
              );
              const dupResult = await connectionManager.executeQuery(
                duplicateCheckSQL,
                [fileName, plot?.plotID ?? -1, censusCookie, row.tag, row.stemtag || null, row.quadrat],
                transactionID
              );

              if (dupResult.length > 0) {
                const existingBatch = dupResult[0].BatchID;
                failureReason = `Duplicate row: TreeTag=${row.tag}, StemTag=${row.stemtag || 'null'}, Quadrat=${row.quadrat} already exists in batch ${existingBatch}`;
              } else {
                // Check for data validation issues
                const issues: string[] = [];
                if (!row.tag || row.tag.trim() === '') issues.push('empty TreeTag');
                if (!row.spcode || row.spcode.trim() === '') issues.push('empty SpeciesCode');
                if (!row.quadrat || row.quadrat.trim() === '') issues.push('empty QuadratName');
                if (row.dbh !== undefined && row.dbh !== null && (isNaN(Number(row.dbh)) || Number(row.dbh) < 0)) issues.push(`invalid DBH value: ${row.dbh}`);
                if (row.hom !== undefined && row.hom !== null && (isNaN(Number(row.hom)) || Number(row.hom) < 0)) issues.push(`invalid HOM value: ${row.hom}`);
                if (row.lx !== undefined && row.lx !== null && isNaN(Number(row.lx))) issues.push(`invalid LocalX value: ${row.lx}`);
                if (row.ly !== undefined && row.ly !== null && isNaN(Number(row.ly))) issues.push(`invalid LocalY value: ${row.ly}`);

                if (issues.length > 0) {
                  failureReason = `Data validation failed: ${issues.join('; ')}`;
                } else {
                  failureReason = `Row dropped by INSERT IGNORE - possible constraint violation (Tag=${row.tag}, Quadrat=${row.quadrat}, Date=${formattedDate})`;
                }
              }

              droppedRows.push({
                ...row,
                failureReason
              });
            }
          }

          // Persist dropped rows as unresolved ingestion errors in coremeasurements.
          if (droppedRows.length > 0) {
            try {
              await insertIngestionFailureRows(
                connectionManager,
                schema,
                droppedRows.map((row, idx) => ({
                  plotID: plot?.plotID ?? -1,
                  censusID: censusCookie,
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
                  sourceRowIndex: idx + 1,
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
                  droppedRows.map((row, idx) => ({
                    plotID: plot?.plotID ?? -1,
                    censusID: censusCookie,
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
                    sourceRowIndex: idx + 1,
                    failureReason: row.failureReason || 'Unknown error during insert'
                  })),
                  transactionID
                );
                ailogger.info(`Retry successful: persisted ${droppedRows.length} dropped rows as unresolved ingestion errors for ${fileName}-${batchID}`);
              } catch (retryError: any) {
                ailogger.error(`Failed to persist dropped rows as unresolved ingestion errors (attempt 2): ${retryError.message}`);

                // Critical: log to uploadintegrityalerts so data loss is not silent.
                try {
                  const alertSQL = format(
                    `INSERT INTO ??.uploadintegrityalerts
                     (fileID, batchID, plotID, censusID, type, message, severity, failedRecords)
                     VALUES (?, ?, ?, ?, 'FAILED_INSERT_TO_UNRESOLVED_COREMEASUREMENTS', ?, 'critical', ?)`,
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
                    [fileName, batchID, plot?.plotID ?? -1, censusCookie, alertMessage, droppedRows.length],
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
          const existingEntry = await connectionManager.executeQuery(existingEntrySQL, [fileName, censusCookie], transactionID);

          if (existingEntry.length === 0) {
            // First batch for this file - insert new entry
            const uploadMetadata = JSON.stringify({
              fileName,
              formType,
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
              ['file_upload', fileName, 'INSERT', uploadMetadata, user, plot?.plotID, censusCookie],
              transactionID
            );
          } else {
            // Subsequent batch - update the existing entry with accumulated count
            // Handle both string and already-parsed object (MySQL driver may auto-parse JSON columns)
            const metadata = typeof existingEntry[0].NewRowState === 'string' ? JSON.parse(existingEntry[0].NewRowState) : existingEntry[0].NewRowState;
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
            idempotencyKey
          }),
          { status: HTTPResponses.OK }
        );
      } catch (e: any) {
        if (transactionID) {
          await connectionManager.rollbackTransaction(transactionID);
        }

        retryCount++;
        const isRetryableError =
          e.message?.includes('Lock wait timeout') ||
          e.message?.includes('Deadlock') ||
          e.message?.includes('Connection lost') ||
          e.message?.includes('server has gone away') ||
          e.code === 'PROTOCOL_CONNECTION_LOST' ||
          e.code === 'ECONNRESET';

        if (isRetryableError && retryCount <= maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, retryCount - 1), 10000); // Exponential backoff, max 10s
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
    transactionID = await connectionManager.beginTransaction();
    let rowId = '';
    try {
      if (formType === 'quadrats') {
        const bulkQuadrats = Object.values(fileRowSet).map(
          row =>
            ({
              QuadratName: row.quadrat,
              PlotID: plot?.plotID,
              StartX: row.startx,
              StartY: row.starty,
              DimensionX: row.dimx,
              DimensionY: row.dimy,
              Area: row.area,
              QuadratShape: row.quadratshape
            }) as Partial<QuadratResult>
        );
        const { sql, params } = buildBulkUpsertQuery<QuadratResult>(schema, 'quadrats', bulkQuadrats, 'QuadratID');
        await connectionManager.executeQuery(sql, params, transactionID);
      } else if (formType === 'attributes') {
        const bulkAttributes = Object.values(fileRowSet).map(
          row =>
            ({
              // Handle both original and transformed header names (client transforms code->codes, description->comments)
              Code: row.code || row.codes,
              Description: row.description || row.comments,
              // Convert empty string to null - ENUM columns don't accept empty strings
              Status: row.status && row.status.trim() !== '' ? row.status : null
            }) as Partial<AttributesResult>
        );
        const { sql, params } = buildBulkUpsertQuery<AttributesResult>(schema, 'attributes', bulkAttributes, 'Code');
        await connectionManager.executeQuery(sql, params, transactionID);
      } else if (formType === 'species') {
        const bulkProps: SpecialBulkProcessingProps = {
          schema,
          connectionManager,
          rowDataSet: fileRowSet,
          census: census
        };
        await processBulkSpecies(bulkProps);
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
          } catch (e: any) {
            ailogger.error(`Error processing row for file ${fileName}:`, e.message);
            failingRows.add(row); // saving this for future processing
          }
        }
      }

      await connectionManager.commitTransaction(transactionID ?? '');

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
            rowCount: batchRowCount,
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
          metadata.rowCount = (metadata.rowCount || 0) + batchRowCount;
          metadata.batchCount = (metadata.batchCount || 1) + 1;
          const updateChangelogSQL = format(`UPDATE ??.unifiedchangelog SET NewRowState = ?, ChangeTimestamp = NOW() WHERE ChangeID = ?`, [schema]);
          await connectionManager.executeQuery(updateChangelogSQL, [JSON.stringify(metadata), existingEntry[0].ChangeID]);
        }
      } catch (logError: any) {
        // Log but don't fail the upload if changelog tracking fails
        ailogger.error('Failed to log file upload to changelog', logError);
      }
    } catch (error: any) {
      await connectionManager.rollbackTransaction(transactionID ?? '');
      ailogger.error('CATASTROPHIC ERROR: sqlpacketload: transaction rolled back.');
      ailogger.error(`Row ${rowId} failed processing:`, error);
      if (error instanceof Error) {
        ailogger.error(`Error processing row for file ${fileName}:`, error);
        return new NextResponse(
          JSON.stringify({
            responseMessage: `Error processing row in file ${fileName}`,
            error: error.message,
            failingRows: Array.from(failingRows)
          }),
          { status: HTTPResponses.SERVICE_UNAVAILABLE }
        );
      } else {
        ailogger.error('Unknown error processing row:', error);
        return new NextResponse(
          JSON.stringify({
            responseMessage: `Unknown processing error at row, in file ${fileName}`,
            failingRows: Array.from(failingRows)
          }),
          { status: HTTPResponses.SERVICE_UNAVAILABLE }
        );
      }
    }
    return new NextResponse(
      JSON.stringify({
        responseMessage: `Bulk insert to SQL completed`,
        failingRows: Array.from(failingRows),
        transactionCompleted: true
      }),
      { status: HTTPResponses.OK }
    );
  }
}
