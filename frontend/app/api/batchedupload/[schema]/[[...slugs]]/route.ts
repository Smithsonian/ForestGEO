import { NextRequest, NextResponse } from 'next/server';
import { HTTPResponses } from '@/config/macros';
import { FailedMeasurementsRDS } from '@/config/sqlrdsdefinitions/core';
import connectionmanager from '@/config/connectionmanager';
import { validateContextualValues } from '@/lib/contextvalidation';
import ailogger from '@/ailogger';
import { insertIngestionFailureRows } from '@/config/measurementerrors';
import { generateShortBatchID } from '@/config/utils';
import { validatedSchema, type SchemaName } from '@/config/utils/sqlsecurity';
import { auth } from '@/auth';
import { assertSchemaAccess } from '@/lib/authz';

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

  let plotID: number, censusID: number, schema: SchemaName;

  if (!validation.success) {
    // Fallback to URL parameters — but authenticate and authorize before accepting
    // the raw URL schema. Previously this branch took schemaParam after only a
    // pattern check (validateSchemaOrThrow), allowing any authed-or-unauthed
    // caller to act on any schema matching the pattern.
    if (schemaParam && slugs && slugs.length === 2) {
      const [plotIDParam, censusIDParam] = slugs;
      plotID = parseInt(plotIDParam);
      censusID = parseInt(censusIDParam);

      if (isNaN(plotID) || isNaN(censusID)) {
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
