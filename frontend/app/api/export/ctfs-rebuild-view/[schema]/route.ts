import { NextRequest, NextResponse } from 'next/server';
import { HTTPResponses } from '@/config/macros';
import { isValidSchema } from '@/lib/db/sqlsecurity';
import { auth } from '@/auth';
import { getSessionUserId } from '@/lib/auth-helpers';
import { fromPath, withRouteAuthz, type RouteContext } from '@/lib/route-authz';
import ailogger from '@/ailogger';
import { renderRebuildViewFullTableArtifact } from '@/lib/ctfs-export';
import { userCanExportSchema } from '@/lib/ctfs-export/export-permissions';

// Force Node.js runtime — the ctfs-export renderer is not Edge-compatible.
export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// GET /api/export/ctfs-rebuild-view/[schema]
//
// Standalone "Rebuild ViewFullTable" download (D5). Keyed on `schema` only —
// used for the permission check and audit, nothing else. Unlike the publish
// route this performs NO app-schema DB query: it neither verifies a
// (plotID, censusID) row nor resolves PlotCensusNumber. The artifact targets
// DATABASE() on whatever destination the operator runs it against and is
// byte-identical for every caller; only the audit record varies.
// ---------------------------------------------------------------------------

async function handler(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const params = await context.params;
  const schema = params.schema as string;

  // withRouteAuthz already authenticated the session and enforced per-site
  // access (schema membership); re-read the session here for identity and the
  // additional export-role gate below.
  const session = await auth();

  // defense-in-depth: withRouteAuthz validates the schema before this handler runs.
  if (!isValidSchema(schema)) {
    return NextResponse.json({ error: 'Invalid schema name' }, { status: HTTPResponses.BAD_REQUEST });
  }

  // Additional export-role restriction beyond the guard's schema-membership
  // check: assertSchemaAccess admits ANY member of the schema, but only admins
  // and lead technicians may export (userCanExportSchema).
  if (!userCanExportSchema(session!, schema)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: HTTPResponses.FORBIDDEN });
  }

  // Optional, UNVERIFIED operator-correlation hint. Recorded in the audit log
  // and filename only — never used to build the artifact. Accept only a
  // non-negative integer so it cannot inject characters into the
  // Content-Disposition header.
  const destinationPlotIDRaw = request.nextUrl.searchParams.get('destinationPlotID');
  const destinationPlotID = destinationPlotIDRaw != null && /^\d+$/.test(destinationPlotIDRaw) ? destinationPlotIDRaw : undefined;

  const generatedAt = new Date();
  const sql = renderRebuildViewFullTableArtifact();
  const filename = destinationPlotID
    ? `smithsonian-rebuild-viewfulltable-${destinationPlotID}-${generatedAt.getTime()}.sql`
    : `smithsonian-rebuild-viewfulltable-${generatedAt.getTime()}.sql`;

  ailogger.info('ctfs-viewfulltable rebuild generated', {
    userId: getSessionUserId(session!),
    schema,
    destinationPlotID,
    generatedAt: generatedAt.toISOString(),
    filename
  });

  return new NextResponse(sql, {
    status: HTTPResponses.OK,
    headers: {
      'Content-Type': 'application/sql; charset=utf-8',
      'Content-Disposition': `attachment; filename=${filename}`
    }
  });
}

export const GET = withRouteAuthz('export/ctfs-rebuild-view/[schema]', handler, { schema: fromPath('schema') });
