import { NextRequest, NextResponse } from 'next/server';
import { HTTPResponses } from '@/config/macros';
import { FailedMeasurementsRDS } from '@/lib/db/definitions/core';
import connectionmanager from '@/lib/db/connectionmanager';
import { validateContextualValues } from '@/lib/contextvalidation';
import ailogger from '@/ailogger';
import { toError } from '@/lib/errorhelpers';
import { recordFailedMeasurementRows } from '@/lib/uploads/record-invalid-rows';
import { generateShortBatchID } from '@/config/utils';
import { validatedSchema, type SchemaName } from '@/lib/db/sqlsecurity';
import { auth } from '@/auth';
import { assertSchemaAccess } from '@/lib/authz';

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

export async function POST(request: NextRequest, props: { params: Promise<{ schema: string; slugs?: string[] }> }) {
  const params = await props.params;
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ message: 'Batch upload body must be valid JSON.' }, { status: HTTPResponses.INVALID_REQUEST });
  }

  if (!Array.isArray(payload) || payload.length === 0) {
    return new NextResponse(JSON.stringify({ message: 'No data provided for batch upload!' }), { status: HTTPResponses.INVALID_REQUEST });
  }
  if (payload.some(row => row === null || typeof row !== 'object' || Array.isArray(row))) {
    return NextResponse.json({ message: 'Batch upload rows must be JSON objects.' }, { status: HTTPResponses.INVALID_REQUEST });
  }

  let errorRows = payload as FailedMeasurementsRDS[];
  const { schema: schemaParam, slugs } = params;

  // Validate contextual values with fallback to URL params
  const validation = await validateContextualValues(request, {
    requireSchema: true,
    requirePlot: true,
    requireCensus: true,
    allowFallback: true,
    fallbackMessage: 'Batch upload requires active site, plot, and census selections.'
  });

  let plotID: number, censusID: number, schema: SchemaName;

  if (!validation.success) {
    // Fallback to URL parameters — but authenticate and authorize before accepting
    // the raw URL schema. Previously this branch took schemaParam after only a
    // pattern check (validateSchemaOrThrow), allowing any authed-or-unauthed
    // caller to act on any schema matching the pattern.
    if (schemaParam && slugs && slugs.length === 2) {
      const [plotIDParam, censusIDParam] = slugs;
      if (!/^[1-9]\d*$/.test(plotIDParam) || !/^[1-9]\d*$/.test(censusIDParam)) {
        return new NextResponse(JSON.stringify({ message: 'Invalid plotID or censusID in URL parameters!' }), { status: HTTPResponses.INVALID_REQUEST });
      }
      plotID = Number(plotIDParam);
      censusID = Number(censusIDParam);

      if (!Number.isSafeInteger(plotID) || !Number.isSafeInteger(censusID)) {
        return new NextResponse(JSON.stringify({ message: 'Invalid plotID or censusID in URL parameters!' }), { status: HTTPResponses.INVALID_REQUEST });
      }

      const session = await auth();
      if (!session?.user) {
        return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: HTTPResponses.UNAUTHORIZED });
      }

      try {
        schema = validatedSchema(schemaParam);
      } catch {
        return NextResponse.json({ error: 'Invalid schema', code: 'INVALID_SCHEMA' }, { status: HTTPResponses.INVALID_REQUEST });
      }

      const denied = assertSchemaAccess(session, schema);
      if (denied) return denied;
    } else {
      return validation.response!;
    }
  } else {
    const values = validation.values!;
    // validateContextualValues has already authed and authorized schema membership;
    // brand the schema to keep the variable's type uniform with the fallback branch.
    schema = validatedSchema(values.schema!);
    plotID = values.plotID!;
    censusID = values.censusID!;
  }

  // Add plotID and censusID to each row
  const batchID = generateShortBatchID();
  const fileID = request.nextUrl.searchParams.get('fileID') || 'upload-parse-errors.csv';
  errorRows = errorRows.map(row => ({
    ...row,
    plotID,
    censusID,
    // These identifiers are generated/request-scoped values, never client
    // overrides. Otherwise one rejected row could be persisted under another
    // upload's file/batch and later be selected by the wrong retry.
    batchID,
    fileID,
    originalFailureReasons: row.originalFailureReasons ?? row.failureReasons ?? undefined,
    currentFailureReasons: row.currentFailureReasons ?? row.failureReasons ?? undefined
  }));

  const connectionManager = connectionmanager.getInstance();
  let transactionID = '';
  let operationError: unknown;

  try {
    transactionID = await connectionManager.beginTransaction();
    await recordFailedMeasurementRows(connectionManager, schema, errorRows, fileID, batchID, plotID, censusID, transactionID);
    await connectionManager.commitTransaction(transactionID);

    return new NextResponse(JSON.stringify({ message: 'Inserted ingestion error rows', rowCount: errorRows.length }), { status: HTTPResponses.OK });
  } catch (error: any) {
    operationError = error;
    if (transactionID) {
      try {
        await connectionManager.rollbackTransaction(transactionID);
      } catch (rollbackError) {
        if (error instanceof Error) {
          (error as Error & { rollbackError?: unknown }).rollbackError = rollbackError;
        }
      }
    }
    ailogger.error('Database Error:', error);
    return new NextResponse(JSON.stringify({ message: 'Database error', error: error.message }), { status: HTTPResponses.INTERNAL_SERVER_ERROR });
  } finally {
    try {
      await connectionManager.closeConnection();
    } catch (closeError) {
      if (operationError === undefined) throw closeError;
      ailogger.error('Failed to close batch upload connection after the primary error:', toError(closeError));
    }
  }
}
