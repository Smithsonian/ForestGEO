/**
 * Server-side validation orchestrator.
 *
 * Mirrors the client-side orchestration in config/validation-runner.ts
 * (list enabled validations, pair the two combined runs, execute sequentially,
 * track a validation_runs record, update passed rows, refresh views) but with
 * zero HTTP — every step is a direct function call so the in-process upload
 * worker can run post-ingestion validation without a browser.
 */
import type ConnectionManager from '@/config/connectionmanager';
import { safeFormatQuery } from '@/config/utils/sqlsecurity';
import ailogger from '@/ailogger';
import {
  runCombinedCrossCensusLocationValidations,
  runCombinedDBHValidations,
  runValidation,
  updateValidatedRows
} from '@/components/processors/processorhelperfunctions';
import { refreshMeasurementsSummaryForScope, refreshViewFullTableForScope } from '@/lib/measurementviewrefresh';
import { createValidationRunRecord, updateValidationRunRecord } from '@/lib/validations/run-records';

// Single source for these procedure names on the server. The client-side
// copies in components/client/validationcore.tsx and config/validation-runner.ts
// must stay local — importing this module there would pull ConnectionManager
// into the client bundle.
export const DBH_GROWTH_PROCEDURE = 'ValidateDBHGrowthExceedsMax';
export const DBH_SHRINKAGE_PROCEDURE = 'ValidateDBHShrinkageExceedsMax';
export const QUADRAT_MISMATCH_PROCEDURE = 'ValidateQuadratMismatchAcrossCensuses';
export const COORDINATE_DRIFT_PROCEDURE = 'ValidateCoordinateDriftAcrossCensuses';

export interface RunCensusValidationsParams {
  schema: string;
  plotID: number;
  censusID: number;
  /**
   * Invoked after each step with the step name and running completed/failed counts.
   * Failures are logged and swallowed; progress reporting never aborts a run.
   */
  onStep?: (name: string, completed: number, failed: number) => Promise<void>;
}

export interface CensusValidationSummary {
  totalSteps: number;
  /**
   * Count of TASK-level failures only — does not include post-pass phase errors
   * (updateValidatedRows, view refreshes). Post-pass errors are captured in
   * `errors` and drive the run record's terminal status, but keep this counter
   * bounded to the task count so callers can compare it against totalSteps.
   */
  failedSteps: number;
  errors: string[];
  conflict: boolean;
}

interface EnabledValidation {
  id: number;
  procedureName: string;
  definition: string;
}

interface ValidationStepResult {
  success: boolean;
  errorMessage?: string;
}

interface ValidationTask {
  name: string;
  execute: () => Promise<ValidationStepResult>;
}

/**
 * Lists enabled validations. Inlined here because the underlying core of
 * app/api/validations/validationlist/route.ts (GET) is trivially this single
 * query — kept in sync with that route.
 */
async function listEnabledValidations(connectionManager: ConnectionManager, schema: string): Promise<EnabledValidation[]> {
  const query = safeFormatQuery(schema, 'SELECT ValidationID, ProcedureName, Definition FROM ??.sitespecificvalidations WHERE IsEnabled = 1');
  const rows = await connectionManager.executeQuery(query);
  if (!Array.isArray(rows)) return [];
  return rows.map((row: any) => ({
    id: Number(row.ValidationID),
    procedureName: String(row.ProcedureName),
    definition: String(row.Definition ?? '')
  }));
}

/**
 * Builds the ordered task list with the same pairing rules as the client
 * runner: growth+shrinkage collapse into one combined DBH step, quadrat
 * mismatch + coordinate drift collapse into one combined cross-census step,
 * everything else runs individually. Standalone tasks come first, combined
 * tasks last, matching config/validation-runner.ts ordering.
 */
