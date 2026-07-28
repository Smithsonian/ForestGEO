/**
 * Node-runtime instrumentation. Imported dynamically from `instrumentation.ts`
 * only when `process.env.NEXT_RUNTIME === 'nodejs'` so the Edge bundle never
 * pulls in mysql2 (which depends on `net`/`tls`/`timers`/`fs`/`path`).
 *
 * Splitting this out is the pattern recommended by the Next.js instrumentation
 * docs for runtime-conditional side effects.
 *
 * Responsibilities:
 *   - Install SIGTERM/SIGINT handlers in the provisioning worker so a graceful
 *     shutdown stops heartbeats (rows go stale, next process recovers them).
 *   - Pick up any `running` provisioning runs whose worker heartbeat went
 *     silent — these are orphans from a previous process that crashed or was
 *     SIGKILLed.
 *   - Start the upload-job sweeper and run one startup sweep: the startup
 *     sweep IS the deploy-recovery moment for background upload jobs whose
 *     worker died with the previous process.
 */
import ailogger from '@/ailogger';
import { getPoolMonitorInstance } from '@/lib/db/poolmonitorsingleton';
import { installUploadSweeperShutdown, runSweepTick, startUploadJobSweeper } from '@/lib/background-jobs/sweeper';
import { ensureCatalogTables } from '@/lib/provisioning/orchestrator';
import { installShutdownHandler, pickupStaleRuns } from '@/lib/provisioning/worker';

void (async () => {
  let pool: ReturnType<typeof getPoolMonitorInstance>['pool'];
  try {
    pool = getPoolMonitorInstance().pool;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    ailogger.warn('instrumentation.pool_unavailable', { errorMessage });
    return; // nothing below can run without a pool
  }

  // Provisioning worker — guarded separately so its failure does not block the
  // upload-job sweeper below (the sweeper interval self-heals on later ticks).
  try {
    // Bootstrap the catalog.* tables on first boot so a fresh database
    // (or a partially-applied prior deploy) self-heals before the worker
    // tries to read catalog.provisioning_runs.
    await ensureCatalogTables(pool);
    installShutdownHandler(pool);
    const picked = await pickupStaleRuns(pool);
    if (picked.length > 0) {
      ailogger.info('provisioning.worker.startup', { pickedUpRuns: picked });
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    ailogger.warn('provisioning.worker.startup_failed', { errorMessage });
  }

  // Upload-job sweeper — guarded separately so a start-up failure cannot abort
  // the rest of instrumentation, and the interval keeps running even when the
  // startup sweep fails (the next tick retries).
  try {
    startUploadJobSweeper(pool);
    // installUploadSweeperShutdown is HMR-safe: the shutdownInstalled flag on
    // the globalThis sentinel prevents stacking listeners across module reloads.
    // Both shutdown hooks (provisioning's installShutdownHandler and this one)
    // coexist via separate process.once registrations.
    installUploadSweeperShutdown();
    // runSweepTick reports rather than throws, so the startup sweep's own
    // failure is escalated here: this pass IS the deploy-recovery moment, and
    // missing it is louder news than a routine mid-life tick failure.
    const outcome = await runSweepTick(pool);
    if (outcome.status === 'failed') {
      ailogger.error('upload.sweeper.startup_failed', outcome.error);
    } else if (outcome.status === 'completed' && (outcome.result.reclaimed.length > 0 || outcome.result.dispatched.length > 0)) {
      ailogger.info('upload.sweeper.startup', outcome.result);
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    ailogger.warn('upload.sweeper.startup_failed', { errorMessage });
  }
})();
