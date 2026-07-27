import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/lib/db/connectionmanager';
import { HTTPResponses } from '@/config/macros';
import { safeFormatQuery } from '@/lib/db/sqlsecurity';
import ailogger from '@/ailogger';
import { fromBody, fromQuery, withRouteAuthz } from '@/lib/route-authz';
import { createValidationRunRecord, EmptyValidationRunUpdateError, updateValidationRunRecord } from '@/lib/validations/run-records';

export const runtime = 'nodejs';

/**
 * POST /api/validations/run — Create a new validation run.
 *
 * Thin wrapper over createValidationRunRecord (lib/validations/run-records.ts),
 * which owns the scope lock, stale-run takeover, insert, and prune logic.
 *
 * Per-site authorization is enforced by `withRouteAuthz` (see the wrapped
 * export below); it resolves the schema from the JSON body and rejects
 * out-of-scope requests with 403 before this handler runs.
 */
async function postHandler(request: NextRequest) {
  const connectionManager = ConnectionManager.getInstance();

  try {
    const { schema, plotID, censusID, totalSteps } = await request.json();

    if (!schema || !plotID || !censusID) {
      return NextResponse.json({ error: 'Missing required parameters: schema, plotID, censusID' }, { status: HTTPResponses.INVALID_REQUEST });
    }

    const result = await createValidationRunRecord(connectionManager, schema, plotID, censusID, totalSteps ?? 0);

    if (result.conflict) {
      if (result.scopeLocked) {
        return NextResponse.json(
          { conflict: true, reason: 'A measurement operation is already in progress for this plot/census' },
          { status: HTTPResponses.OK }
        );
      }
      return NextResponse.json({ conflict: true, existingRunID: result.existingRunID }, { status: HTTPResponses.OK });
    }

    return NextResponse.json({ runID: result.runID, conflict: false }, { status: HTTPResponses.OK });
  } catch (e: any) {
    ailogger.error('Error creating validation run:', e);
    return NextResponse.json({ error: e.message }, { status: HTTPResponses.INTERNAL_SERVER_ERROR });
  } finally {
    await connectionManager.closeConnection();
  }
}

/**
 * GET /api/validations/run?schema=&plotID=&censusID= — Get the latest run for
 * this plot+census.
 */
async function getHandler(request: NextRequest) {
  const connectionManager = ConnectionManager.getInstance();

  try {
    const { searchParams } = new URL(request.url);
    const schema = searchParams.get('schema');
    const plotID = searchParams.get('plotID');
    const censusID = searchParams.get('censusID');

    if (!schema || !plotID || !censusID) {
      return NextResponse.json({ error: 'Missing required parameters: schema, plotID, censusID' }, { status: HTTPResponses.INVALID_REQUEST });
    }

    const query = safeFormatQuery(
      schema,
      `SELECT RunID, PlotID, CensusID, Status, TotalSteps, CompletedSteps,
              FailedSteps, CurrentStep, ErrorMessages, StartedAt, CompletedAt
       FROM ??.validation_runs
       WHERE PlotID = ? AND CensusID = ?
       ORDER BY RunID DESC
       LIMIT 1`
    );

    const rows = await connectionManager.executeQuery(query, [Number(plotID), Number(censusID)]);
    const run = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;

    return NextResponse.json({ run }, { status: HTTPResponses.OK });
  } catch (e: any) {
    ailogger.error('Error fetching validation run:', e);
    return NextResponse.json({ error: e.message }, { status: HTTPResponses.INTERNAL_SERVER_ERROR });
  } finally {
    await connectionManager.closeConnection();
  }
}

/**
 * PATCH /api/validations/run — Update an existing validation run's progress.
 *
 * Thin wrapper over updateValidationRunRecord (lib/validations/run-records.ts).
 */
async function patchHandler(request: NextRequest) {
  const connectionManager = ConnectionManager.getInstance();

  try {
    const { schema, runID, completedSteps, failedSteps, currentStep, status, errorMessages } = await request.json();

    if (!schema || !runID) {
      return NextResponse.json({ error: 'Missing required parameters: schema, runID' }, { status: HTTPResponses.INVALID_REQUEST });
    }

    await updateValidationRunRecord(connectionManager, schema, runID, { completedSteps, failedSteps, currentStep, status, errorMessages });

    return NextResponse.json({ success: true }, { status: HTTPResponses.OK });
  } catch (e: any) {
    if (e instanceof EmptyValidationRunUpdateError) {
      return NextResponse.json({ error: 'No fields to update' }, { status: HTTPResponses.INVALID_REQUEST });
    }
    ailogger.error('Error updating validation run:', e);
    return NextResponse.json({ error: e.message }, { status: HTTPResponses.INTERNAL_SERVER_ERROR });
  } finally {
    await connectionManager.closeConnection();
  }
}

// Per-method schema resolvers: POST/PATCH read the schema from the JSON body,
// GET reads it from the query string. Each method enforces per-site authz
// before its handler runs.
export const POST = withRouteAuthz('validations/run', postHandler, { schema: fromBody('schema') });
export const GET = withRouteAuthz('validations/run', getHandler, { schema: fromQuery('schema') });
export const PATCH = withRouteAuthz('validations/run', patchHandler, { schema: fromBody('schema') });
