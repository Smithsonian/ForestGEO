import { NextRequest, NextResponse } from 'next/server';
import { HTTPResponses } from '@/config/macros';
import { FailedMeasurementsRDS } from '@/config/sqlrdsdefinitions/core';
import connectionmanager from '@/config/connectionmanager';
import { validateContextualValues } from '@/lib/contextvalidation';
import ailogger from '@/ailogger';
import { safeFormatQuery } from '@/config/utils/sqlsecurity';
import { getSchemaCapabilities } from '@/config/utils/schemacapabilities';

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

  // Add plotID and censusID to each row
  errorRows = errorRows.map(row => ({
    ...row,
    plotID,
    censusID,
    originalFailureReasons: row.originalFailureReasons ?? row.failureReasons ?? undefined,
    currentFailureReasons: row.currentFailureReasons ?? row.failureReasons ?? undefined
  }));

  const connectionManager = connectionmanager.getInstance();
  const { hasUploadErrors } = await getSchemaCapabilities(schema);

  try {
    if (hasUploadErrors) {
      const insertQuery = safeFormatQuery(
        schema,
        `INSERT INTO ??.upload_errors
           (FileID, BatchID, PlotID, CensusID, RowIndex, RawData, ErrorType, ErrorMessage)
         VALUES ?`
      );
      const uploadErrorValues = errorRows.map((row, index) => [
        (row as any).fileID ?? null,
        (row as any).batchID ?? null,
        row.plotID ?? plotID,
        row.censusID ?? censusID,
        index + 1,
        JSON.stringify({
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
          comments: (row as any).comments ?? row.description ?? null
        }),
        'PARSE_VALIDATION_ERROR',
        row.failureReasons ?? 'Unknown parse validation error'
      ]);
      await connectionManager.executeQuery(insertQuery, [uploadErrorValues]);
    } else {
      const legacyInsertQuery = safeFormatQuery(
        schema,
        `INSERT INTO ??.failedmeasurements
           (PlotID, CensusID, Tag, StemTag, SpCode, Quadrat, X, Y, DBH, HOM, Date, Codes, Comments, FailureReasons, OriginalFailureReasons, CurrentFailureReasons)
         VALUES ?`
      );
      const legacyValues = errorRows.map(row => [
        row.plotID ?? plotID,
        row.censusID ?? censusID,
        row.tag ?? null,
        row.stemTag ?? null,
        row.spCode ?? null,
        row.quadrat ?? null,
        row.x ?? null,
        row.y ?? null,
        row.dbh ?? null,
        row.hom ?? null,
        row.date ?? null,
        row.codes ?? null,
        (row as any).comments ?? row.description ?? null,
        row.failureReasons ?? 'Unknown parse validation error',
        row.originalFailureReasons ?? row.failureReasons ?? 'Unknown parse validation error',
        row.currentFailureReasons ?? row.failureReasons ?? 'Unknown parse validation error'
      ]);
      await connectionManager.executeQuery(legacyInsertQuery, [legacyValues]);
    }

    return new NextResponse(JSON.stringify({ message: 'Insert to SQL successful' }), { status: HTTPResponses.OK });
  } catch (error: any) {
    ailogger.error('Database Error:', error);
    return new NextResponse(JSON.stringify({ message: 'Database error', error: error.message }), { status: HTTPResponses.INTERNAL_SERVER_ERROR });
  }
}
