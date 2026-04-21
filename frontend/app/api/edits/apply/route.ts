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
import { DisallowedFieldError, TargetNotFoundError } from '@/config/editplan/analyzer';
import { SpeciesNotFoundError } from '@/config/editplan/rules/context';
import { applyEdit, HashDriftError, ScopeLockHeldError } from '@/config/editplan/apply';

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
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const parsed = ApplyBody.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad body', details: parsed.error.flatten() }, { status: 400 });
  }

  const body = parsed.data;
  if (!isValidSchema(body.schema)) {
    return NextResponse.json({ error: 'invalid schema' }, { status: 400 });
  }

  const createdBy = session.user?.email ?? session.user?.name ?? 'unknown';

  const cm = ConnectionManager.getInstance();
  try {
    const result = await applyEdit(cm, {
      dataType: body.dataType,
      schema: body.schema,
      plotID: body.plotID,
      censusID: body.censusID,
      targetID: body.targetID,
      newRow: body.newRow,
      expectedPlanHash: body.planHash,
      createdBy
    });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof HashDriftError) {
      return NextResponse.json({ error: 'plan hash mismatch', freshPlan: err.freshPlan }, { status: 409 });
    }
    if (err instanceof ScopeLockHeldError) {
      return NextResponse.json({ error: 'scope locked' }, { status: 423 });
    }
    if (err instanceof DisallowedFieldError) {
      return NextResponse.json({ error: 'disallowed fields', fields: err.fields }, { status: 422 });
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
