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

/** Maximum number of runnable jobs a single pass will look at. */
export const SWEEP_DISPATCH_LIMIT = 5;

/**
 * Hard ceiling on jobs EXECUTING concurrently in this process.
 *
 * A pass no longer waits for the jobs it hands off, so without a cap each tick
 * would launch up to SWEEP_DISPATCH_LIMIT more of them every minute — unbounded
 * growth against a 15-connection pool and a 12-transaction cap. Two is
 * deliberately conservative: it lets a small job proceed alongside a
 * census-scale one without letting census-scale ingestions pile up.
 *
 * A pass hands off only the capacity that is actually free, so raising this is
 * the single place to widen execution concurrency.
 */
export const MAX_CONCURRENT_JOB_EXECUTIONS = 2;

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
 * instrumentation) re-evaluates this module, so the interval handle and all
 * related state must live on globalThis rather than in module scope for the
 * double-start and in-flight guards to hold across HMR reloads.
 */
const SWEEPER_SENTINEL = Symbol.for('forestgeo.uploadJobSweeper');

interface SweeperSentinelValue {
  interval: NodeJS.Timeout;
  /** True while a sweepOnce pass is awaiting; the next tick is skipped. */
  inFlight: boolean;
  /** True once SIGTERM/SIGINT listeners have been installed for this process. */
  shutdownInstalled: boolean;
}

type SweeperGlobal = typeof globalThis & { [SWEEPER_SENTINEL]?: SweeperSentinelValue };

/**
 * Jobs currently executing, tracked across sweeper passes. Lives on globalThis
 * for the same reason the interval does: dev-mode HMR re-evaluates this module,
 * and a per-module set would let the concurrency cap be bypassed by a reload.
 */
const ACTIVE_DISPATCHES_SENTINEL = Symbol.for('forestgeo.uploadJobActiveDispatches');
type DispatchGlobal = typeof globalThis & { [ACTIVE_DISPATCHES_SENTINEL]?: Set<Promise<void>> };

function activeDispatches(): Set<Promise<void>> {
  const dispatchGlobal = globalThis as DispatchGlobal;
  if (!dispatchGlobal[ACTIVE_DISPATCHES_SENTINEL]) {
    dispatchGlobal[ACTIVE_DISPATCHES_SENTINEL] = new Set<Promise<void>>();
  }
  return dispatchGlobal[ACTIVE_DISPATCHES_SENTINEL];
}

/** Jobs this process is currently executing. Exposed for diagnostics and tests. */
export function activeJobExecutionCount(): number {
  return activeDispatches().size;
}

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
  /**
   * Runnable jobs this pass STARTED. The pass does not wait for them, so this
   * says "execution began", not "execution finished" — a job listed here may
   * still be running when the next pass begins.
   */
  dispatched: number[];
  /** Runnable jobs this pass found but could not start: every execution slot was full. */
  deferredForCapacity: number[];
}

/**
 * One sweeper pass: reclaim stale leases, then start runnable jobs. The reclaim
 * runs first so a job orphaned by a dead worker becomes runnable and is started
 * within the SAME pass.
 *
 * The pass does NOT await the jobs it starts. It used to: `await deps.dispatch`
 * ran a job to completion inside the pass, so one census-scale ingestion held
 * the pass open for hours, the in-flight guard skipped every tick behind it, and
 * stale-lease reclaim for every OTHER orphaned job was deferred for exactly as
 * long. Reclaim is the sweeper's recovery mechanism, and it was the thing being
 * starved.
 *
 * Decoupling means concurrency has to be bounded explicitly, which is what
 * MAX_CONCURRENT_JOB_EXECUTIONS and the shared active-dispatch set do: a pass
 * hands off only the free capacity and always completes its reclaim scan, even
 * when no capacity is free at all.
 *
 * Per-job errors are logged and skipped; a query failure (e.g. the catalog is
 * unreachable) rejects the whole pass and is handled by the interval wrapper.
 */
export async function sweepOnce(catalogPool: Pool, deps: SweepDeps = defaultSweepDeps): Promise<SweepResult> {
  const reclaimed: number[] = [];
  const dispatched: number[] = [];
  const deferredForCapacity: number[] = [];

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
  const active = activeDispatches();

  for (const jobID of runnableJobIDs) {
    if (active.size >= MAX_CONCURRENT_JOB_EXECUTIONS) {
      deferredForCapacity.push(jobID);
      continue;
    }

    // The .finally callback closes over `dispatch`, which is bound by the time
    // it can run (it is asynchronous), so the set always deletes the exact
    // promise it stored.
    const dispatch: Promise<void> = Promise.resolve()
      .then(() => deps.dispatch(jobID))
      .catch(error => {
        ailogger.warn('upload.sweeper.dispatch_failed', {
          jobID,
          errorMessage: error instanceof Error ? error.message : String(error)
        });
      })
      .finally(() => {
        active.delete(dispatch);
      });
    active.add(dispatch);
    dispatched.push(jobID);
  }

  if (deferredForCapacity.length > 0) {
    // Never silent: a job waiting on capacity looks identical to a job the
    // sweeper failed to see.
    ailogger.info('upload.sweeper.deferred_for_capacity', {
      deferredJobIDs: deferredForCapacity,
      activeExecutions: active.size,
      maxConcurrentExecutions: MAX_CONCURRENT_JOB_EXECUTIONS
    });
  }

  return { reclaimed, dispatched, deferredForCapacity };
}

