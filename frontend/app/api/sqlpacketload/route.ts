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

/**
 * Handles bulk measurement data upload and processing.
 *
 * This endpoint processes CSV measurement data by:
 * 1. Cleaning existing temporarymeasurements data for the file/plot/census combination
 * 2. Performing application-level deduplication based on TreeTag, StemTag, QuadratName, and MeasurementDate
 * 3. Inserting unique records into temporarymeasurements table for subsequent stored procedure processing
 *
 * The deduplication and cleanup logic prevents the race conditions and data accumulation issues
 * that previously caused record count mismatches during bulk uploads.
 *
 * @param request - NextRequest containing fileRowSet, fileName, schema, plot, and censusCookie
 * @returns NextResponse with success/error status and processing statistics
 */
export async function POST(request: NextRequest) {
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

  // CRITICAL: Ensure cleanup of stale transactions before processing
  try {
    await connectionManager.cleanupStaleTransactions(30000); // 30 second threshold
  } catch (cleanupError: any) {
    ailogger.warn('Failed to cleanup stale transactions:', cleanupError);
  }
  if (formType === 'measurements') {
    const batchID = v4();
    const placeholders = Object.values(fileRowSet ?? [])
      .map(() => `(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .join(', ');
    const values = Object.values(fileRowSet ?? []).map(row => {
      const { tag, stemtag, spcode, quadrat, lx, ly, dbh, hom, date, codes, comments } = row;
      const formattedDate = date ? moment(date).format('YYYY-MM-DD') : date;
      return [fileName, batchID, plot?.plotID ?? -1, censusCookie, tag, stemtag, spcode, quadrat, lx, ly, dbh, hom, formattedDate, codes, comments];
    });

    const uniqueValues = values.filter((value, index, array) => {
      return array.findIndex(v => v[4] === value[4] && v[5] === value[5] && v[7] === value[7] && v[12] === value[12]) === index;
    });

    transactionID = await connectionManager.beginTransaction();
    try {
      const cleanupQuery = `
        DELETE FROM ${schema}.temporarymeasurements 
        WHERE FileID = ? AND PlotID = ? AND CensusID = ?
      `;
      await connectionManager.executeQuery(cleanupQuery, [fileName, plot?.plotID ?? -1, censusCookie]);

      const uniquePlaceholders = uniqueValues.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
      const flatUniqueValues = uniqueValues.flat();

      const insertSQL = `INSERT INTO ${schema}.temporarymeasurements 
      (FileID, BatchID, PlotID, CensusID, TreeTag, StemTag, SpeciesCode, QuadratName, LocalX, LocalY, DBH, HOM, MeasurementDate, Codes, Comments) 
      VALUES ${uniquePlaceholders}`;
      await connectionManager.executeQuery(insertSQL, flatUniqueValues);
      await connectionManager.commitTransaction(transactionID);
      ailogger.info(
        await connectionManager.executeQuery(`SELECT COUNT(*) FROM ${schema}.temporarymeasurements WHERE FileID = ? AND BatchID = ?`, [fileName, batchID])
      );
      return new NextResponse(
        JSON.stringify({
          responseMessage: `Bulk insert completed: ${uniqueValues.length} unique records inserted`,
          duplicatesRemoved: values.length - uniqueValues.length,
          failingRows: Array.from(failingRows)
        }),
        { status: HTTPResponses.OK }
      );
    } catch (e: any) {
      await connectionManager.rollbackTransaction(transactionID);
      ailogger.error(`Error processing file ${fileName}:`, e.message);
      return new NextResponse(
        JSON.stringify({
          responseMessage: `Error processing file ${fileName}: ${e.message}`,
          failingRows: Array.from(failingRows)
        }),
        { status: HTTPResponses.INTERNAL_SERVER_ERROR }
      );
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
        await connectionManager.executeQuery(sql, params);
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
        await connectionManager.executeQuery(sql, params);
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
        failingRows: Array.from(failingRows)
      }),
      { status: HTTPResponses.OK }
    );
  }
}
