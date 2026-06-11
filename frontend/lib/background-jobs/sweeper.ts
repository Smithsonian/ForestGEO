/**
 * Upload-job sweeper (async-upload remediation Task 11).
 *
 * A single in-process interval that periodically:
 *   1. Reclaims abandoned leases — 'running' jobs whose worker heartbeat went
 *      silent for STALE_LEASE_THRESHOLD_MS are moved to waiting_retry (budget
 *      remaining) or failed (budget exhausted) via the unfenced-but-guarded
 *      finalizeJobAsSystem transition.
 *   2. Dispatches runnable jobs — queued or past-due waiting_retry jobs are
 *      handed to runJobIfClaimable, whose atomic claim makes cross-process
 *      races safe. Within one process jobs run sequentially.
 *
 * The startup call to sweepOnce in instrumentation-node.ts IS the
 * deploy-recovery moment: jobs orphaned by the previous process are reclaimed
 * and re-dispatched as soon as a new process boots.
 */
import type { Pool } from 'mysql2/promise';
import ailogger from '@/ailogger';
import { finalizeJobAsSystem, findRunnableJobIDs, findStaleRunningJobs } from './repository';
import { runJobIfClaimable, STALE_LEASE_THRESHOLD_MS } from './worker';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Interval between sweeper passes. */
export const SWEEP_INTERVAL_MS = 60_000;

/** Maximum number of runnable jobs dispatched per pass. */
export const SWEEP_DISPATCH_LIMIT = 5;

const MS_PER_SECOND = 1_000;
const STALE_LEASE_THRESHOLD_SECONDS = STALE_LEASE_THRESHOLD_MS / MS_PER_SECOND;

const RECLAIM_RETRY_REASON = 'worker heartbeat lost; lease reclaimed by sweeper';
const RECLAIM_FAILED_REASON = 'worker heartbeat lost; retries exhausted';

/**
 * NextAttemptAt for a reclaimed job is "now", nudged one second into the past:
 * the column is DATETIME(0) and MySQL ROUNDS fractional seconds, so a raw
 * `new Date()` could land up to half a second in the future and make the
 * same-pass dispatch query (`NextAttemptAt <= NOW()`) skip the job it just
 * reclaimed.
 */
const RECLAIM_IMMEDIATE_RETRY_SKEW_MS = MS_PER_SECOND;

/**
 * Cross-module-instance sentinel: dev-mode HMR (and any double-registration of
 * instrumentation) re-evaluates this module, so the interval handle must live
 * on globalThis rather than in module scope for the double-start guard to hold.
 */
const SWEEPER_SENTINEL = Symbol.for('forestgeo.uploadJobSweeper');

type SweeperGlobal = typeof globalThis & { [SWEEPER_SENTINEL]?: NodeJS.Timeout };

// ---------------------------------------------------------------------------
// Sweep pass
// ---------------------------------------------------------------------------

export interface SweepDeps {
  dispatch: (jobID: number) => Promise<void>;
}

const defaultSweepDeps: SweepDeps = {
  dispatch: jobID => runJobIfClaimable(jobID)
};

export interface SweepResult {
  /** Stale running jobs this pass moved to waiting_retry or failed. */
  reclaimed: number[];
  /** Runnable jobs this pass successfully handed to dispatch. */
  dispatched: number[];
}

/**
 * One sweeper pass: reclaim stale leases, then dispatch runnable jobs. The
 * reclaim runs first so a job orphaned by a dead worker becomes runnable and
 * is re-dispatched within the SAME pass.
 *
 * Per-job errors are logged and skipped; a query failure (e.g. the catalog is
 * unreachable) rejects the whole pass and is handled by the interval wrapper.
 */
export async function sweepOnce(catalogPool: Pool, deps: SweepDeps = defaultSweepDeps): Promise<SweepResult> {
  const reclaimed: number[] = [];
  const dispatched: number[] = [];

  const staleJobs = await findStaleRunningJobs(catalogPool, STALE_LEASE_THRESHOLD_SECONDS);
  for (const stale of staleJobs) {
    try {
      // finalizeJobAsSystem increments RetryCount itself, so the budget check
      // uses the CURRENT row values: the prospective count is retryCount + 1.
      // Read-then-act is safe here — the Status='running' guard makes the
      // finalize atomic, and a lost race is a harmless no-op (moved=false).
      const retryBudgetRemains = stale.retryCount + 1 < stale.maxRetries;
      const moved = retryBudgetRemains
        ? await finalizeJobAsSystem(catalogPool, stale.jobID, 'waiting_retry', RECLAIM_RETRY_REASON, new Date(Date.now() - RECLAIM_IMMEDIATE_RETRY_SKEW_MS))
        : await finalizeJobAsSystem(catalogPool, stale.jobID, 'failed', RECLAIM_FAILED_REASON);
      if (moved) reclaimed.push(stale.jobID);
    } catch (error) {
      ailogger.warn('upload.sweeper.reclaim_failed', {
        jobID: stale.jobID,
        errorMessage: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const runnableJobIDs = await findRunnableJobIDs(catalogPool, SWEEP_DISPATCH_LIMIT);
  for (const jobID of runnableJobIDs) {
    try {
      await deps.dispatch(jobID);
      dispatched.push(jobID);
    } catch (error) {
      ailogger.warn('upload.sweeper.dispatch_failed', {
        jobID,
        errorMessage: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return { reclaimed, dispatched };
}

// ---------------------------------------------------------------------------
// Interval lifecycle
// ---------------------------------------------------------------------------

/**
 * Starts the sweeper interval. A second call while the interval is alive is a
 * no-op (globalThis sentinel). The interval is unref()d so it never keeps the
 * process alive on its own.
 */
export function startUploadJobSweeper(catalogPool: Pool): void {
  const sweeperGlobal = globalThis as SweeperGlobal;
  if (sweeperGlobal[SWEEPER_SENTINEL]) return;

  const interval = setInterval(() => {
    void sweepOnce(catalogPool).catch((error: unknown) => {
      // A failed pass must never kill the interval — the next tick retries.
      ailogger.warn('upload.sweeper.pass_failed', {
        errorMessage: error instanceof Error ? error.message : String(error)
      });
    });
  }, SWEEP_INTERVAL_MS);
  interval.unref?.();
  sweeperGlobal[SWEEPER_SENTINEL] = interval;
}

export function stopUploadJobSweeper(): void {
  const sweeperGlobal = globalThis as SweeperGlobal;
  const interval = sweeperGlobal[SWEEPER_SENTINEL];
  if (!interval) return;
  clearInterval(interval);
  delete sweeperGlobal[SWEEPER_SENTINEL];
}
