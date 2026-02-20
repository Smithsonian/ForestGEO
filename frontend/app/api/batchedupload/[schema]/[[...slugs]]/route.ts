import { NextRequest, NextResponse } from 'next/server';
import { HTTPResponses } from '@/config/macros';
import { FailedMeasurementsRDS } from '@/config/sqlrdsdefinitions/core';
import connectionmanager from '@/config/connectionmanager';
import { validateContextualValues } from '@/lib/contextvalidation';
import ailogger from '@/ailogger';
import { insertIngestionFailureRows } from '@/config/measurementerrors';
import { generateShortBatchID } from '@/config/utils';
import { validateSchemaOrThrow } from '@/config/utils/sqlsecurity';

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

export async function POST(request: NextRequest, props: { params: Promise<{ schema: string; slugs?: string[] }> }) {
  const params = await props.params;
  let errorRows: FailedMeasurementsRDS[] = await request.json();
  const { schema: schemaParam, slugs } = params;

  if (!errorRows || errorRows.length === 0) {
    return new NextResponse(JSON.stringify({ message: 'No data provided for batch upload!' }), { status: HTTPResponses.INVALID_REQUEST });
  }

  // Validate contextual values with fallback to URL params
  const validation = await validateContextualValues(request, {
    requireSchema: true,
    requirePlot: true,
    requireCensus: true,
    allowFallback: true,
    fallbackMessage: 'Batch upload requires active site, plot, and census selections.'
  });

  let plotID: number, censusID: number, schema: string;

  if (!validation.success) {
    // Try to use URL parameters as fallback
    if (schemaParam && slugs && slugs.length === 2) {
      const [plotIDParam, censusIDParam] = slugs;
      plotID = parseInt(plotIDParam);
      censusID = parseInt(censusIDParam);
      schema = schemaParam;

      if (isNaN(plotID) || isNaN(censusID)) {
        return new NextResponse(JSON.stringify({ message: 'Invalid plotID or censusID in URL parameters!' }), { status: HTTPResponses.INVALID_REQUEST });
      }
    } else {
      return validation.response!;
    }
  } else {
    const values = validation.values!;
    schema = values.schema!;
    plotID = values.plotID!;
    censusID = values.censusID!;
  }

  try {
    validateSchemaOrThrow(schema);
  } catch (error: any) {
    return new NextResponse(JSON.stringify({ message: error.message }), { status: HTTPResponses.INVALID_REQUEST });
  }

  // Add plotID and censusID to each row
  const batchID = generateShortBatchID();
  const fileID = request.nextUrl.searchParams.get('fileID') || 'upload-parse-errors.csv';
  errorRows = errorRows.map(row => ({
    ...row,
    plotID,
    censusID,
    batchID: (row as any).batchID ?? batchID,
    fileID: (row as any).fileID ?? fileID,
    originalFailureReasons: row.originalFailureReasons ?? row.failureReasons ?? undefined,
    currentFailureReasons: row.currentFailureReasons ?? row.failureReasons ?? undefined
  }));

  const connectionManager = connectionmanager.getInstance();
  let transactionID = '';

  try {
    transactionID = await connectionManager.beginTransaction();
    await insertIngestionFailureRows(
      connectionManager,
      schema,
      errorRows.map((row, idx) => ({
        plotID,
        censusID,
        tag: row.tag ?? null,
        stemTag: row.stemTag ?? null,
        spCode: row.spCode ?? null,
        quadrat: row.quadrat ?? null,
        x: row.x ?? null,
        y: row.y ?? null,
        dbh: row.dbh ?? null,
        hom: row.hom ?? null,
        date: row.date ?? null,
        codes: row.codes ?? null,
        comments: row.description ?? null,
        failureReason: row.failureReasons ?? 'Unknown error',
        fileID: (row as any).fileID ?? fileID,
        batchID: (row as any).batchID ?? batchID,
        sourceRowIndex: idx + 1
      })),
      transactionID
    );
    await connectionManager.commitTransaction(transactionID);

    return new NextResponse(JSON.stringify({ message: 'Inserted ingestion error rows', rowCount: errorRows.length }), { status: HTTPResponses.OK });
  } catch (error: any) {
    if (transactionID) {
      await connectionManager.rollbackTransaction(transactionID);
    }
    ailogger.error('Database Error:', error);
    return new NextResponse(JSON.stringify({ message: 'Database error', error: error.message }), { status: HTTPResponses.INTERNAL_SERVER_ERROR });
  } finally {
    await connectionManager.closeConnection();
  }
}
