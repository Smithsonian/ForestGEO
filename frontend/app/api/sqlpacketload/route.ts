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

interface DroppedMeasurementCandidate {
  rowOrdinal: number;
  existingBatch: string | null;
}

type DroppedMeasurementRow = FileRow & {
  failureReason: string;
  sourceRowIndex: number;
};

function normalizeMeasurementDate(value: unknown): string | null {
  return value ? moment(value).format('YYYY-MM-DD') : null;
}

function collectMeasurementValidationIssues(row: FileRow): string[] {
  const issues: string[] = [];
  if (!row.tag || row.tag.trim() === '') issues.push('empty TreeTag');
  if (!row.spcode || row.spcode.trim() === '') issues.push('empty SpeciesCode');
  if (!row.quadrat || row.quadrat.trim() === '') issues.push('empty QuadratName');
  if (row.dbh !== undefined && row.dbh !== null && (isNaN(Number(row.dbh)) || Number(row.dbh) < 0)) issues.push(`invalid DBH value: ${row.dbh}`);
  if (row.hom !== undefined && row.hom !== null && (isNaN(Number(row.hom)) || Number(row.hom) < 0)) issues.push(`invalid HOM value: ${row.hom}`);
  if (row.lx !== undefined && row.lx !== null && isNaN(Number(row.lx))) issues.push(`invalid LocalX value: ${row.lx}`);
  if (row.ly !== undefined && row.ly !== null && isNaN(Number(row.ly))) issues.push(`invalid LocalY value: ${row.ly}`);
  return issues;
}

function buildDroppedMeasurementFailureReason(row: FileRow, existingBatch: string | null): string {
  if (existingBatch) {
    return `Duplicate row: TreeTag=${row.tag}, StemTag=${row.stemtag || 'null'}, Quadrat=${row.quadrat} already exists in batch ${existingBatch}`;
  }

  const issues = collectMeasurementValidationIssues(row);
  if (issues.length > 0) {
    return `Data validation failed: ${issues.join('; ')}`;
  }

  return `Row dropped by INSERT IGNORE - possible constraint violation (Tag=${row.tag}, Quadrat=${row.quadrat}, Date=${normalizeMeasurementDate(row.date)})`;
}

