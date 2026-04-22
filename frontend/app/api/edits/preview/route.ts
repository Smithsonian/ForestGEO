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
import { HTTPResponses } from '@/config/macros';
import { analyzeEdit, DisallowedFieldError, TargetNotFoundError } from '@/config/editplan/analyzer';
import { SpeciesNotFoundError } from '@/config/editplan/rules/context';
import {
  assertCanEditMeasurementScope,
  assertNoActiveMeasurementScopeConflict,
  ScopeAccessError,
  ScopeBusyError
} from '@/config/editplan/scopeguard';
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
    return NextResponse.json({ error: 'unauthorized' }, { status: HTTPResponses.UNAUTHORIZED });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: HTTPResponses.BAD_REQUEST });
  }

  const parsed = PreviewBody.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad body', details: parsed.error.flatten() }, { status: HTTPResponses.BAD_REQUEST });
  }

  const body = parsed.data;
  if (!isValidSchema(body.schema)) {
    return NextResponse.json({ error: 'invalid schema' }, { status: HTTPResponses.BAD_REQUEST });
  }
  try {
    assertSessionMayEdit(session);
  } catch (err) {
    if (err instanceof PendingUserEditForbiddenError) {
      return NextResponse.json({ error: 'pending users cannot edit measurements' }, { status: HTTPResponses.FORBIDDEN });
    }
    throw err;
  }

  const cm = ConnectionManager.getInstance();
  try {
    await assertCanEditMeasurementScope(cm, session, {
      schema: body.schema,
      plotID: body.plotID,
      censusID: body.censusID
    });
    await assertNoActiveMeasurementScopeConflict(cm, {
      schema: body.schema,
      plotID: body.plotID,
      censusID: body.censusID
    });

    const plan = await analyzeEdit(cm, body.schema, body.dataType, body.plotID, body.censusID, body.targetID, body.newRow, undefined, {
      role: session.user.userStatus
    });
    return NextResponse.json(plan, { status: HTTPResponses.OK });
  } catch (err) {
    if (err instanceof ScopeAccessError) {
      return NextResponse.json({ error: 'scope forbidden' }, { status: HTTPResponses.FORBIDDEN });
    }
    if (err instanceof ScopeBusyError) {
      return NextResponse.json({ error: err.message }, { status: HTTPResponses.LOCKED });
    }
    if (err instanceof DisallowedFieldError) {
      return NextResponse.json({ error: 'disallowed fields', fields: err.fields }, { status: HTTPResponses.UNPROCESSABLE_ENTITY });
    }
    if (err instanceof InvalidClearError) {
      return NextResponse.json({ error: 'invalid clear', field: err.field }, { status: HTTPResponses.UNPROCESSABLE_ENTITY });
    }
    if (err instanceof SpeciesNotFoundError) {
      return NextResponse.json({ error: 'species not found', code: err.code }, { status: HTTPResponses.UNPROCESSABLE_ENTITY });
    }
    if (err instanceof TargetNotFoundError) {
      return NextResponse.json({ error: 'target not found' }, { status: HTTPResponses.NOT_FOUND });
    }
    throw err;
  } finally {
    await cm.closeConnection();
  }
}