function buildValidationTasks(validations: EnabledValidation[], schema: string, plotID: number, censusID: number): ValidationTask[] {
  const byName = new Map(validations.map(validation => [validation.procedureName, validation]));
  const hasCombinedDBH = byName.has(DBH_GROWTH_PROCEDURE) && byName.has(DBH_SHRINKAGE_PROCEDURE);
  const hasCombinedCrossCensus = byName.has(QUADRAT_MISMATCH_PROCEDURE) && byName.has(COORDINATE_DRIFT_PROCEDURE);

  const combinedNames = new Set<string>();
  if (hasCombinedDBH) {
    combinedNames.add(DBH_GROWTH_PROCEDURE);
    combinedNames.add(DBH_SHRINKAGE_PROCEDURE);
  }
  if (hasCombinedCrossCensus) {
    combinedNames.add(QUADRAT_MISMATCH_PROCEDURE);
    combinedNames.add(COORDINATE_DRIFT_PROCEDURE);
  }

  const executionParams = { p_CensusID: censusID, p_PlotID: plotID };
  const tasks: ValidationTask[] = [];

  for (const validation of validations) {
    if (combinedNames.has(validation.procedureName)) continue;

    tasks.push({
      name: validation.procedureName,
      execute: async () => {
        const succeeded = await runValidation(validation.id, validation.procedureName, schema, validation.definition, executionParams);
        return succeeded ? { success: true } : { success: false, errorMessage: `Validation returned failure for ${validation.procedureName}` };
      }
    });
  }

  if (hasCombinedDBH) {
    tasks.push({
      name: `${DBH_GROWTH_PROCEDURE}+${DBH_SHRINKAGE_PROCEDURE}`,
      execute: async () => {
        const result = await runCombinedDBHValidations(schema, executionParams);
        return result.success ? { success: true } : { success: false, errorMessage: result.error ?? 'Shared DBH validation failed' };
      }
    });
  }

  if (hasCombinedCrossCensus) {
    tasks.push({
      name: `${QUADRAT_MISMATCH_PROCEDURE}+${COORDINATE_DRIFT_PROCEDURE}`,
      execute: async () => {
        const result = await runCombinedCrossCensusLocationValidations(schema, executionParams);
        return result.success ? { success: true } : { success: false, errorMessage: result.error ?? 'Shared cross-census validation failed' };
      }
    });
  }

  return tasks;
}

/**
 * Attempts a best-effort finalization of a stranded run record, suppressing any
 * errors from the finalization attempt itself so the caller can rethrow the
 * original error cleanly.
 */
async function finalizeRunRecordOnError(
  connectionManager: ConnectionManager,
  schema: string,
  runID: number,
  errors: string[],
  originalError: Error
): Promise<void> {
  try {
    await updateValidationRunRecord(connectionManager, schema, runID, {
      status: 'failed',
      errorMessages: [...errors, `Unexpected error: ${originalError.message}`]
    });
  } catch (finalizeError: any) {
    ailogger.warn(`[ValidationOrchestrator] Could not finalize run record ${runID} after error: ${finalizeError.message}`);
  }
}

/**
 * Runs every enabled validation for a plot+census, tracking progress in a
 * validation_runs record, then (when every step executed cleanly) flips
 * IsValidated on passed rows and refreshes the measurement views.
 *
 * Individual step failures are collected into the summary, never thrown —
 * only infrastructure errors (e.g. the run-record insert failing) propagate.
 * If an unexpected error escapes the execution region, the run record is
 * best-effort finalized as 'failed' before the error is rethrown.
 */
