import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import ailogger from '@/ailogger';
import ConnectionManager from '@/config/connectionmanager';
import { HTTPResponses } from '@/config/macros';
import { UploadMode } from '@/config/uploadmodes';
import { assertCanEditMeasurementScope, ScopeAccessError } from '@/config/editplan/scopeguard';
import { isValidSchema } from '@/config/utils/sqlsecurity';
import { getSessionUserId, requireSession } from '@/lib/auth-helpers';
import { requireUploadSessionOwnership, UploadSessionOwnershipError, UploadSessionState as TrackedUploadSessionState } from '@/config/uploadsessiontracker';
import { ArcgisImportSessionError } from '@/lib/arcgis/import-session';
import { commitArcgisImport } from '@/lib/uploads/arcgis-commit';

export const runtime = 'nodejs';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await auth();
  const authError = requireSession(session);
  if (authError) return authError;

  const userId = getSessionUserId(session!);
  if (!userId) {
    return NextResponse.json({ error: 'Authenticated session has no user identifier' }, { status: HTTPResponses.UNAUTHORIZED });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid ArcGIS commit request body' }, { status: HTTPResponses.INVALID_REQUEST });
  }

  const schema = typeof body.schema === 'string' ? body.schema.trim() : '';
  const plotID = Number(body.plotID);
  const censusID = Number(body.censusID);
  const importSessionId = typeof body.importSessionId === 'string' ? body.importSessionId.trim() : '';
  const batchID = typeof body.batchID === 'string' ? body.batchID.trim() : '';
  const requestedFileName = typeof body.fileName === 'string' ? body.fileName.trim() : '';
  const uploadMode: UploadMode = body.uploadMode === UploadMode.CLEAN_REUPLOAD ? UploadMode.CLEAN_REUPLOAD : UploadMode.REVISIONS;
  const sessionId = request.headers.get('x-upload-session-id') ?? '';

  if (
    !schema ||
    !isValidSchema(schema) ||
    !Number.isSafeInteger(plotID) ||
    plotID <= 0 ||
    !Number.isSafeInteger(censusID) ||
    censusID <= 0 ||
    !importSessionId ||
    !batchID ||
    !requestedFileName
  ) {
    return NextResponse.json(
      { error: 'Missing or invalid parameters: schema, plotID, censusID, importSessionId, batchID, fileName' },
      { status: HTTPResponses.INVALID_REQUEST }
    );
  }

  const connectionManager = ConnectionManager.getInstance();

  try {
    await assertCanEditMeasurementScope(connectionManager, session!, { schema, plotID, censusID });
    const uploadSession = await requireUploadSessionOwnership({
      schema,
      sessionId,
      plotId: plotID,
      censusId: censusID,
      allowedStates: [TrackedUploadSessionState.INITIALIZED, TrackedUploadSessionState.UPLOADING],
      contextLabel: `arcgis commit for session ${importSessionId}`
    });
    const uploadSessionID = uploadSession.sessionId ?? sessionId;

    const result = await commitArcgisImport(connectionManager, {
      schema,
      plotID,
      censusID,
      importSessionId,
      fileName: requestedFileName,
      batchID,
      uploadMode,
      userId,
      uploadSessionID
    });

    return NextResponse.json(result, { status: HTTPResponses.OK });
  } catch (error: unknown) {
    if (error instanceof ArcgisImportSessionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof ScopeAccessError) {
      return NextResponse.json({ error: error.message }, { status: HTTPResponses.FORBIDDEN });
    }
    if (error instanceof UploadSessionOwnershipError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const errorObj = error instanceof Error ? error : new Error(String(error));
    ailogger.error('ArcGIS commit failed:', errorObj);
    return NextResponse.json({ error: errorObj.message || 'ArcGIS commit failed' }, { status: HTTPResponses.INTERNAL_SERVER_ERROR });
  }
}
