// POST /api/edits/apply — hash-checked apply entry point for single-row edits.
//
// Requires a `planHash` in the body (no public bypass). applyEdit owns the
// measurement scope lock and transaction; errors are translated to HTTP
// responses below.
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/auth';
import ConnectionManager from '@/config/connectionmanager';
import { isValidSchema } from '@/config/utils/sqlsecurity';
import { HTTPResponses } from '@/config/macros';
import { DisallowedFieldError, EditPlanUnapplicableError, RoleForbiddenFieldError, TargetNotFoundError } from '@/config/editplan/analyzer';
import { MeasurementResolutionError } from '@/config/editplan/writers/resolvers-mutating';
import { SpeciesNotFoundError } from '@/config/editplan/rules/context';
import { applyEdit, HashDriftError, ScopeLockHeldError, SessionExpiredError } from '@/config/editplan/apply';
import { assertCanEditMeasurementScope, ScopeAccessError, ScopeBusyError } from '@/config/editplan/scopeguard';
import { InvalidClearError, InvalidFieldValueError } from '@/config/editplan/fieldpolicy';
import { assertSessionMayEdit, createFreshAuthorizationCheck, PendingUserEditForbiddenError } from '@/config/editplan/authorization';
import { requireSession } from '@/lib/auth-helpers';

export const runtime = 'nodejs';

const ApplyBody = z.object({
  schema: z.string(),
  plotID: z.number().int().positive(),
  censusID: z.number().int().positive(),
  dataType: z.enum(['measurementssummary', 'failedmeasurements']),
  targetID: z.number().int().positive(),
  newRow: z.record(z.string(), z.unknown()),
  planHash: z.string().length(64)
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await auth();
  const authError = requireSession(session);
  if (authError) return authError;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: HTTPResponses.BAD_REQUEST });
  }

  const parsed = ApplyBody.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad body', details: parsed.error.flatten() }, { status: HTTPResponses.BAD_REQUEST });
  }

  const body = parsed.data;
  if (!isValidSchema(body.schema)) {
    return NextResponse.json({ error: 'invalid schema' }, { status: HTTPResponses.BAD_REQUEST });
  }
  try {
    assertSessionMayEdit(session!);
  } catch (err) {
    if (err instanceof PendingUserEditForbiddenError) {
      return NextResponse.json({ error: 'pending users cannot edit measurements' }, { status: HTTPResponses.FORBIDDEN });
    }
    throw err;
  }

  const createdBy = session!.user?.email ?? session!.user?.name ?? 'unknown';

  const cm = ConnectionManager.getInstance();
  try {
    await assertCanEditMeasurementScope(cm, session!, {
      schema: body.schema,
      plotID: body.plotID,
      censusID: body.censusID
    });

    const result = await applyEdit(cm, {
      dataType: body.dataType,
      schema: body.schema,
      plotID: body.plotID,
      censusID: body.censusID,
      targetID: body.targetID,
      newRow: body.newRow,
      expectedPlanHash: body.planHash,
      createdBy,
      role: session!.user.userStatus,
      assertAuthorizationFresh: createFreshAuthorizationCheck(session!, {
        schema: body.schema,
        plotID: body.plotID,
        censusID: body.censusID
      })
    });
    return NextResponse.json(result, { status: HTTPResponses.OK });
  } catch (err) {
    if (err instanceof SessionExpiredError) {
      return NextResponse.json({ error: 'session expired' }, { status: HTTPResponses.UNAUTHORIZED });
    }
    if (err instanceof ScopeAccessError) {
      return NextResponse.json({ error: 'scope forbidden' }, { status: HTTPResponses.FORBIDDEN });
    }
    if (err instanceof ScopeBusyError) {
      return NextResponse.json({ error: err.message }, { status: HTTPResponses.LOCKED });
    }
    if (err instanceof HashDriftError) {
      return NextResponse.json({ error: 'plan hash mismatch', freshPlan: err.freshPlan }, { status: HTTPResponses.CONFLICT });
    }
    if (err instanceof ScopeLockHeldError) {
      return NextResponse.json({ error: 'scope locked' }, { status: HTTPResponses.LOCKED });
    }
    if (err instanceof RoleForbiddenFieldError) {
      return NextResponse.json({ error: 'role forbidden field', fields: err.fields, role: err.role }, { status: HTTPResponses.FORBIDDEN });
    }
    if (err instanceof EditPlanUnapplicableError) {
      return NextResponse.json({ error: 'plan not applicable', blockingErrors: err.blockingErrors }, { status: HTTPResponses.UNPROCESSABLE_ENTITY });
    }
    if (err instanceof MeasurementResolutionError) {
      return NextResponse.json({ error: err.message, subject: err.subject, reason: err.reason }, { status: HTTPResponses.UNPROCESSABLE_ENTITY });
    }
    if (err instanceof DisallowedFieldError) {
      return NextResponse.json({ error: 'disallowed fields', fields: err.fields }, { status: HTTPResponses.UNPROCESSABLE_ENTITY });
    }
    if (err instanceof InvalidClearError) {
      return NextResponse.json({ error: 'invalid clear', field: err.field }, { status: HTTPResponses.UNPROCESSABLE_ENTITY });
    }
    if (err instanceof InvalidFieldValueError) {
      return NextResponse.json({ error: 'invalid field value', field: err.field }, { status: HTTPResponses.UNPROCESSABLE_ENTITY });
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
