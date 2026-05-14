/**
 * Next.js instrumentation hook. Runs once per Node.js process at startup.
 *
 * Responsibilities:
 *   - Install SIGTERM/SIGINT handlers in the provisioning worker so a graceful
 *     shutdown stops heartbeats (rows go stale, next process recovers them).
 *   - Pick up any `running` provisioning runs whose worker heartbeat went
 *     silent — these are orphans from a previous process that crashed or was
 *     SIGKILLed.
 *
 * Edge runtime: the hook also runs in the Edge runtime; we skip there because
 * mysql2 is Node-only.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  let ailogger: typeof import('@/ailogger').default | null = null;
  try {
    const aiModule = await import('@/ailogger');
    ailogger = aiModule.default;
  } catch {
    // ailogger init can fail in early bootstrap (e.g., AppInsights not ready);
    // proceed without it so worker pickup can still run.
  }

  try {
    const { pickupStaleRuns, installShutdownHandler } = await import('@/lib/provisioning/worker');
    const { getPoolMonitorInstance } = await import('@/config/poolmonitorsingleton');
    const pool = getPoolMonitorInstance().pool;
    installShutdownHandler(pool);
    const picked = await pickupStaleRuns(pool);
    if (picked.length > 0 && ailogger) {
      ailogger.info('provisioning.worker.startup', { pickedUpRuns: picked });
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    if (ailogger) {
      ailogger.warn('provisioning.worker.startup_failed', { errorMessage });
    } else {
      console.warn('[instrumentation] provisioning worker startup failed:', errorMessage);
    }
  }
}
