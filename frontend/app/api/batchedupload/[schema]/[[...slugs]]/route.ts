import { NextRequest, NextResponse } from 'next/server';
import { HTTPResponses } from '@/config/macros';
import { FailedMeasurementsRDS } from '@/config/sqlrdsdefinitions/core';
import connectionmanager from '@/config/connectionmanager';
import { format } from 'mysql2/promise';

export async function POST(request: NextRequest, props: { params: Promise<{ schema: string; slugs?: string[] }> }) {
  const params = await props.params;
  let errorRows: FailedMeasurementsRDS[] = await request.json();
  const schema = params.schema;
  const slugs = params.slugs;
  if (!errorRows || errorRows.length === 0 || !schema || !slugs || slugs.length !== 2) {
    return new NextResponse(JSON.stringify({ message: 'Missing requirements!' }), { status: HTTPResponses.INVALID_REQUEST });
  }
  const [plotID, censusID] = slugs.map(Number);
  if (isNaN(plotID) || isNaN(censusID)) {
    return new NextResponse(JSON.stringify({ message: 'Invalid plotID or censusID!' }), { status: HTTPResponses.INVALID_REQUEST });
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

  const insertQuery = format(`INSERT INTO ?? (${columns.map(() => '??').join(', ')}) VALUES ?`, [`${schema}.ingest_failedmeasurements`, ...columns, values]);

  try {
    await connectionManager.executeQuery(insertQuery);
    return new NextResponse(JSON.stringify({ message: 'Insert to SQL successful' }), { status: HTTPResponses.OK });
  } catch (error: any) {
    console.error('Database Error:', error);
    return new NextResponse(JSON.stringify({ message: 'Database error', error: error.message }), { status: HTTPResponses.INTERNAL_SERVER_ERROR });
  }
}
