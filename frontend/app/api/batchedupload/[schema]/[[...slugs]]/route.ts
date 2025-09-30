import { NextRequest, NextResponse } from 'next/server';
import { HTTPResponses } from '@/config/macros';
import { FailedMeasurementsRDS } from '@/config/sqlrdsdefinitions/core';
import connectionmanager from '@/config/connectionmanager';
import { validateContextualValues } from '@/lib/contextvalidation';
import { format } from 'mysql2/promise';
import ailogger from '@/ailogger';

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
    censusID
  }));

  const connectionManager = connectionmanager.getInstance();
  const columns = Object.keys(errorRows[0]).filter(col => col !== 'id' && col !== 'failedMeasurementID');
  const values = errorRows.map(row => columns.map(col => row[col as keyof FailedMeasurementsRDS]));

  const insertQuery = format(`INSERT INTO ?? (${columns.map(() => '??').join(', ')}) VALUES ?`, [`${schema}.failedmeasurements`, ...columns, values]);

  try {
    await connectionManager.executeQuery(insertQuery);
    return new NextResponse(JSON.stringify({ message: 'Insert to SQL successful' }), { status: HTTPResponses.OK });
  } catch (error: any) {
    ailogger.error('Database Error:', error);
    return new NextResponse(JSON.stringify({ message: 'Database error', error: error.message }), { status: HTTPResponses.INTERNAL_SERVER_ERROR });
  }
}
