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
import { getPoolMonitorInstance } from '@/config/poolmonitorsingleton';
import { startUploadJobSweeper, stopUploadJobSweeper, sweepOnce } from '@/lib/background-jobs/sweeper';
import { ensureCatalogTables } from '@/lib/provisioning/orchestrator';
import { installShutdownHandler, pickupStaleRuns } from '@/lib/provisioning/worker';

void (async () => {
  let pool: ReturnType<typeof getPoolMonitorInstance>['pool'];
  try {
    pool = getPoolMonitorInstance().pool;
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
    return;
  }

  // Upload-job sweeper — guarded separately so a sweep failure cannot abort
  // the rest of instrumentation, and the interval keeps running even when the
  // startup sweep fails (the next tick retries).
  try {
    startUploadJobSweeper(pool);
    // process.once registrations are additive with provisioning's
    // installShutdownHandler — both shutdown hooks coexist.
    process.once('SIGTERM', stopUploadJobSweeper);
    process.once('SIGINT', stopUploadJobSweeper);
    const { reclaimed, dispatched } = await sweepOnce(pool);
    if (reclaimed.length > 0 || dispatched.length > 0) {
      ailogger.info('upload.sweeper.startup', { reclaimed, dispatched });
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    ailogger.warn('upload.sweeper.startup_failed', { errorMessage });
  }
})();
