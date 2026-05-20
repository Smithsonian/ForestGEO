import { NextRequest, NextResponse } from 'next/server';
import { HTTPResponses } from '@/config/macros';
import { isValidSchema } from '@/config/utils/sqlsecurity';
import { getConn } from '@/components/processors/processormacros';
import { auth } from '@/auth';
import { requireSession, getSessionUserId } from '@/lib/auth-helpers';
import ailogger from '@/ailogger';
import { checkFinishedCensus, selectMeasurements, renderArtifact } from '@/lib/ctfs-export';
import type { Session } from 'next-auth';

// Force Node.js runtime — mysql2 and the ctfs-export renderer are not compatible
// with the Edge Runtime.
export const runtime = 'nodejs';

type RouteProps = { params: Promise<{ schema: string; plotID: string; censusID: string }> };

// ---------------------------------------------------------------------------
// Permission helpers
//
// The exact role mapping for export/reload authority is unresolved (spec
// line 74: "the PI or data manager of each plot" — confirmed by Jess/David
// still pending). These stubs encode the current policy placeholder and are
// the only code that changes when the permission model is finalised.
// ---------------------------------------------------------------------------

/**
 * Returns true when the authenticated user may read measurements for the given
 * schema.
 *
 * TODO: Replace with a schema-to-user permission lookup once the app's
 * permission model is finalised. Any authenticated session is granted read
 * access in this MVP to unblock operators.
 */
async function userCanReadSchema(_session: Session, _schema: string): Promise<boolean> {
  return true;
}

/**
 * Returns true when the authenticated user is allowed to generate reload
 * artifacts (`allowReload=true` or `reloadDryRun=true`).
 *
 * TODO: Replace with an admin/data-manager role check once the permission
 * model is finalised. Defaults to false so the destructive reload path is
 * inaccessible until an explicit policy decision is made.
 */
async function userCanReload(_session: Session): Promise<boolean> {
  return false;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest, props: RouteProps): Promise<NextResponse> {
  // --- Authentication ---
  const session = await auth();
  const authError = requireSession(session);
  if (authError) return authError;

  const { schema, plotID, censusID } = await props.params;

  // --- Schema validation ---
  if (!isValidSchema(schema)) {
    return NextResponse.json({ error: 'Invalid schema name' }, { status: HTTPResponses.BAD_REQUEST });
  }

  // --- Schema-level read permission ---
  if (!(await userCanReadSchema(session!, schema))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: HTTPResponses.FORBIDDEN });
  }

  // --- Route param parsing ---
  const appPlotId = Number.parseInt(plotID, 10);
  const appCensusId = Number.parseInt(censusID, 10);
  if (!Number.isInteger(appPlotId) || !Number.isInteger(appCensusId) || String(appPlotId) !== plotID || String(appCensusId) !== censusID) {
    return NextResponse.json({ error: 'plotID and censusID must be integers' }, { status: HTTPResponses.BAD_REQUEST });
  }

  // --- Query param: destinationPlotID (required, non-negative integer) ---
  const destinationPlotIDRaw = request.nextUrl.searchParams.get('destinationPlotID');
  if (destinationPlotIDRaw == null) {
    return NextResponse.json({ error: 'Missing required query param: destinationPlotID' }, { status: HTTPResponses.BAD_REQUEST });
  }
  const destinationPlotId = Number.parseInt(destinationPlotIDRaw, 10);
  if (!Number.isInteger(destinationPlotId) || destinationPlotId < 0 || String(destinationPlotId) !== destinationPlotIDRaw) {
    return NextResponse.json({ error: 'destinationPlotID must be a non-negative integer' }, { status: HTTPResponses.BAD_REQUEST });
  }

  // --- Query params: reload flags ---
  const allowReload = request.nextUrl.searchParams.get('allowReload') === 'true';
  const reloadDryRun = request.nextUrl.searchParams.get('reloadDryRun') === 'true';
  if ((allowReload || reloadDryRun) && !(await userCanReload(session!))) {
    return NextResponse.json({ error: 'Reload export requires elevated permission' }, { status: HTTPResponses.FORBIDDEN });
  }

  // --- Database work ---
  const conn = await getConn();
  try {
    // Precondition: census must be fully validated and clean before export.
    const precondition = await checkFinishedCensus(conn, { schema, plotId: appPlotId, censusId: appCensusId });
    if (!precondition.ok) {
      return NextResponse.json({ error: 'Census is not finished', reasons: precondition.reasons }, { status: HTTPResponses.BAD_REQUEST });
    }

    // Fetch measurement + attribute rows from the app database.
    const { measurementRows, attributeRows } = await selectMeasurements(conn, {
      schema,
      plotId: appPlotId,
      censusId: appCensusId
    });

    // Resolve PlotCensusNumber — needed for the procedure identifier and lock name.
    const [censusRows] = await conn.query<any[]>(`SELECT PlotCensusNumber FROM \`${schema}\`.census WHERE CensusID = ?`, [appCensusId]);
    if (!Array.isArray(censusRows) || censusRows.length === 0) {
      return NextResponse.json({ error: 'Census not found' }, { status: HTTPResponses.NOT_FOUND });
    }
    const plotCensusNumber = String(censusRows[0].PlotCensusNumber);

    // Render the complete SQL artifact.
    const { sql, procedureName, lockName } = renderArtifact({
      schema,
      appPlotId,
      destinationPlotId,
      appCensusId,
      plotCensusNumber,
      allowReload,
      reloadDryRun,
      generatedAt: new Date(),
      measurementRows,
      attributeRows
    });

    const filename = `ctfs-export-${destinationPlotId}-${plotCensusNumber}-${Date.now()}.sql`;
    const userId = getSessionUserId(session!);

    ailogger.info('ctfs-sql export generated', {
      userId,
      schema,
      appPlotId,
      destinationPlotId,
      appCensusId,
      plotCensusNumber,
      measurementCount: measurementRows.length,
      attributeCount: attributeRows.length,
      allowReload,
      reloadDryRun,
      procedureName,
      lockName,
      filename
    });

    return new NextResponse(sql, {
      status: HTTPResponses.OK,
      headers: {
        'Content-Type': 'application/sql; charset=utf-8',
        'Content-Disposition': `attachment; filename=${filename}`
      }
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    ailogger.error('ctfs-sql export failed', { schema, appPlotId, appCensusId, message });
    return NextResponse.json({ error: message || 'Export failed' }, { status: HTTPResponses.INTERNAL_SERVER_ERROR });
  } finally {
    conn.release();
  }
}
