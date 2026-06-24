import { NextRequest, NextResponse } from 'next/server';
import { HTTPResponses } from '@/config/macros';
import { isValidSchema } from '@/config/utils/sqlsecurity';
import { auth } from '@/auth';
import { requireSession, getSessionUserId } from '@/lib/auth-helpers';
import ailogger from '@/ailogger';
import { renderRebuildViewFullTableArtifact } from '@/lib/ctfs-export';
import { userCanExportSchema } from '@/lib/ctfs-export/export-permissions';

// Force Node.js runtime — the ctfs-export renderer is not Edge-compatible.
export const runtime = 'nodejs';

type RouteProps = { params: Promise<{ schema: string }> };

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

export async function GET(request: NextRequest, props: RouteProps): Promise<NextResponse> {
  const session = await auth();
  const authError = requireSession(session);
  if (authError) return authError;

  const { schema } = await props.params;

  if (!isValidSchema(schema)) {
    return NextResponse.json({ error: 'Invalid schema name' }, { status: HTTPResponses.BAD_REQUEST });
  }
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
    ? `ctfs-rebuild-viewfulltable-${destinationPlotID}-${generatedAt.getTime()}.sql`
    : `ctfs-rebuild-viewfulltable-${generatedAt.getTime()}.sql`;

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
