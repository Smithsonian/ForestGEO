import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/lib/db/connectionmanager';
import { HTTPResponses } from '@/config/macros';
import { buildFailedMeasurementsSelectQuery } from '@/config/measurementerrors';
import { validateSchemaOrThrow } from '@/lib/db/sqlsecurity';
import { fromPath, withRouteAuthz, type RouteContext } from '@/lib/route-authz';
import ailogger from '@/ailogger';

export const runtime = 'nodejs';

function parsePositiveInteger(value: string | string[] | undefined): number | undefined {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

async function handler(_request: NextRequest, context: RouteContext) {
  const params = await context.params;
  const schema = params.schema;
  const plotID = parsePositiveInteger(params.plotID);
  const censusID = parsePositiveInteger(params.censusID);

  if (typeof schema !== 'string' || !plotID || !censusID) {
    return NextResponse.json({ error: 'Invalid plotID or censusID' }, { status: HTTPResponses.BAD_REQUEST });
  }

  // Defense in depth: the authorization wrapper validates the schema before
  // this handler runs, and this query builder interpolates it as an identifier.
  try {
    validateSchemaOrThrow(schema);
  } catch {
    return NextResponse.json({ error: 'Invalid schema' }, { status: HTTPResponses.BAD_REQUEST });
  }

  const connectionManager = ConnectionManager.getInstance();

  try {
    const rows = await connectionManager.executeQuery(
      `SELECT COUNT(*) AS total
       FROM (${buildFailedMeasurementsSelectQuery(schema)}) failed
       WHERE failed.PlotID = ? AND failed.CensusID = ?`,
      [plotID, censusID]
    );
    const total = Number(rows[0]?.total ?? 0);
    if (!Number.isSafeInteger(total) || total < 0) {
      throw new Error('Database returned an invalid failed-measurement count');
    }

    return NextResponse.json({ recordCount: total }, { status: HTTPResponses.OK });
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    ailogger.error(`Failed to count failed measurements for ${schema}/${plotID}/${censusID}:`, err);
    return NextResponse.json({ error: 'Failed to count failed measurements' }, { status: HTTPResponses.INTERNAL_SERVER_ERROR });
  } finally {
    try {
      await connectionManager.closeConnection();
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      ailogger.error('Failed to close the failed-measurement count connection:', err);
    }
  }
}

export const GET = withRouteAuthz('failedmeasurements/count/[schema]/[plotID]/[censusID]', handler, { schema: fromPath('schema') });
