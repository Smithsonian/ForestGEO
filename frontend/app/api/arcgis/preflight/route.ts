import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import ailogger from '@/ailogger';
import ConnectionManager from '@/config/connectionmanager';
import { HTTPResponses } from '@/config/macros';
import { assertCanEditMeasurementScope, ScopeAccessError } from '@/config/editplan/scopeguard';
import { isValidSchema } from '@/config/utils/sqlsecurity';
import { getSessionUserId, requireSession } from '@/lib/auth-helpers';
import { AmbiguousSheetError, MissingColumnError, MissingSheetError, UnparseableDateError } from '@/lib/arcgis/errors';
import { readArcgisWorkbook } from '@/lib/arcgis/workbook-reader';
import { transformArcgisWorkbook } from '@/lib/arcgis/transform';
import { createArcgisImportSession } from '@/lib/arcgis/import-session';

export const runtime = 'nodejs';

const MAX_ARCGIS_FILE_SIZE = 100 * 1024 * 1024;

function parsePositiveInteger(value: FormDataEntryValue | null): number | null {
  if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) return null;
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function getStringField(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function workbookErrorResponse(error: Error): NextResponse | null {
  if (
    error instanceof MissingSheetError ||
    error instanceof MissingColumnError ||
    error instanceof AmbiguousSheetError ||
    error instanceof UnparseableDateError
  ) {
    return NextResponse.json({ error: error.message }, { status: HTTPResponses.INVALID_REQUEST });
  }
  return null;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await auth();
  const authError = requireSession(session);
  if (authError) return authError;

  const userId = getSessionUserId(session!);
  if (!userId) {
    return NextResponse.json({ error: 'Authenticated session has no user identifier' }, { status: HTTPResponses.UNAUTHORIZED });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `Invalid ArcGIS pre-flight request: ${message}` }, { status: HTTPResponses.INVALID_REQUEST });
  }

  const schema = getStringField(formData, 'schema');
  const plotID = parsePositiveInteger(formData.get('plotID'));
  const censusID = parsePositiveInteger(formData.get('censusID'));
  const file = formData.get('file') as File | null;

  if (!schema || !plotID || !censusID || !file) {
    return NextResponse.json({ error: 'Missing required parameters: schema, plotID, censusID, and file' }, { status: HTTPResponses.INVALID_REQUEST });
  }
  if (!isValidSchema(schema)) {
    return NextResponse.json({ error: 'Invalid schema' }, { status: HTTPResponses.INVALID_REQUEST });
  }
  if (!file.name.toLowerCase().endsWith('.xlsx')) {
    return NextResponse.json({ error: 'ArcGIS import requires a single .xlsx workbook' }, { status: HTTPResponses.INVALID_REQUEST });
  }
  if (file.size > MAX_ARCGIS_FILE_SIZE) {
    return NextResponse.json(
      { error: `File too large. Maximum size is ${MAX_ARCGIS_FILE_SIZE / (1024 * 1024)}MB` },
      { status: HTTPResponses.PAYLOAD_TOO_LARGE }
    );
  }

  try {
    const connectionManager = ConnectionManager.getInstance();
    await assertCanEditMeasurementScope(connectionManager, session!, { schema, plotID, censusID });

    const workbook = await readArcgisWorkbook(await file.arrayBuffer());
    const result = transformArcgisWorkbook(workbook);
    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'ArcGIS workbook did not produce any measurement rows' }, { status: HTTPResponses.UNPROCESSABLE_ENTITY });
    }

    const importReference = await createArcgisImportSession({
      schema,
      plotID,
      censusID,
      userId,
      fileName: file.name,
      result
    });

    return NextResponse.json(
      {
        ...importReference,
        summary: result.summary,
        warnings: result.warnings
      },
      { status: HTTPResponses.OK }
    );
  } catch (error: unknown) {
    const errorObj = error instanceof Error ? error : new Error(String(error));
    const workbookResponse = workbookErrorResponse(errorObj);
    if (workbookResponse) return workbookResponse;

    if (error instanceof ScopeAccessError) {
      return NextResponse.json({ error: error.message }, { status: HTTPResponses.FORBIDDEN });
    }

    ailogger.error('ArcGIS pre-flight failed:', errorObj);
    return NextResponse.json({ error: errorObj.message || 'ArcGIS pre-flight failed' }, { status: HTTPResponses.INTERNAL_SERVER_ERROR });
  }
}