// ---------------------------------------------------------------------------
// Interval lifecycle
// ---------------------------------------------------------------------------

/**
 * Outcome of one tick. A skipped tick and a failed tick are different events —
 * the startup caller escalates a failure (the deploy-recovery sweep did not
 * happen) but not a skip — so they are reported as distinct variants rather
 * than a shared null.
 */
export type SweepTickOutcome = { status: 'completed'; result: SweepResult } | { status: 'skipped_in_flight' } | { status: 'failed'; error: Error };

/**
 * One interval tick: skips when a previous pass hasn't resolved yet (in-flight
 * guard), otherwise runs a sweep pass. Never throws — a failed pass must not
 * kill the interval — so callers read the outcome instead of catching.
 *
 * A failure is REPORTED, not logged, here. The two callers need different
 * severities for the same event (a routine tick failing is a warning; the
 * startup pass failing means deploy recovery did not happen), and logging both
 * here and at the caller produced two events for one failure. Each caller emits
 * exactly one.
 */
export async function runSweepTick(catalogPool: Pool, deps: SweepDeps = defaultSweepDeps): Promise<SweepTickOutcome> {
  const sweeperGlobal = globalThis as SweeperGlobal;
  const sentinel = sweeperGlobal[SWEEPER_SENTINEL];
  if (sentinel?.inFlight) {
    ailogger.info('upload.sweeper.tick_skipped_in_flight');
    return { status: 'skipped_in_flight' };
  }
  if (sentinel) sentinel.inFlight = true;
  try {
    return { status: 'completed', result: await sweepOnce(catalogPool, deps) };
  } catch (error: unknown) {
    // A failed pass must never kill the interval — the next tick retries.
    return { status: 'failed', error: error instanceof Error ? error : new Error(String(error)) };
  } finally {
    const afterSentinel = (globalThis as SweeperGlobal)[SWEEPER_SENTINEL];
    if (afterSentinel) afterSentinel.inFlight = false;
  }
}

/**
 * Starts the sweeper interval. A second call while the interval is alive is a
 * no-op (globalThis sentinel). The interval is unref()d so it never keeps the
 * process alive on its own.
 *
 * Passes never stack: the in-flight guard in runSweepTick skips a tick while a
 * previous pass is still resolving. Job EXECUTIONS are bounded separately, by
 * MAX_CONCURRENT_JOB_EXECUTIONS, because a pass no longer waits for them.
 */
export function startUploadJobSweeper(catalogPool: Pool): void {
  const sweeperGlobal = globalThis as SweeperGlobal;
  if (sweeperGlobal[SWEEPER_SENTINEL]) return;

  const interval = setInterval(() => {
    void runSweepTick(catalogPool).then(outcome => {
      if (outcome.status === 'failed') {
        ailogger.warn('upload.sweeper.pass_failed', { errorMessage: outcome.error.message });
      }
    });
  }, SWEEP_INTERVAL_MS);
  interval.unref?.();
  sweeperGlobal[SWEEPER_SENTINEL] = { interval, inFlight: false, shutdownInstalled: false };
}

export function stopUploadJobSweeper(): void {
  const sweeperGlobal = globalThis as SweeperGlobal;
  const sentinel = sweeperGlobal[SWEEPER_SENTINEL];
  if (!sentinel) return;
  clearInterval(sentinel.interval);
  delete sweeperGlobal[SWEEPER_SENTINEL];
}

/**
 * Installs SIGTERM and SIGINT handlers that call stopUploadJobSweeper. Safe to
 * call from HMR-reloaded module instances: the shutdownInstalled flag lives on
 * the same globalThis sentinel as the interval, so only one set of listeners is
 * ever registered per process lifetime. An in-flight sweep pass is allowed to
 * finish naturally; the interval is cleared immediately so no new pass starts.
 *
 * Jobs still EXECUTING at shutdown are deliberately abandoned rather than
 * awaited. Awaiting a census-scale ingestion would hold the process open past
 * any platform shutdown grace period, and abandonment is already the case the
 * recovery machinery is built for: the job's lease heartbeat stops, the next
 * process's startup sweep reclaims it as a stale lease, and its batch-family
 * crash recovery resumes the work. Waiting would buy nothing that reclaim does
 * not already provide.
 *
 * Must be called AFTER startUploadJobSweeper (so the sentinel exists to host
 * the shutdownInstalled flag). If no sentinel is present, the handlers are
 * registered unconditionally and will be no-ops if the sweeper was never
 * started.
 */
export function installUploadSweeperShutdown(): void {
  const sweeperGlobal = globalThis as SweeperGlobal;
  const sentinel = sweeperGlobal[SWEEPER_SENTINEL];
  if (sentinel?.shutdownInstalled) return;
  if (sentinel) sentinel.shutdownInstalled = true;
  process.once('SIGTERM', stopUploadJobSweeper);
  process.once('SIGINT', stopUploadJobSweeper);
}
