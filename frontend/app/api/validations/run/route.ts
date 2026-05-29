import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/config/connectionmanager';
import { HTTPResponses } from '@/config/macros';
import { safeFormatQuery } from '@/config/utils/sqlsecurity';
import ailogger from '@/ailogger';
import { buildMeasurementScopeLockName, MEASUREMENT_SCOPE_LOCK_TIMEOUT_MS } from '@/config/measurementscopelock';

export const runtime = 'nodejs';

/**
 * How long a "running" row is considered valid before we assume the owning
 * client died and allow a new run to take over.
 */
const STALE_RUN_THRESHOLD_MINUTES = 15;

/**
 * POST /api/validations/run — Create a new validation run.
 *
 * Uses SELECT ... FOR UPDATE to prevent two tabs from concurrently starting
 * validation for the same plot+census.  If a recent (< 15 min) running row
 * exists we return `{ conflict: true }` instead of creating a duplicate.
 */
export async function POST(request: NextRequest) {
  const connectionManager = ConnectionManager.getInstance();
  let transactionID = '';

  try {
    const { schema, plotID, censusID, totalSteps } = await request.json();

    if (!schema || !plotID || !censusID) {
      return NextResponse.json({ error: 'Missing required parameters: schema, plotID, censusID' }, { status: HTTPResponses.INVALID_REQUEST });
    }

    transactionID = await connectionManager.beginTransaction();

    const scopeLockAcquired = await connectionManager.acquireApplicationLock(
      buildMeasurementScopeLockName(schema, plotID, censusID),
      transactionID,
      MEASUREMENT_SCOPE_LOCK_TIMEOUT_MS
    );
    if (!scopeLockAcquired) {
      await connectionManager.commitTransaction(transactionID);
      return NextResponse.json({ conflict: true, reason: 'A measurement operation is already in progress for this plot/census' }, { status: HTTPResponses.OK });
    }

    // Lock-check: is there already a recent running row?
    const lockQuery = safeFormatQuery(
      schema,
      `SELECT RunID, StartedAt
       FROM ??.validation_runs
       WHERE PlotID = ? AND CensusID = ? AND Status = 'running'
       ORDER BY RunID DESC
       LIMIT 1
       FOR UPDATE`
    );
    const existingRows = await connectionManager.executeQuery(lockQuery, [plotID, censusID], transactionID);

    if (Array.isArray(existingRows) && existingRows.length > 0) {
      const existingRun = existingRows[0];
      const startedAt = new Date(existingRun.StartedAt).getTime();
      const ageMinutes = (Date.now() - startedAt) / 60_000;

      if (ageMinutes < STALE_RUN_THRESHOLD_MINUTES) {
        // Another client is actively running — don't create a duplicate
        await connectionManager.commitTransaction(transactionID);
        return NextResponse.json({ conflict: true, existingRunID: existingRun.RunID }, { status: HTTPResponses.OK });
      }

      // Stale row — cancel it so we can take over
      const cancelQuery = safeFormatQuery(
        schema,
        `UPDATE ??.validation_runs
         SET Status = 'cancelled', CompletedAt = NOW()
         WHERE RunID = ?`
      );
      await connectionManager.executeQuery(cancelQuery, [existingRun.RunID], transactionID);
    }

    // Insert new run
    const insertQuery = safeFormatQuery(
      schema,
      `INSERT INTO ??.validation_runs (PlotID, CensusID, TotalSteps, Status)
       VALUES (?, ?, ?, 'running')`
    );
    const result = await connectionManager.executeQuery(insertQuery, [plotID, censusID, totalSteps ?? 0], transactionID);

    // Prune old terminal rows for this plot+census, keeping only the 5 most recent.
    // This prevents unbounded table growth over months of usage.
    const pruneQuery = safeFormatQuery(
      schema,
      `DELETE FROM ??.validation_runs
       WHERE PlotID = ? AND CensusID = ? AND Status IN ('completed', 'failed', 'cancelled')
         AND RunID NOT IN (
           SELECT RunID FROM (
             SELECT RunID FROM ??.validation_runs
             WHERE PlotID = ? AND CensusID = ? AND Status IN ('completed', 'failed', 'cancelled')
             ORDER BY RunID DESC
             LIMIT 5
           ) AS recent
         )`
    );
    await connectionManager.executeQuery(pruneQuery, [plotID, censusID, plotID, censusID], transactionID);

    await connectionManager.commitTransaction(transactionID);

    return NextResponse.json({ runID: result.insertId, conflict: false }, { status: HTTPResponses.OK });
  } catch (e: any) {
    ailogger.error('Error creating validation run:', e);
    if (transactionID) {
      await connectionManager.rollbackTransaction(transactionID);
    }
    return NextResponse.json({ error: e.message }, { status: HTTPResponses.INTERNAL_SERVER_ERROR });
  } finally {
    await connectionManager.closeConnection();
  }
}

/**
 * GET /api/validations/run?schema=&plotID=&censusID= — Get the latest run for
 * this plot+census.
 */
export async function GET(request: NextRequest) {
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
 */
export async function PATCH(request: NextRequest) {
  const connectionManager = ConnectionManager.getInstance();

  try {
    const { schema, runID, completedSteps, failedSteps, currentStep, status, errorMessages } = await request.json();

    if (!schema || !runID) {
      return NextResponse.json({ error: 'Missing required parameters: schema, runID' }, { status: HTTPResponses.INVALID_REQUEST });
    }

    const setClauses: string[] = [];
    const params: any[] = [];

    if (completedSteps !== undefined) {
      setClauses.push('CompletedSteps = ?');
      params.push(completedSteps);
    }
    if (failedSteps !== undefined) {
      setClauses.push('FailedSteps = ?');
      params.push(failedSteps);
    }
    if (currentStep !== undefined) {
      setClauses.push('CurrentStep = ?');
      params.push(currentStep);
    }
    if (status !== undefined) {
      setClauses.push('Status = ?');
      params.push(status);
    }
    if (errorMessages !== undefined) {
      setClauses.push('ErrorMessages = ?');
      params.push(JSON.stringify(errorMessages));
    }

    // Set CompletedAt when transitioning to a terminal status
    if (status === 'completed' || status === 'failed') {
      setClauses.push('CompletedAt = NOW()');
    }

    if (setClauses.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: HTTPResponses.INVALID_REQUEST });
    }

    params.push(runID);

    const query = safeFormatQuery(schema, `UPDATE ??.validation_runs SET ${setClauses.join(', ')} WHERE RunID = ?`);
    await connectionManager.executeQuery(query, params);

    return NextResponse.json({ success: true }, { status: HTTPResponses.OK });
  } catch (e: any) {
    ailogger.error('Error updating validation run:', e);
    return NextResponse.json({ error: e.message }, { status: HTTPResponses.INTERNAL_SERVER_ERROR });
  } finally {
    await connectionManager.closeConnection();
  }
}
