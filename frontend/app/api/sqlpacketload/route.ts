import ConnectionManager from '@/config/connectionmanager';
import { HTTPResponses, InsertUpdateProcessingProps, SpecialBulkProcessingProps } from '@/config/macros';
import { FileRow, FileRowSet } from '@/config/macros/formdetails';
import { NextRequest, NextResponse } from 'next/server';
import { Plot, QuadratResult } from '@/config/sqlrdsdefinitions/zones';
import { OrgCensus } from '@/config/sqlrdsdefinitions/timekeeping';
import { insertOrUpdate } from '@/components/processors/processorhelperfunctions';
import { v4 } from 'uuid';
import moment from 'moment/moment';
import { buildBulkUpsertQuery } from '@/config/utils';
import { AttributesResult } from '@/config/sqlrdsdefinitions/core';
import { processBulkSpecies } from '@/components/processors/processbulkspecies';
import { getCookie } from '@/app/actions/cookiemanager';
import ailogger from '@/ailogger';
import { auth } from '@/auth';
import { format } from 'mysql2/promise';
import { isValidSchema } from '@/config/utils/sqlsecurity';

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
      { status: 401 } // 401 Unauthorized
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
  const censusCookie = Number((await getCookie('censusID')) ?? census?.dateRanges[0].censusID ?? -1);
  const user: string = body.user;
  const fileRowSet: FileRowSet = body.fileRowSet;
  const fileName: string = body.fileName;
  let transactionID: string | undefined;
  const failingRows: Set<FileRow> = new Set<FileRow>();
  const connectionManager = ConnectionManager.getInstance();
  const maxRetries = 3;
  let retryCount = 0;
  if (formType === 'measurements') {
    const batchID = v4();
    const placeholders = Object.values(fileRowSet ?? [])
      .map(() => `(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .join(', ');
    const values = Object.values(fileRowSet ?? []).flatMap(row => {
      // const transformedRow = { ...row, date: row.date ? moment(row.date).format('YYYY-MM-DD') : row.date };
      const { tag, stemtag, spcode, quadrat, lx, ly, dbh, hom, date, codes, comments } = row;
      const formattedDate = date ? moment(date).format('YYYY-MM-DD') : date;
      return [fileName, batchID, plot?.plotID ?? -1, censusCookie, tag, stemtag, spcode, quadrat, lx, ly, dbh, hom, formattedDate, codes, comments];
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
        await connectionManager.commitTransaction(transactionID);

        // Log successful insertion count - use format() for schema identifier
        const countSQL = format(`SELECT COUNT(*) as count FROM ??.temporarymeasurements WHERE FileID = ? AND BatchID = ?`, [schema]);
        const countResult = await connectionManager.executeQuery(countSQL, [fileName, batchID]);
        ailogger.info(`Successfully inserted ${countResult[0]?.count || 0} rows for ${fileName}-${batchID}`);

        // Track file upload in unifiedchangelog (single row per file, not per batch)
        try {
          // Check if we've already logged this file upload - use format() for schema
          const existingEntrySQL = format(
            `SELECT ChangeID, NewRowState FROM ??.unifiedchangelog
             WHERE TableName = 'file_upload' AND RecordID = ? AND CensusID = ?
             ORDER BY ChangeID DESC LIMIT 1`,
            [schema]
          );
          const existingEntry = await connectionManager.executeQuery(existingEntrySQL, [fileName, censusCookie]);

          if (existingEntry.length === 0) {
            // First batch for this file - insert new entry
            const uploadMetadata = JSON.stringify({
              fileName,
              formType,
              rowCount: countResult[0]?.count || 0,
              batchCount: 1
            });
            const insertChangelogSQL = format(
              `INSERT INTO ??.unifiedchangelog
              (TableName, RecordID, Operation, NewRowState, ChangeTimestamp, ChangedBy, PlotID, CensusID)
              VALUES (?, ?, ?, ?, NOW(), ?, ?, ?)`,
              [schema]
            );
            await connectionManager.executeQuery(insertChangelogSQL, ['file_upload', fileName, 'INSERT', uploadMetadata, user, plot?.plotID, censusCookie]);
          } else {
            // Subsequent batch - update the existing entry with accumulated count
            const metadata = JSON.parse(existingEntry[0].NewRowState);
            metadata.rowCount = (metadata.rowCount || 0) + (countResult[0]?.count || 0);
            metadata.batchCount = (metadata.batchCount || 1) + 1;
            const updateChangelogSQL = format(`UPDATE ??.unifiedchangelog SET NewRowState = ?, ChangeTimestamp = NOW() WHERE ChangeID = ?`, [schema]);
            await connectionManager.executeQuery(updateChangelogSQL, [JSON.stringify(metadata), existingEntry[0].ChangeID]);
          }
        } catch (logError: any) {
          // Log but don't fail the upload if changelog tracking fails
          ailogger.error(`Failed to log file upload to changelog: ${logError.message}`);
        }

        return new NextResponse(
          JSON.stringify({
            responseMessage: `Bulk insert to SQL completed`,
            failingRows: Array.from(failingRows),
            insertedCount: countResult[0]?.count || 0,
            transactionCompleted: true,
            batchID: batchID
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
              Code: row.code,
              Description: row.description,
              Status: row.status
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
        const censusID = census?.dateRanges[0]?.censusID;

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
          const metadata = JSON.parse(existingEntry[0].NewRowState);
          metadata.rowCount = (metadata.rowCount || 0) + batchRowCount;
          metadata.batchCount = (metadata.batchCount || 1) + 1;
          const updateChangelogSQL = format(`UPDATE ??.unifiedchangelog SET NewRowState = ?, ChangeTimestamp = NOW() WHERE ChangeID = ?`, [schema]);
          await connectionManager.executeQuery(updateChangelogSQL, [JSON.stringify(metadata), existingEntry[0].ChangeID]);
        }
      } catch (logError: any) {
        // Log but don't fail the upload if changelog tracking fails
        ailogger.error(`Failed to log file upload to changelog: ${logError.message}`);
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
