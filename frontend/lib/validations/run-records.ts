/**
 * Validation run-record lifecycle (validation_runs table).
 *
 * Extracted from app/api/validations/run/route.ts POST/PATCH so the in-process
 * upload worker can create and update run records without HTTP. The route is
 * now a thin wrapper over these functions; its GET handler is untouched.
 */
import type ConnectionManager from '@/lib/db/connectionmanager';
import { safeFormatQuery } from '@/lib/db/sqlsecurity';
import { buildMeasurementScopeLockName, MEASUREMENT_SCOPE_LOCK_TIMEOUT_MS } from '@/config/measurementscopelock';
import ailogger from '@/ailogger';

/**
 * How long a "running" row is considered valid before we assume the owning
 * client died and allow a new run to take over.
 */
export const STALE_RUN_THRESHOLD_MINUTES = 15;

/** Terminal rows retained per plot+census when pruning validation_runs. */
const TERMINAL_RUN_RETENTION_COUNT = 5;

export type ValidationRunTerminalStatus = 'completed' | 'failed' | 'cancelled';

export interface ValidationRunCreateResult {
  runID: number | null;
  conflict: boolean;
  /** True when the measurement scope lock is held by another operation. */
  scopeLocked?: boolean;
  /** Set when a recent (< STALE_RUN_THRESHOLD_MINUTES) running row already exists. */
  existingRunID?: number;
}

export interface ValidationRunUpdate {
  currentStep?: string;
  completedSteps?: number;
  failedSteps?: number;
  errorMessages?: string[];
  status?: ValidationRunTerminalStatus;
}

/** Thrown when an update is requested with no fields set — callers map this to a 400. */
export class EmptyValidationRunUpdateError extends Error {
  constructor() {
    super('No fields to update');
    this.name = 'EmptyValidationRunUpdateError';
  }
}

/**
 * Create a new validation run row.
 *
 * Uses SELECT ... FOR UPDATE under the measurement scope lock to prevent two
 * concurrent starts for the same plot+census. A recent (< 15 min) running row
 * yields a conflict instead of a duplicate; a stale running row is cancelled
 * and taken over. Terminal rows are pruned to the most recent
 * TERMINAL_RUN_RETENTION_COUNT per plot+census.
 *
 * Owns its transaction: commits on every non-throwing path, rolls back and
 * rethrows on error.
 */
export async function createValidationRunRecord(
  connectionManager: ConnectionManager,
  schema: string,
  plotID: number,
  censusID: number,
  totalSteps: number
): Promise<ValidationRunCreateResult> {
  const transactionID = await connectionManager.beginTransaction();

  try {
    const scopeLockAcquired = await connectionManager.acquireApplicationLock(
      buildMeasurementScopeLockName(schema, plotID, censusID),
      transactionID,
      MEASUREMENT_SCOPE_LOCK_TIMEOUT_MS
    );
    if (!scopeLockAcquired) {
      await connectionManager.commitTransaction(transactionID);
      return { runID: null, conflict: true, scopeLocked: true };
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
        return { runID: null, conflict: true, existingRunID: existingRun.RunID };
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
    const result = await connectionManager.executeQuery(insertQuery, [plotID, censusID, totalSteps], transactionID);

    // Prune old terminal rows for this plot+census, keeping only the most recent.
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
             LIMIT ${TERMINAL_RUN_RETENTION_COUNT}
           ) AS recent
         )`
    );
    await connectionManager.executeQuery(pruneQuery, [plotID, censusID, plotID, censusID], transactionID);

    await connectionManager.commitTransaction(transactionID);

    return { runID: result.insertId, conflict: false };
  } catch (error) {
    await connectionManager.rollbackTransaction(transactionID);
    throw error;
  }
}

/**
 * Update an existing validation run's progress. Mirrors the PATCH handler:
 * only fields present in `update` are written, and CompletedAt is stamped when
 * transitioning to a terminal 'completed'/'failed' status.
 *
 * @throws EmptyValidationRunUpdateError when no fields are provided.
 */
export async function updateValidationRunRecord(
  connectionManager: ConnectionManager,
  schema: string,
  runID: number,
  update: ValidationRunUpdate
): Promise<void> {
  const setClauses: string[] = [];
  const params: any[] = [];

  if (update.completedSteps !== undefined) {
    setClauses.push('CompletedSteps = ?');
    params.push(update.completedSteps);
  }
  if (update.failedSteps !== undefined) {
    setClauses.push('FailedSteps = ?');
    params.push(update.failedSteps);
  }
  if (update.currentStep !== undefined) {
    setClauses.push('CurrentStep = ?');
    params.push(update.currentStep);
  }
  if (update.status !== undefined) {
    setClauses.push('Status = ?');
    params.push(update.status);
  }
  if (update.errorMessages !== undefined) {
    setClauses.push('ErrorMessages = ?');
    params.push(JSON.stringify(update.errorMessages));
  }

  // Set CompletedAt when transitioning to a terminal status
  if (update.status === 'completed' || update.status === 'failed') {
    setClauses.push('CompletedAt = NOW()');
  }

  if (setClauses.length === 0) {
    throw new EmptyValidationRunUpdateError();
  }

  params.push(runID);

  const query = safeFormatQuery(schema, `UPDATE ??.validation_runs SET ${setClauses.join(', ')} WHERE RunID = ?`);
  const result = await connectionManager.executeQuery(query, params);
  if (Number((result as { affectedRows?: number })?.affectedRows ?? 0) === 0) {
    ailogger.warn(`[ValidationRunRecord] updateValidationRunRecord: no row updated for RunID=${runID} — record may have been deleted`);
  }
}
