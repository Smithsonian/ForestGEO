/**
 * Module-level singleton that owns background validation execution.
 *
 * Unlike a React hook, this lives in module scope — it survives component
 * unmounts, route transitions, and re-renders.  Upload components call
 * `ValidationRunner.start()` and forget; the runner updates Zustand and
 * the DB as it progresses.
 */

import { useAppStore } from '@/config/store/appstore';
import { readValidationStream } from '@/components/processors/readvalidationstream';
import { isNetworkValidationFetchFailure } from '@/components/client/validationcore';
import ailogger from '@/ailogger';
import { getValidationTaskTimeoutMs, resolveValidationRunPersistence } from '@/config/validation-runner-utils';

const DBH_GROWTH_PROCEDURE = 'ValidateDBHGrowthExceedsMax';
const DBH_SHRINKAGE_PROCEDURE = 'ValidateDBHShrinkageExceedsMax';
const QUADRAT_MISMATCH_PROCEDURE = 'ValidateQuadratMismatchAcrossCensuses';
const COORDINATE_DRIFT_PROCEDURE = 'ValidateCoordinateDriftAcrossCensuses';

type ValidationMessages = Record<string, { id: number; description: string; definition: string }>;

export interface ValidationRunParams {
  schema: string;
  plotID: number;
  censusID: number;
}

interface ValidationTask {
  name: string;
  run: (signal: AbortSignal) => Promise<boolean>;
}

// ─── Module-level state ──────────────────────────────────────────────────────

let activeAbortController: AbortController | null = null;
let activeParams: ValidationRunParams | null = null;

function getStore() {
  return useAppStore.getState();
}

async function readResponsePayload(response: Response) {
  try {
    return await response.clone().json();
  } catch {
    try {
      const text = await response.text();
      return text ? { error: text } : null;
    } catch {
      return null;
    }
  }
}

async function patchRun(schema: string, runID: number | null, update: Record<string, unknown>) {
  if (runID === null) {
    return;
  }

  try {
    const response = await fetch('/api/validations/run', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schema, runID, ...update })
    });

    if (!response.ok) {
      const body = await readResponsePayload(response);
      ailogger.error('[ValidationRunner] Failed to patch run:', new Error(body?.error || `HTTP ${response.status}`));
    }
  } catch (err: any) {
    ailogger.error('[ValidationRunner] Failed to patch run:', err);
  }
}

async function refreshMeasurementsSummary(schema: string, plotID: number, censusID: number, signal: AbortSignal) {
  const response = await fetch(`/api/refreshviews/measurementssummary/${schema}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({ plotID, censusID })
  });

  if (!response.ok) {
    const body = await readResponsePayload(response);
    throw new Error(body?.error || `HTTP ${response.status}`);
  }
}

async function refreshViewFullTable(schema: string, plotID: number, censusID: number, signal: AbortSignal) {
  const response = await fetch(`/api/refreshviews/viewfulltable/${schema}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({ plotID, censusID })
  });

  if (!response.ok) {
    const body = await readResponsePayload(response);
    throw new Error(body?.error || `HTTP ${response.status}`);
  }
}

