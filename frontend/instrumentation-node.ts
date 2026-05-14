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
 */
import ailogger from '@/ailogger';
import { getPoolMonitorInstance } from '@/config/poolmonitorsingleton';
import { installShutdownHandler, pickupStaleRuns } from '@/lib/provisioning/worker';

void (async () => {
  try {
    const pool = getPoolMonitorInstance().pool;
    installShutdownHandler(pool);
    const picked = await pickupStaleRuns(pool);
    if (picked.length > 0) {
      ailogger.info('provisioning.worker.startup', { pickedUpRuns: picked });
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    ailogger.warn('provisioning.worker.startup_failed', { errorMessage });
  }
})();
