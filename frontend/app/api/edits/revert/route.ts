// POST /api/edits/revert — revert a prior single-row edit by EditOperationID.
//
// The caller must pass plotID/censusID for access-control consistency, but the
// actual revert operates on the ledger's recorded plotID/censusID. We validate
// that the caller-supplied scope matches the ledger before running the revert;
// a mismatch returns 403.
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/auth';
import ConnectionManager from '@/config/connectionmanager';
import { isValidSchema } from '@/config/utils/sqlsecurity';
import { DisallowedFieldError, TargetNotFoundError } from '@/config/editplan/analyzer';
import { SpeciesNotFoundError } from '@/config/editplan/rules/context';
import { HashDriftError, ScopeLockHeldError } from '@/config/editplan/apply';
import { AlreadyRevertedError, CannotRevertRevertError, EditOperationNotFoundError, revertEdit } from '@/config/editplan/revert';
import { readEditOperation } from '@/config/editoperations';

export const runtime = 'nodejs';

const RevertBody = z.object({
  schema: z.string(),
  plotID: z.number().int().positive(),
  censusID: z.number().int().positive(),
  editOperationID: z.number().int().positive()
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

  const parsed = RevertBody.safeParse(rawBody);
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
    const ledgerRow = await readEditOperation(cm, body.schema, body.editOperationID);
    if (!ledgerRow) {
      return NextResponse.json({ error: 'edit operation not found' }, { status: 404 });
    }
    if (ledgerRow.plotID !== body.plotID || ledgerRow.censusID !== body.censusID) {
      return NextResponse.json({ error: 'scope mismatch' }, { status: 403 });
    }

    const result = await revertEdit(cm, {
      schema: body.schema,
      editOperationID: body.editOperationID,
      createdBy
    });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof EditOperationNotFoundError) {
      return NextResponse.json({ error: 'edit operation not found' }, { status: 404 });
    }
    if (err instanceof AlreadyRevertedError) {
      return NextResponse.json({ error: 'already reverted', byEditOperationID: err.byEditOperationID }, { status: 409 });
    }
    if (err instanceof CannotRevertRevertError) {
      return NextResponse.json({ error: 'cannot revert a revert operation' }, { status: 422 });
    }
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
