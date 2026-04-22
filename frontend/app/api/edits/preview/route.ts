// POST /api/edits/preview — read-only analyzer entry point for single-row edits.
//
// Preview enforces schema/plot/census scope and probes active upload/validation
// conflicts before returning effects for user review. Apply still owns the
// authoritative scope lock and hash re-check.
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/auth';
import ConnectionManager from '@/config/connectionmanager';
import { isValidSchema } from '@/config/utils/sqlsecurity';
import { analyzeEdit, DisallowedFieldError, TargetNotFoundError } from '@/config/editplan/analyzer';
import { SpeciesNotFoundError } from '@/config/editplan/rules/context';
import { assertEditScopeAllowed, EditScopeConflictError, EditScopeForbiddenError } from '@/config/editplan/scopeguard';
import { InvalidClearError } from '@/config/editplan/fieldpolicy';
import { assertSessionMayEdit, PendingUserEditForbiddenError } from '@/config/editplan/authorization';

export const runtime = 'nodejs';

const PreviewBody = z.object({
  schema: z.string(),
  plotID: z.number().int().positive(),
  censusID: z.number().int().positive(),
  dataType: z.enum(['measurementssummary', 'failedmeasurements']),
  targetID: z.number().int().positive(),
  newRow: z.record(z.string(), z.unknown())
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const parsed = PreviewBody.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad body', details: parsed.error.flatten() }, { status: 400 });
  }

  const body = parsed.data;
  if (!isValidSchema(body.schema)) {
    return NextResponse.json({ error: 'invalid schema' }, { status: 400 });
  }
  try {
    assertSessionMayEdit(session);
  } catch (err) {
    if (err instanceof PendingUserEditForbiddenError) {
      return NextResponse.json({ error: 'pending users cannot edit measurements' }, { status: 403 });
    }
    throw err;
  }

  const cm = ConnectionManager.getInstance();
  try {
    await assertEditScopeAllowed(cm, session, {
      schema: body.schema,
      plotID: body.plotID,
      censusID: body.censusID
    });

    const plan = await analyzeEdit(cm, body.schema, body.dataType, body.plotID, body.censusID, body.targetID, body.newRow, undefined, {
      role: session.user.userStatus
    });
    return NextResponse.json(plan, { status: 200 });
  } catch (err) {
    if (err instanceof EditScopeForbiddenError) {
      return NextResponse.json({ error: 'scope forbidden' }, { status: 403 });
    }
    if (err instanceof EditScopeConflictError) {
      return NextResponse.json({ error: err.message }, { status: 423 });
    }
    if (err instanceof DisallowedFieldError) {
      return NextResponse.json({ error: 'disallowed fields', fields: err.fields }, { status: 422 });
    }
    if (err instanceof InvalidClearError) {
      return NextResponse.json({ error: 'invalid clear', field: err.field }, { status: 422 });
    }
    if (err instanceof SpeciesNotFoundError) {
      return NextResponse.json({ error: 'species not found', code: err.code }, { status: 422 });
    }
    if (err instanceof TargetNotFoundError) {
      return NextResponse.json({ error: 'target not found' }, { status: 404 });
    }
    throw err;
  } finally {
    await cm.closeConnection();
  }
}
