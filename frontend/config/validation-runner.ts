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
import { DBH_GROWTH_PROCEDURE, DBH_SHRINKAGE_PROCEDURE, describeDbhFloorSkips } from '@/config/dbhchangevalidations';
import type { DBHValidationSkipCounts } from '@/lib/validations/dbh-execution';

const QUADRAT_MISMATCH_PROCEDURE = 'ValidateQuadratMismatchAcrossCensuses';
const COORDINATE_DRIFT_PROCEDURE = 'ValidateCoordinateDriftAcrossCensuses';

// Named, finite bound on what a validation-list or run-creation failure can
// put into the sidebar badge — a reverse-proxy error page or an arbitrary
// JSON object serialized to text must never land on screen verbatim.
const MAX_STARTUP_ERROR_MESSAGE_LENGTH = 300;

// Server-side wording for a scope lock that has no trackable validation run
// to follow (e.g. an in-progress upload holding the plot+census). Used only
// as a fallback when the server's own conflict response omits a reason.
const SCOPE_LOCK_CONFLICT_FALLBACK_MESSAGE = 'A measurement operation is already in progress for this plot/census';

function looksLikeHtmlDocument(value: string): boolean {
  return /^\s*<(!doctype|html|body)/i.test(value);
}

/** Bounds a startup (validation-list / run-creation) failure to a short, genuine string, or falls back. */
function normalizeStartupErrorMessage(value: unknown, fallback: string): string {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length > 0 && !looksLikeHtmlDocument(trimmed)) {
      return trimmed.length > MAX_STARTUP_ERROR_MESSAGE_LENGTH ? `${trimmed.slice(0, MAX_STARTUP_ERROR_MESSAGE_LENGTH)}…` : trimmed;
    }
  }
  return fallback;
}

type ValidationMessages = Record<string, { id: number; description: string; definition: string }>;

export interface ValidationRunParams {
  schema: string;
  plotID: number;
  censusID: number;
}

/** A passed task may carry a notice that is recorded with the run's messages without failing it. */
type ValidationTaskOutcome = boolean | { notice: string };

interface ValidationTask {
  name: string;
  run: (signal: AbortSignal) => Promise<ValidationTaskOutcome>;
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

    const { id: validationProcedureID } = validationMessages[procedureName];
    tasks.push({
      name: procedureName,
      run: async (signal: AbortSignal) => {
        const response = await fetch(`/api/validations/procedures/${procedureName}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal,
          body: JSON.stringify({ schema, validationProcedureID, p_CensusID: censusID, p_PlotID: plotID })
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
        const result = await readValidationStream<{ success: boolean; error?: string; skipCounts?: DBHValidationSkipCounts }>(response, signal);
        if (!result.success) throw new Error(result.error ?? 'Shared DBH validation failed');
        const notice = describeDbhFloorSkips(result.skipCounts?.skippedBelowDbhFloor ?? 0);
        return notice ? { notice } : true;
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
  if (!listResponse.ok) {
    // Throw rather than fall through to the empty-list path below — an HTTP
    // failure here means "we don't know what validations exist", not "there
    // are zero validations to run". Letting this propagate to start()'s
    // catch reuses the existing failed-run status path (completeValidationRun)
    // instead of a bespoke one, and guarantees no run row is created and no
    // procedures/finalization execute for a request that never produced data.
    const body = await readResponsePayload(listResponse);
    throw new Error(normalizeStartupErrorMessage(body?.error, `HTTP ${listResponse.status}`));
  }
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
    if (runPersistence.existingRunID !== null) {
      ailogger.warn('[ValidationRunner] Another run is already executing for this plot+census — following it');
      // Restore the existing run's progress into Zustand so the badge shows it.
      // Do NOT call resume() here — it could detect a "running" row with no
      // active client and call start(), creating a recursive loop.
      store.startValidationRun(runPersistence.existingRunID, 0);
      store.updateValidationProgress({ current: 'Waiting for other run to finish' });
      return;
    }

    // Scope-locked by something other than a trackable validation run (e.g.
    // an in-progress upload) — there is no run to follow, so this must be a
    // visible, recoverable failure. Silently returning here would leave
    // whatever success/progress state the store already had (see the fresh
    // startValidationRun(null, 0) call in start() for why that state is
    // "running", not stale — this call turns it into a genuine "failed").
    const conflictMessage = normalizeStartupErrorMessage((createData as Record<string, unknown> | null)?.reason, SCOPE_LOCK_CONFLICT_FALLBACK_MESSAGE);
    ailogger.warn(`[ValidationRunner] Run blocked: ${conflictMessage}`);
    store.completeValidationRun('failed', [conflictMessage]);
    return;
  }

  if (!runPersistence.persistenceEnabled || runPersistence.runID === null) {
    // Fail closed: a rejected (403/500) or malformed (missing/nonpositive/
    // non-integer/unsafe runID) run-creation response means there is no
    // persisted, concurrency-safe record for this run. This is an explicit
    // conservative policy — continuing into procedures/finalization
    // in-memory only, as the code used to do, would let a failed
    // coordination request silently run unprotected work.
    const message = normalizeStartupErrorMessage(runPersistence.reason, `HTTP ${createResponse.status}`);
    ailogger.error(`[ValidationRunner] Failed to create validation run: ${message}`);
    throw new Error(message);
  }

  const runID = runPersistence.runID;
  store.startValidationRun(runID, tasks.length);

  // 3. Execute tasks sequentially
  let completedSteps = 0;
  let failedSteps = 0;
  const errorMessages: string[] = [];
  const notices: string[] = [];
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
      if (typeof result === 'object') notices.push(result.notice);
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
      errors: errorMessages,
      notices
    });
    await patchRun(schema, runID, {
      completedSteps,
      failedSteps,
      errorMessages,
      notices
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
  store.completeValidationRun(finalStatus, errorMessages, notices);
  await patchRun(schema, runID, {
    status: finalStatus,
    completedSteps,
    failedSteps,
    errorMessages,
    notices
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

    // Synchronously reset to a fresh 'running' state (reusing the existing
    // reducer) so a stale completed/failed badge from a previous run can
    // never outlive this call — even if run creation below is rejected.
    getStore().startValidationRun(null, 0);

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
          errors: run.ErrorMessages ?? [],
          notices: run.Notices ?? []
        });
        store.completeValidationRun(run.Status, run.ErrorMessages ?? [], run.Notices ?? []);
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