function buildValidationTasks(validationMessages: ValidationMessages, schema: string, plotID: number, censusID: number): ValidationTask[] {
  const allNames = Object.keys(validationMessages);
  const hasCombinedDBH = Boolean(validationMessages[DBH_GROWTH_PROCEDURE] && validationMessages[DBH_SHRINKAGE_PROCEDURE]);
  const hasCombinedCrossCensus = Boolean(validationMessages[QUADRAT_MISMATCH_PROCEDURE] && validationMessages[COORDINATE_DRIFT_PROCEDURE]);

  const combinedNames = new Set<string>();
  if (hasCombinedDBH) {
    combinedNames.add(DBH_GROWTH_PROCEDURE);
    combinedNames.add(DBH_SHRINKAGE_PROCEDURE);
  }
  if (hasCombinedCrossCensus) {
    combinedNames.add(QUADRAT_MISMATCH_PROCEDURE);
    combinedNames.add(COORDINATE_DRIFT_PROCEDURE);
  }

  const tasks: ValidationTask[] = [];

  for (const procedureName of allNames) {
    if (combinedNames.has(procedureName)) continue;

    const { id: validationProcedureID, definition: cursorQuery } = validationMessages[procedureName];
    tasks.push({
      name: procedureName,
      run: async (signal: AbortSignal) => {
        const response = await fetch(`/api/validations/procedures/${procedureName}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal,
          body: JSON.stringify({ schema, validationProcedureID, cursorQuery, p_CensusID: censusID, p_PlotID: plotID })
        });
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(body?.error || `HTTP ${response.status}`);
        }
        return readValidationStream<boolean>(response, signal);
      }
    });
  }

  if (hasCombinedDBH) {
    tasks.push({
      name: `${DBH_GROWTH_PROCEDURE}+${DBH_SHRINKAGE_PROCEDURE}`,
      run: async (signal: AbortSignal) => {
        const response = await fetch('/api/validations/procedures/shared-dbh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal,
          body: JSON.stringify({ schema, p_CensusID: censusID, p_PlotID: plotID })
        });
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(body?.error || `HTTP ${response.status}`);
        }
        const result = await readValidationStream<{ success: boolean; error?: string }>(response, signal);
        if (!result.success) throw new Error(result.error ?? 'Shared DBH validation failed');
        return true;
      }
    });
  }

  if (hasCombinedCrossCensus) {
    tasks.push({
      name: `${QUADRAT_MISMATCH_PROCEDURE}+${COORDINATE_DRIFT_PROCEDURE}`,
      run: async (signal: AbortSignal) => {
        const response = await fetch('/api/validations/procedures/shared-cross-census-location', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal,
          body: JSON.stringify({ schema, p_CensusID: censusID, p_PlotID: plotID })
        });
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(body?.error || `HTTP ${response.status}`);
        }
        const result = await readValidationStream<{ success: boolean; error?: string }>(response, signal);
        if (!result.success) throw new Error(result.error ?? 'Shared cross-census validation failed');
        return true;
      }
    });
  }

  return tasks;
}

async function executeRun(params: ValidationRunParams, abortController: AbortController): Promise<void> {
  const { schema, plotID, censusID } = params;
  const signal = abortController.signal;
  const store = getStore();

  // 1. Fetch validation list
  ailogger.info('[ValidationRunner] Fetching validation list');
  const listResponse = await fetch(`/api/validations/validationlist?schema=${schema}`, { signal });
  const listData = await listResponse.json();
  const validationMessages: ValidationMessages = listData?.coreValidations || {};
  const tasks = buildValidationTasks(validationMessages, schema, plotID, censusID);

  if (tasks.length === 0) {
    ailogger.info('[ValidationRunner] No validations defined — completing immediately');
    store.completeValidationRun('completed');
    return;
  }

  // 2. Create DB run (also cancels any prior running row and acquires lock)
  const createResponse = await fetch('/api/validations/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({ schema, plotID, censusID, totalSteps: tasks.length })
  });
  const createData = await readResponsePayload(createResponse);
  const runPersistence = resolveValidationRunPersistence(createResponse.ok, createData);

  if (runPersistence.conflict) {
    ailogger.warn('[ValidationRunner] Another run is already executing for this plot+census — skipping');
    // Restore the existing run's progress into Zustand so the badge shows it.
    // Do NOT call resume() here — it could detect a "running" row with no
    // active client and call start(), creating a recursive loop.
    if (runPersistence.existingRunID !== null) {
      store.startValidationRun(runPersistence.existingRunID, 0);
      store.updateValidationProgress({ current: 'Waiting for other run to finish' });
    }
    return;
  }

  if (!runPersistence.persistenceEnabled) {
    ailogger.warn(`[ValidationRunner] Run persistence unavailable, continuing in-memory only: ${runPersistence.reason}`);
  }

  const runID = runPersistence.runID;
  store.startValidationRun(runID, tasks.length);

  // 3. Execute tasks sequentially
  let completedSteps = 0;
  let failedSteps = 0;
  const errorMessages: string[] = [];
  let hadBlockingFailure = false;

  for (const task of tasks) {
    if (signal.aborted) break;

    store.updateValidationProgress({ current: task.name });
    await patchRun(schema, runID, { currentStep: task.name });
    const taskTimeoutMs = getValidationTaskTimeoutMs(task.name);

    try {
      const taskTimeout = AbortSignal.timeout(taskTimeoutMs);
      const combinedSignal = AbortSignal.any([signal, taskTimeout]);
      const result = await task.run(combinedSignal);
      if (result === false) {
        throw new Error(`Validation returned failure for ${task.name}`);
      }
      completedSteps++;
    } catch (err: any) {
      if (signal.aborted) {
        ailogger.info(`[ValidationRunner] Aborted during ${task.name}`);
        return;
      }
      if (err.name === 'TimeoutError') {
        const message = `Timed out after ${taskTimeoutMs / 60_000} minutes: ${task.name}`;
        failedSteps++;
        hadBlockingFailure = true;
        errorMessages.push(message);
        ailogger.error(`[ValidationRunner] ${message}`);
      } else if (err.name === 'AbortError') {
        ailogger.info(`[ValidationRunner] Aborted during ${task.name}`);
        return;
      } else {
        failedSteps++;
        hadBlockingFailure = true;
        const message = `Failed: ${task.name} — ${err.message}`;
        errorMessages.push(message);
        ailogger.error(`[ValidationRunner] ${message}`);

        if (isNetworkValidationFetchFailure(err)) {
          ailogger.warn(`[ValidationRunner] Network failure on ${task.name}, continuing`);
          hadBlockingFailure = false;
        }
      }
    }

    store.updateValidationProgress({
      completed: completedSteps,
      errors: errorMessages.length > 0 ? errorMessages : undefined
    });
    await patchRun(schema, runID, {
      completedSteps,
      failedSteps,
      errorMessages: errorMessages.length > 0 ? errorMessages : undefined
    });
  }

  // 4. Finalize
  if (signal.aborted) return;

  if (!hadBlockingFailure && failedSteps === 0) {
    ailogger.info('[ValidationRunner] All validations passed — updating validated rows');
    try {
      const response = await fetch('/api/validations/updatepassedvalidations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({ schema, plotID, censusID })
      });
      if (!response.ok) {
        const body = await readResponsePayload(response);
        throw new Error(body?.error || `HTTP ${response.status}`);
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      ailogger.error('[ValidationRunner] Failed to update passed validations:', err);
      failedSteps++;
      hadBlockingFailure = true;
      errorMessages.push(`Failed to update validated rows: ${err.message}`);
    }
  }

  try {
    await Promise.all([refreshMeasurementsSummary(schema, plotID, censusID, signal), refreshViewFullTable(schema, plotID, censusID, signal)]);
  } catch (err: any) {
    if (err.name === 'AbortError') return;
    ailogger.error('[ValidationRunner] Failed to refresh summary views:', err);
    failedSteps++;
    hadBlockingFailure = true;
    errorMessages.push(`Failed to refresh summary views: ${err.message}`);
  }

  const finalStatus = failedSteps > 0 ? 'failed' : 'completed';
  store.completeValidationRun(finalStatus, errorMessages);
  await patchRun(schema, runID, {
    status: finalStatus,
    completedSteps,
    failedSteps,
    errorMessages: errorMessages.length > 0 ? errorMessages : undefined
  });

  ailogger.info(`[ValidationRunner] Run complete: ${completedSteps} passed, ${failedSteps} failed`);
}

// ─── Public API ──────────────────────────────────────────────────────────────

export const ValidationRunner = {
  /**
   * Start a new background validation run.  Cancels any in-progress run first.
   * The returned promise resolves when the run finishes (or is aborted), but
   * callers are not expected to await it — fire and forget.
   */
  start(params: ValidationRunParams): void {
    // Cancel any existing in-flight run
    if (activeAbortController) {
      activeAbortController.abort();
    }

    const abortController = new AbortController();
    activeAbortController = abortController;
    activeParams = params;

    executeRun(params, abortController)
      .catch((err: any) => {
        if (err.name === 'AbortError') {
          ailogger.info('[ValidationRunner] Run aborted');
          return;
        }
        ailogger.error('[ValidationRunner] Unexpected error:', err);
        getStore().completeValidationRun('failed', [err.message]);
      })
      .finally(() => {
        // Only clear if this is still the active run
        if (activeAbortController === abortController) {
          activeAbortController = null;
          activeParams = null;
        }
      });
  },

  /**
   * Check the DB for an existing run and restore its state into Zustand.
   * Returns true if a run was found and state was restored.
   */
  async resume(params: ValidationRunParams): Promise<boolean> {
    const { schema, plotID, censusID } = params;
    const store = getStore();

    try {
      const response = await fetch(`/api/validations/run?schema=${schema}&plotID=${plotID}&censusID=${censusID}`);
      const { run } = await response.json();

      if (!run) return false;

      if (run.Status === 'running') {
        // A "running" row with no active client means the previous client died.
        // Restart the full run (the POST route will cancel the stale row).
        ailogger.info(`[ValidationRunner] Found stale running run ${run.RunID} — restarting`);
        ValidationRunner.start(params);
        return true;
      }

      if (run.Status === 'completed' || run.Status === 'failed') {
        store.startValidationRun(run.RunID, run.TotalSteps);
        store.updateValidationProgress({
          completed: run.CompletedSteps,
          errors: run.ErrorMessages ?? undefined
        });
        store.completeValidationRun(run.Status, run.ErrorMessages ?? undefined);
        return true;
      }

      return false;
    } catch (err: any) {
      ailogger.error('[ValidationRunner] Error checking for existing run:', err);
      return false;
    }
  },

  /** True if a validation loop is currently executing in this tab. */
  isRunning(): boolean {
    return activeAbortController !== null && !activeAbortController.signal.aborted;
  },

  /** The params of the currently active run, if any. */
  getActiveParams(): ValidationRunParams | null {
    return activeParams;
  },

  /** Cancel the in-flight run (e.g. when user starts a new upload). */
  cancel(): void {
    activeAbortController?.abort();
  }
};
