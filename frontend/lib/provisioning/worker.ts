/**
 * Heartbeat-based worker for provisioning runs.
 *
 * Why this exists:
 *   - The orchestrator used to fire-and-forget `setImmediate(() => runProvisioning(...))`.
 *     If the Node process died mid-run, the catalog row stayed `Status='running'`
 *     forever and no observer could tell whether the process was alive or dead.
 *   - This module wraps `runProvisioning` with a per-run heartbeat row update
 *     (every 10s) and exposes `pickupStaleRuns` so a freshly-started process
 *     can resume orphaned runs whose heartbeat went silent.
 *
 * Lifecycle:
 *   - `dispatchRun(runId, pool)` is the new "fire and run in background" call.
 *     It synchronously schedules a setImmediate callback that starts the
 *     heartbeat, awaits `runProvisioning`, and stops the heartbeat in a finally.
 *   - `installShutdownHandler` registers SIGTERM/SIGINT handlers that stop new
 *     heartbeats so the row will go stale and the next process can pick it up.
 *   - `pickupStaleRuns` runs at process start (via instrumentation.ts) to dispatch
 *     any `running` rows whose heartbeat is older than HEARTBEAT_STALE_MS or null.
 */
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
// `runProvisioning` is imported lazily inside `dispatchRun` to avoid a
// module-load circular import between worker.ts ↔ orchestrator.ts. The
// orchestrator imports `dispatchRun` at module load; if worker.ts also
// imported `runProvisioning` at module load the bindings would be hoisted
// before either function is defined, producing a TDZ-style undefined-call
// crash in some bundlers.

export const HEARTBEAT_INTERVAL_MS = 10_000;
export const HEARTBEAT_STALE_MS = 60_000;
const WORKER_PID = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

const activeHeartbeats = new Map<number, NodeJS.Timeout>();
const activeRuns = new Set<number>();
let shuttingDown = false;
let shutdownInstalled = false;

function affectedRows(result: unknown): number {
  return (result as ResultSetHeader).affectedRows ?? 0;
}

export function isShuttingDown(): boolean {
  return shuttingDown;
}

export function getWorkerPid(): string {
  return WORKER_PID;
}

async function writeHeartbeat(catalogPool: Pool, runId: number): Promise<void> {
  if (shuttingDown) return;
  try {
    await catalogPool.query(`UPDATE catalog.provisioning_runs SET WorkerHeartbeatAt = NOW() WHERE RunID = ? AND Status = 'running' AND WorkerPID = ?`, [
      runId,
      WORKER_PID
    ]);
  } catch {
    // Heartbeat failures are non-fatal — runProvisioning is still progressing,
    // and a transient DB blip shouldn't kill the run. The next beat will retry.
  }
}

export function startHeartbeat(catalogPool: Pool, runId: number): void {
  if (activeHeartbeats.has(runId)) return;
  void writeHeartbeat(catalogPool, runId);
  const handle = setInterval(() => {
    void writeHeartbeat(catalogPool, runId);
  }, HEARTBEAT_INTERVAL_MS);
  activeHeartbeats.set(runId, handle);
}

export function stopHeartbeat(runId: number): void {
  const handle = activeHeartbeats.get(runId);
  if (handle) {
    clearInterval(handle);
    activeHeartbeats.delete(runId);
  }
}

/**
 * Schedules `runProvisioning` to start on the next event-loop tick. Wrapping
 * the actual work in `setImmediate` decouples it from the caller's synchronous
 * frame (so the route returns immediately) and gives integration tests a
 * single seam — they can `vi.spyOn(globalThis, 'setImmediate').mockImplementation(() => 0)`
 * to suppress the background work and observe only the synchronous catalog
 * writes that `startRun`/`retryRun` perform inline.
 */
export function dispatchRun(runId: number, catalogPool: Pool): void {
  if (shuttingDown || activeRuns.has(runId)) return;
  activeRuns.add(runId);
  setImmediate(() => {
    void runWithHeartbeat(runId, catalogPool);
  });
}