async function findDroppedMeasurementCandidates(
  connectionManager: ConnectionManager,
  schema: string,
  fileName: string,
  batchID: string,
  plotID: number,
  censusID: number,
  chunkRows: FileRow[],
  transactionID: string
): Promise<DroppedMeasurementCandidate[]> {
  const tempTable = 'dropped_row_candidates';
  await connectionManager.executeQuery(`DROP TEMPORARY TABLE IF EXISTS ${tempTable}`, [], transactionID);
  await connectionManager.executeQuery(
    `CREATE TEMPORARY TABLE ${tempTable} (
      RowOrdinal INT NOT NULL PRIMARY KEY,
      TreeTag VARCHAR(20) NULL,
      StemTag VARCHAR(10) NULL,
      SpeciesCode VARCHAR(25) NULL,
      QuadratName VARCHAR(255) NULL,
      MeasurementDate DATE NULL,
      INDEX idx_dropped_row_candidates_match (TreeTag, StemTag, SpeciesCode, QuadratName, MeasurementDate),
      INDEX idx_dropped_row_candidates_duplicate (TreeTag, StemTag, QuadratName)
    ) ENGINE=MEMORY`,
    [],
    transactionID
  );

  try {
    const insertWidth = 6;
    const insertBatchSize = 500;
    for (let start = 0; start < chunkRows.length; start += insertBatchSize) {
      const slice = chunkRows.slice(start, start + insertBatchSize);
      const placeholders = slice.map(() => `(${Array(insertWidth).fill('?').join(',')})`).join(', ');
      const params = slice.flatMap((row, index) => [
        start + index + 1,
        row.tag ?? null,
        row.stemtag || null,
        row.spcode ?? null,
        row.quadrat ?? null,
        normalizeMeasurementDate(row.date)
      ]);

      await connectionManager.executeQuery(
        `INSERT INTO ${tempTable} (RowOrdinal, TreeTag, StemTag, SpeciesCode, QuadratName, MeasurementDate) VALUES ${placeholders}`,
        params,
        transactionID
      );
    }

    const droppedRowsSQL = format(
      `SELECT drc.RowOrdinal as rowOrdinal,
              MIN(dup.BatchID) as existingBatch
       FROM ${tempTable} drc
       LEFT JOIN ??.temporarymeasurements tm
         ON tm.FileID = ?
        AND tm.BatchID = ?
        AND tm.TreeTag <=> drc.TreeTag
        AND tm.StemTag <=> drc.StemTag
        AND tm.SpeciesCode <=> drc.SpeciesCode
        AND tm.QuadratName <=> drc.QuadratName
        AND tm.MeasurementDate <=> drc.MeasurementDate
       LEFT JOIN ??.temporarymeasurements dup
         ON dup.FileID = ?
        AND dup.PlotID = ?
        AND dup.CensusID = ?
        AND dup.TreeTag <=> drc.TreeTag
        AND dup.StemTag <=> drc.StemTag
        AND dup.QuadratName <=> drc.QuadratName
       WHERE tm.id IS NULL
       GROUP BY drc.RowOrdinal
       ORDER BY drc.RowOrdinal`,
      [schema, schema]
    );

    const results = await connectionManager.executeQuery(droppedRowsSQL, [fileName, batchID, fileName, plotID, censusID], transactionID);

    return Array.isArray(results) ? (results as DroppedMeasurementCandidate[]) : [];
  } finally {
    try {
      await connectionManager.executeQuery(`DROP TEMPORARY TABLE IF EXISTS ${tempTable}`, [], transactionID);
    } catch (cleanupError: unknown) {
      const message = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
      ailogger.warn(`Failed to clean up ${tempTable}: ${message}`);
    }
  }
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
    const chunkRows = Object.values(fileRowSet ?? {});
    const rowCount = chunkRows.length;
    const contentHash = hashChunkContent(fileRowSet);
    const idempotencyKey = generateIdempotencyKey(fileName, plot?.plotID ?? -1, censusCookie, rowCount, contentHash);

    // NOTE:
    // Sample-row duplicate short-circuit checks were removed because they could
    // falsely classify unique chunks as duplicates. We now always ingest the chunk
    // and rely on downstream dedupe + explicit dropped-row tracking.

    const batchID = body.batchID || generateShortBatchID();
    const placeholders = chunkRows.map(() => `(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).join(', ');
    const values = chunkRows.flatMap(row => {
      const { tag, stemtag, spcode, quadrat, lx, ly, dbh, hom, date, codes, comments } = row;
      const formattedDate = normalizeMeasurementDate(date);
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

        // Count rows BEFORE insert so we can measure the delta (important when
        // multiple chunks share a single BatchID under batch consolidation).
        const expectedRowCount = chunkRows.length;
        const countSQL = format(`SELECT COUNT(*) as count FROM ??.temporarymeasurements WHERE FileID = ? AND BatchID = ?`, [schema]);
        const preInsertResult = await connectionManager.executeQuery(countSQL, [fileName, batchID], transactionID);
        const preInsertCount = preInsertResult[0]?.count || 0;

        await connectionManager.executeQuery(insertSQL, values, transactionID);

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
            plot?.plotID ?? -1,
            censusCookie,
            chunkRows,
            transactionID
          );
          const droppedRows: DroppedMeasurementRow[] = droppedCandidates.map(candidate => {
            const row = chunkRows[candidate.rowOrdinal - 1];
            return {
              ...row,
              failureReason: buildDroppedMeasurementFailureReason(row, candidate.existingBatch),
              sourceRowIndex: candidate.rowOrdinal
            };
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
