// POST /api/edits/revert — revert a prior single-row edit by EditOperationID.
//
// The caller must pass plotID/censusID for access-control consistency, but the
// actual revert operates on the ledger's recorded plotID/censusID. We validate
// that the caller-supplied scope matches the ledger before running the revert;
// a mismatch returns 403.
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/auth';
import ConnectionManager from '@/lib/db/connectionmanager';
import { isValidSchema } from '@/lib/db/sqlsecurity';
import { HTTPResponses } from '@/config/macros';
import { DisallowedFieldError, RoleForbiddenFieldError, TargetNotFoundError } from '@/config/editplan/analyzer';
import { SpeciesNotFoundError } from '@/config/editplan/rules/context';
import { HashDriftError, ScopeLockHeldError, SessionExpiredError } from '@/config/editplan/apply';
import {
  AlreadyRevertedError,
  CannotRevertRevertError,
  EditOperationNotFoundError,
  NonRevertableEditOperationError,
  RevertDriftError,
  RevertRecordChangedError,
  revertEdit
} from '@/config/editplan/revert';
import { assertCanEditMeasurementScope, assertNoActiveMeasurementScopeConflict, ScopeAccessError, ScopeBusyError } from '@/config/editplan/scopeguard';
import { ensureEditOperationsTable, EditOperationStateIntegrityError, readEditOperation } from '@/config/editoperations';
import { InvalidClearError, InvalidFieldValueError } from '@/config/editplan/fieldpolicy';
import { assertSessionMayEdit, createFreshAuthorizationCheck, PendingUserEditForbiddenError } from '@/config/editplan/authorization';
import { requireSession } from '@/lib/auth-helpers';
import { SpeciesCorrectionUndoMetadataError } from '@/config/editplan/species-correction-undo-metadata';
import {
  SPECIES_CORRECTION_UNDO_CONFLICT_GUIDANCE,
  SpeciesCorrectionUndoCurrentStateConflictError,
  SpeciesCorrectionUndoUnapplicableError
} from '@/config/editplan/species-correction-undo';
import { SpeciesCorrectionWriteConflictError } from '@/config/editplan/tree-species-correction-writer';

export const runtime = 'nodejs';

const PLAN_HASH_LENGTH = 64;

// The writer's conflict reason carries SQL/plan internals in its `message`
// — never surfaced to the client. This fixed message/code mirrors
// apply/route.ts's own SPECIES_CORRECTION_CONFLICT_* handling for the same
// underlying "tree species state moved" situation, reached here via undo.
const SPECIES_CORRECTION_REVERT_CONFLICT_CODE = 'species-correction-revert-conflict';
const SPECIES_CORRECTION_REVERT_CONFLICT_MESSAGE = "This tree's species state changed since this revert was previewed. Refresh and retry the revert.";
const SPECIES_CORRECTION_UNDO_CONFLICT_CODE = 'species-correction-undo-conflict';

const RevertBody = z.object({
  schema: z.string(),
  plotID: z.number().int().positive(),
  censusID: z.number().int().positive(),
  editOperationID: z.number().int().positive(),
  confirmedPlanHash: z.string().length(PLAN_HASH_LENGTH).optional()
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

  const parsed = RevertBody.safeParse(rawBody);
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
    await assertNoActiveMeasurementScopeConflict(cm, {
      schema: body.schema,
      plotID: body.plotID,
      censusID: body.censusID
    });
    await ensureEditOperationsTable(cm, body.schema);

    const ledgerRow = await readEditOperation(cm, body.schema, body.editOperationID);
    if (!ledgerRow) {
      return NextResponse.json({ error: 'edit operation not found' }, { status: HTTPResponses.NOT_FOUND });
    }
    if (ledgerRow.plotID !== body.plotID || ledgerRow.censusID !== body.censusID) {
      return NextResponse.json({ error: 'scope mismatch' }, { status: HTTPResponses.FORBIDDEN });
    }

    const result = await revertEdit(cm, {
      schema: body.schema,
      editOperationID: body.editOperationID,
      createdBy,
      confirmedPlanHash: body.confirmedPlanHash,
      role: session!.user.userStatus,
      assertAuthorizationFresh: createFreshAuthorizationCheck(session!, {
        schema: body.schema,
        plotID: body.plotID,
        censusID: body.censusID
      }),
      // Rechecked inside revertEdit against both the discovery read and the
      // post-lock FOR UPDATE recheck — the "scope mismatch" check above only
      // covers the moment before the transaction opens.
      expectedScope: { plotID: body.plotID, censusID: body.censusID }
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
    if (err instanceof EditOperationNotFoundError) {
      return NextResponse.json({ error: 'edit operation not found' }, { status: HTTPResponses.NOT_FOUND });
    }
    if (err instanceof AlreadyRevertedError) {
      return NextResponse.json({ error: 'already reverted', byEditOperationID: err.byEditOperationID }, { status: HTTPResponses.CONFLICT });
    }
    if (err instanceof CannotRevertRevertError) {
      return NextResponse.json({ error: 'cannot revert a revert operation' }, { status: HTTPResponses.UNPROCESSABLE_ENTITY });
    }
    if (err instanceof NonRevertableEditOperationError) {
      return NextResponse.json({ error: 'edit operation is not revertable' }, { status: HTTPResponses.UNPROCESSABLE_ENTITY });
    }
    if (err instanceof RevertDriftError) {
      return NextResponse.json({ error: 'revert drift', freshPlan: err.freshPlan }, { status: HTTPResponses.CONFLICT });
    }
    if (err instanceof RevertRecordChangedError) {
      return NextResponse.json({ error: 'edit operation changed during revert, please retry' }, { status: HTTPResponses.CONFLICT });
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
    if (err instanceof SpeciesCorrectionUndoMetadataError) {
      return NextResponse.json({ error: 'species correction metadata is invalid' }, { status: HTTPResponses.UNPROCESSABLE_ENTITY });
    }
    if (err instanceof EditOperationStateIntegrityError) {
      return NextResponse.json({ error: 'edit operation state is invalid' }, { status: HTTPResponses.UNPROCESSABLE_ENTITY });
    }
    if (err instanceof SpeciesCorrectionUndoUnapplicableError) {
      return NextResponse.json({ error: 'species correction undo is not applicable' }, { status: HTTPResponses.UNPROCESSABLE_ENTITY });
    }
    if (err instanceof SpeciesCorrectionUndoCurrentStateConflictError) {
      return NextResponse.json(
        {
          error: SPECIES_CORRECTION_UNDO_CONFLICT_GUIDANCE,
          code: SPECIES_CORRECTION_UNDO_CONFLICT_CODE,
          conflictKinds: err.conflicts.map(conflict => conflict.kind)
        },
        { status: HTTPResponses.UNPROCESSABLE_ENTITY }
      );
    }
    if (err instanceof SpeciesCorrectionWriteConflictError) {
      return NextResponse.json(
        { error: SPECIES_CORRECTION_REVERT_CONFLICT_MESSAGE, code: SPECIES_CORRECTION_REVERT_CONFLICT_CODE },
        { status: HTTPResponses.UNPROCESSABLE_ENTITY }
      );
    }
    throw err;
  } finally {
    await cm.closeConnection();
  }
}
