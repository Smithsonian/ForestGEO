import { NextRequest, NextResponse } from 'next/server';
import { HTTPResponses } from '@/config/macros';
import { isValidSchema, safeFormatQuery } from '@/config/utils/sqlsecurity';
import { getConn } from '@/lib/db/primitives';
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
// Scope model: schema membership grants the user access to every (plotID,
// censusID) in that schema. The `census` row probe below uses a combined
// PlotID + CensusID WHERE so a forged path-traversal that mixes a known
// PlotID with another schema's CensusID returns 404 (the row doesn't exist
// at that combination in this schema). This is consistent with the rest of
// the app's data routes, which gate on schema and not on per-plot ACLs.
//
// The PI/data-manager-only export authority Suzanne suggested (spec line 74)
// is still unresolved (Jess/David pending); current placeholder is:
//   - app admins (global / db admin) can export any schema, and can reload.
//   - lead technicians can export schemas in their session-scoped site list,
//     non-reload only.
// ---------------------------------------------------------------------------

function userCanExportSchema(session: Session, schema: string): boolean {
  const role = session.user?.userStatus;
  if (userIsAdmin(session)) {
    return true;
  }
  if (role !== 'lead technician') {
    return false;
  }
  return (session.user?.sites ?? []).some(site => site.schemaName === schema);
}

function userCanReload(session: Session): boolean {
  return userIsAdmin(session);
}

function userIsAdmin(session: Session): boolean {
  return session.user?.userStatus === 'global' || session.user?.userStatus === 'db admin';
}

function buildDownloadFilename(destinationPlotId: number, plotCensusNumber: string, timestampMs: number): string {
  // identifier-safety throws on an empty PlotCensusNumber slug before we get
  // here, so we don't need a fallback for the empty-string case.
  const censusSlug = plotCensusNumber
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return `ctfs-export-${destinationPlotId}-${censusSlug}-${timestampMs}.sql`;
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

  // --- Schema-level export permission ---
  if (!userCanExportSchema(session!, schema)) {
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
  if ((allowReload || reloadDryRun) && !userCanReload(session!)) {
    return NextResponse.json({ error: 'Reload export requires elevated permission' }, { status: HTTPResponses.FORBIDDEN });
  }

  // Single timestamp covers both the artifact header (passed to renderArtifact)
  // and the download filename — they used to be two distinct `Date.now()` calls
  // that could disagree if any async work landed between them.
  const generatedAt = new Date();

  // --- Database work ---
  const conn = await getConn();
  try {
    // Resolve PlotCensusNumber and verify (plotID, censusID) belongs to this
    // schema. The combined WHERE prevents path-traversal across schemas: a
    // CensusID from another schema returns no row here.
    const censusSql = safeFormatQuery(schema, `SELECT PlotCensusNumber FROM ??.census WHERE PlotID = ? AND CensusID = ? AND IsActive = 1`);
    const [censusRows] = await conn.query<any[]>(censusSql, [appPlotId, appCensusId]);
    if (!Array.isArray(censusRows) || censusRows.length === 0) {
      return NextResponse.json({ error: 'Census not found' }, { status: HTTPResponses.NOT_FOUND });
    }
    const plotCensusNumber = String(censusRows[0].PlotCensusNumber);

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

    // Render the complete SQL artifact.
    const { sql, procedureName, lockName } = renderArtifact({
      schema,
      appPlotId,
      destinationPlotId,
      appCensusId,
      plotCensusNumber,
      allowReload,
      reloadDryRun,
      generatedAt,
      measurementRows,
      attributeRows
    });

    const filename = buildDownloadFilename(destinationPlotId, plotCensusNumber, generatedAt.getTime());
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
    const error = err instanceof Error ? err : new Error(String(err));
    ailogger.error('ctfs-sql export failed', error, { schema, appPlotId, appCensusId });
    return NextResponse.json({ error: error.message || 'Export failed' }, { status: HTTPResponses.INTERNAL_SERVER_ERROR });
  } finally {
    conn.release();
  }
}
