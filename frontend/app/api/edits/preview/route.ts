// POST /api/edits/preview — read-only analyzer entry point for single-row edits.
//
// Phase 1 simplification: preview does NOT probe upload-session / validation-run
// conflicts and does NOT acquire the measurement scope lock. Preview is a
// best-effort analysis; the authoritative guarantee is at apply time, where the
// scope lock and hash re-check catch drift (ScopeLockHeldError → 423,
// HashDriftError → 409). See Task 11 acceptance criteria in
// docs/superpowers/plans/2026-04-21-row-editing-consistency.md.
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/auth';
import ConnectionManager from '@/config/connectionmanager';
import { isValidSchema } from '@/config/utils/sqlsecurity';
import { analyzeEdit, DisallowedFieldError, TargetNotFoundError } from '@/config/editplan/analyzer';
import { SpeciesNotFoundError } from '@/config/editplan/rules/context';

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

  const cm = ConnectionManager.getInstance();
  try {
    const plan = await analyzeEdit(cm, body.schema, body.dataType, body.plotID, body.censusID, body.targetID, body.newRow);
    return NextResponse.json(plan, { status: 200 });
  } catch (err) {
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