async function runWithHeartbeat(runId: number, catalogPool: Pool): Promise<void> {
  try {
    if (shuttingDown) return;
    if (!(await isRunOwnedByCurrentWorker(catalogPool, runId))) return;
    startHeartbeat(catalogPool, runId);
    const { runProvisioning } = await import('./orchestrator');
    await runProvisioning(runId, catalogPool);
  } finally {
    stopHeartbeat(runId);
    activeRuns.delete(runId);
  }
}

interface StaleRunRow extends RowDataPacket {
  RunID: number;
}

/**
 * Returns RunIDs of `running` rows whose heartbeat is null or older than
 * HEARTBEAT_STALE_MS. Pure query — does NOT dispatch.
 */
export async function findStaleRunIds(catalogPool: Pool): Promise<number[]> {
  const [rows] = await catalogPool.query<StaleRunRow[]>(
    `SELECT RunID FROM catalog.provisioning_runs
     WHERE Status = 'running'
       AND (WorkerHeartbeatAt IS NULL
            OR TIMESTAMPDIFF(SECOND, WorkerHeartbeatAt, NOW()) * 1000 > ?)`,
    [HEARTBEAT_STALE_MS]
  );
  return rows.map(r => Number(r.RunID ?? (r as Record<string, unknown>).runid));
}

export async function isRunOwnedByCurrentWorker(catalogPool: Pool, runId: number): Promise<boolean> {
  const [rows] = await catalogPool.query<RowDataPacket[]>(
    `SELECT RunID FROM catalog.provisioning_runs
     WHERE RunID = ? AND Status = 'running' AND WorkerPID = ?
     LIMIT 1`,
    [runId, WORKER_PID]
  );
  return rows.length > 0;
}

export async function claimStaleRun(catalogPool: Pool, runId: number): Promise<boolean> {
  const [result] = await catalogPool.query<ResultSetHeader>(
    `UPDATE catalog.provisioning_runs
     SET WorkerPID = ?, WorkerHeartbeatAt = NOW()
     WHERE RunID = ?
       AND Status = 'running'
       AND (WorkerHeartbeatAt IS NULL
            OR TIMESTAMPDIFF(SECOND, WorkerHeartbeatAt, NOW()) * 1000 > ?)`,
    [WORKER_PID, runId, HEARTBEAT_STALE_MS]
  );
  return affectedRows(result) > 0;
}

/**
 * Selects stale `running` runs, atomically claims each one, then dispatches
 * only the rows this process successfully claimed. Intended to run once at
 * process startup.
 */
export async function pickupStaleRuns(catalogPool: Pool): Promise<number[]> {
  const ids = await findStaleRunIds(catalogPool);
  const picked: number[] = [];
  for (const runId of ids) {
    if (await claimStaleRun(catalogPool, runId)) {
      picked.push(runId);
      dispatchRun(runId, catalogPool);
    }
  }
  return picked;
}

/**
 * Registers SIGTERM/SIGINT handlers that prevent new heartbeats from firing.
 * Does NOT call process.exit — Node's normal shutdown should finish in-flight
 * requests. The heartbeat rows will go stale and the next process running
 * `pickupStaleRuns` will resume them.
 */
export function installShutdownHandler(_catalogPool: Pool): void {
  if (shutdownInstalled) return;
  shutdownInstalled = true;
  const onSignal = () => {
    shuttingDown = true;
    for (const runId of Array.from(activeHeartbeats.keys())) {
      stopHeartbeat(runId);
    }
  };
  process.once('SIGTERM', onSignal);
  process.once('SIGINT', onSignal);
}

/** Test-only — reset internal state between test runs. */
export function _resetForTests(): void {
  shuttingDown = false;
  shutdownInstalled = false;
  for (const handle of activeHeartbeats.values()) clearInterval(handle);
  activeHeartbeats.clear();
  activeRuns.clear();
}