export async function runCensusValidations(connectionManager: ConnectionManager, params: RunCensusValidationsParams): Promise<CensusValidationSummary> {
  const { schema, plotID, censusID, onStep } = params;

  const validations = await listEnabledValidations(connectionManager, schema);
  const tasks = buildValidationTasks(validations, schema, plotID, censusID);

  if (tasks.length === 0) {
    // Mirrors the client runner: nothing to run, nothing to record.
    ailogger.info(`[ValidationOrchestrator] No enabled validations for ${schema} — skipping run`);
    return { totalSteps: 0, failedSteps: 0, errors: [], conflict: false };
  }

  const created = await createValidationRunRecord(connectionManager, schema, plotID, censusID, tasks.length);
  if (created.conflict || created.runID === null) {
    ailogger.warn(`[ValidationOrchestrator] Conflict creating validation run for ${schema} plot ${plotID} census ${censusID} — skipping`);
    return { totalSteps: 0, failedSteps: 0, errors: [], conflict: true };
  }
  const runID = created.runID;

  let completedSteps = 0;
  let failedSteps = 0;
  const errors: string[] = [];

  try {
    for (const task of tasks) {
      await updateValidationRunRecord(connectionManager, schema, runID, { currentStep: task.name });

      try {
        const result = await task.execute();
        if (result.success) {
          completedSteps++;
        } else {
          failedSteps++;
          errors.push(`Failed: ${task.name} — ${result.errorMessage}`);
          ailogger.error(`[ValidationOrchestrator] Failed: ${task.name} — ${result.errorMessage}`);
        }
      } catch (error: any) {
        failedSteps++;
        errors.push(`Failed: ${task.name} — ${error.message}`);
        ailogger.error(`[ValidationOrchestrator] Failed: ${task.name} — ${error.message}`);
      }

      await updateValidationRunRecord(connectionManager, schema, runID, {
        completedSteps,
        failedSteps,
        errorMessages: errors.length > 0 ? errors : undefined
      });

      try {
        await onStep?.(task.name, completedSteps, failedSteps);
      } catch (callbackError: any) {
        ailogger.warn(`[ValidationOrchestrator] onStep callback threw for step "${task.name}" — ignoring: ${callbackError.message}`);
      }
    }

    // Post-pass phase: errors here are appended to the errors array and drive the
    // final status, but do NOT increment failedSteps (which is task-scoped only).
    const postPassErrors: string[] = [];

    if (failedSteps === 0) {
      try {
        // Core of app/api/validations/updatepassedvalidations (POST): flips
        // IsValidated on rows with no unresolved validation errors.
        await updateValidatedRows(schema, { p_CensusID: censusID, p_PlotID: plotID });
      } catch (error: any) {
        postPassErrors.push(`Failed to update validated rows: ${error.message}`);
        ailogger.error(`[ValidationOrchestrator] Failed to update validated rows: ${error.message}`);
      }
    }

    try {
      await refreshMeasurementsSummaryForScope(connectionManager, schema, plotID, censusID);
    } catch (error: any) {
      postPassErrors.push(`Failed to refresh measurementssummary: ${error.message}`);
      ailogger.error(`[ValidationOrchestrator] Failed to refresh measurementssummary: ${error.message}`);
    }

    try {
      await refreshViewFullTableForScope(connectionManager, schema, plotID, censusID);
    } catch (error: any) {
      postPassErrors.push(`Failed to refresh viewfulltable: ${error.message}`);
      ailogger.error(`[ValidationOrchestrator] Failed to refresh viewfulltable: ${error.message}`);
    }

    errors.push(...postPassErrors);

    const finalStatus = failedSteps > 0 || postPassErrors.length > 0 ? 'failed' : 'completed';
    await updateValidationRunRecord(connectionManager, schema, runID, {
      status: finalStatus,
      completedSteps,
      failedSteps,
      errorMessages: errors.length > 0 ? errors : undefined
    });

    ailogger.info(`[ValidationOrchestrator] Run ${runID} ${finalStatus}: ${completedSteps} passed, ${failedSteps} failed`);
    return { totalSteps: tasks.length, failedSteps, errors, conflict: false };
  } catch (unexpectedError: any) {
    await finalizeRunRecordOnError(connectionManager, schema, runID, errors, unexpectedError);
    throw unexpectedError;
  }
}
