import { createHash } from 'crypto';
import type { Pool, PoolConnection, ResultSetHeader } from 'mysql2/promise';
import type { ProvisioningInput, ProvisioningRunRecord, ProvisioningStepRecord, StepContext, RunStatus, StepStatus } from './types';
import { STEPS } from './steps';
import { ProvisioningError } from './errors';
import { auditAttempt, auditSuccess, auditFailure } from './audit';
import { dispatchRun, HEARTBEAT_STALE_MS } from './worker';
import ailogger from '@/ailogger';

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

export interface StartRunArgs {
  input: ProvisioningInput;
  startedBy: string;
  catalogPool: Pool;
}

async function loadRun(catalogPool: Pool, runId: number): Promise<ProvisioningRunRecord | null> {
  const [rows]: any = await catalogPool.query(`SELECT * FROM catalog.provisioning_runs WHERE RunID = ?`, [runId]);
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    runId: r.RunID ?? r.runid,
    status: r.Status ?? r.status,
    startedBy: r.StartedBy ?? r.startedby,
    startedAt: r.StartedAt ?? r.startedat,
    finishedAt: r.FinishedAt ?? r.finishedat,
    siteName: r.SiteName ?? r.sitename,
    schemaName: r.SchemaName ?? r.schemaname,
    input: typeof (r.InputPayload ?? r.inputpayload) === 'string' ? JSON.parse(r.InputPayload ?? r.inputpayload) : (r.InputPayload ?? r.inputpayload)
  };
}

async function getRunStatus(catalogPool: Pool, runId: number): Promise<RunStatus | null> {
  const [rows]: any = await catalogPool.query(`SELECT Status FROM catalog.provisioning_runs WHERE RunID = ?`, [runId]);
  if (rows.length === 0) return null;
  return rows[0].Status ?? rows[0].status;
}

async function loadSteps(catalogPool: Pool, runId: number): Promise<ProvisioningStepRecord[]> {
  const [rows]: any = await catalogPool.query(`SELECT * FROM catalog.provisioning_steps WHERE RunID = ? ORDER BY StepIndex`, [runId]);
  return rows.map((r: any) => ({
    stepId: r.StepID,
    runId: r.RunID,
    stepIndex: r.StepIndex,
    stepKey: r.StepKey,
    status: r.Status,
    startedAt: r.StartedAt,
    finishedAt: r.FinishedAt,
    errorMessage: r.ErrorMessage,
    errorStack: r.ErrorStack
  }));
}

function affectedRows(result: unknown): number {
  return (result as ResultSetHeader).affectedRows ?? 0;
}

async function setStepStatus(catalogPool: Pool, runId: number, stepIndex: number, status: StepStatus, error?: Error): Promise<number> {
  const now = new Date();
  let result: unknown;
  if (status === 'running') {
    [result] = await catalogPool.query(
      `UPDATE catalog.provisioning_steps
       SET Status = ?, StartedAt = ?, FinishedAt = NULL, ErrorMessage = NULL, ErrorStack = NULL
       WHERE RunID = ? AND StepIndex = ?`,
      [status, now, runId, stepIndex]
    );
  } else if (status === 'failed') {
    [result] = await catalogPool.query(
      `UPDATE catalog.provisioning_steps
       SET Status = ?, FinishedAt = ?, ErrorMessage = ?, ErrorStack = ?
       WHERE RunID = ? AND StepIndex = ?`,
      [status, now, error?.message ?? null, error?.stack ?? null, runId, stepIndex]
    );
  } else {
    [result] = await catalogPool.query(
      `UPDATE catalog.provisioning_steps
       SET Status = ?, FinishedAt = ?
       WHERE RunID = ? AND StepIndex = ?`,
      [status, now, runId, stepIndex]
    );
  }
  return affectedRows(result);
}

async function setRunningStep(catalogPool: Pool, runId: number, stepIndex: number): Promise<Date> {
  await setStepStatus(catalogPool, runId, stepIndex, 'running');
  const [rows]: any = await catalogPool.query(`SELECT StartedAt FROM catalog.provisioning_steps WHERE RunID = ? AND StepIndex = ?`, [runId, stepIndex]);
  return rows[0]?.StartedAt ?? rows[0]?.startedat ?? new Date();
}

async function setStepStatusIfStillRunning(
  catalogPool: Pool,
  runId: number,
  stepIndex: number,
  startedAt: Date,
  status: Exclude<StepStatus, 'pending' | 'running' | 'skipped'>,
  error?: Error
): Promise<number> {
  const now = new Date();
  let result: unknown;
  if (status === 'failed') {
    [result] = await catalogPool.query(
      `UPDATE catalog.provisioning_steps
       SET Status = ?, FinishedAt = ?, ErrorMessage = ?, ErrorStack = ?
       WHERE RunID = ? AND StepIndex = ? AND Status = 'running' AND StartedAt = ?`,
      [status, now, error?.message ?? null, error?.stack ?? null, runId, stepIndex, startedAt]
    );
  } else {
    [result] = await catalogPool.query(
      `UPDATE catalog.provisioning_steps
       SET Status = ?, FinishedAt = ?
       WHERE RunID = ? AND StepIndex = ? AND Status = 'running' AND StartedAt = ?`,
      [status, now, runId, stepIndex, startedAt]
    );
  }
  return affectedRows(result);
}

export async function setRunStatus(catalogPool: Pool, runId: number, status: RunStatus): Promise<void> {
  const now = new Date();
  const terminal = status !== 'running';
  if (terminal) {
    const guard = status === 'aborted' ? '' : ` AND Status <> 'aborted'`;
    await catalogPool.query(`UPDATE catalog.provisioning_runs SET Status = ?, FinishedAt = ? WHERE RunID = ?${guard}`, [status, now, runId]);
  } else {
    await catalogPool.query(`UPDATE catalog.provisioning_runs SET Status = ?, FinishedAt = NULL WHERE RunID = ? AND Status <> 'aborted'`, [status, runId]);
  }
}

const SCHEMA_PATTERN = /^forestgeo_[a-z0-9_]+$/;
export const STUCK_THRESHOLD_MS = 5 * 60 * 1000;
const STALLED_RUN_ERROR_MESSAGE = 'Run stalled without an active provisioning worker';

function lockNameForSchema(schemaName: string): string {
  return `provisioning:${createHash('sha256').update(schemaName).digest('hex').slice(0, 48)}`;
}

async function acquireSchemaLock(conn: PoolConnection, schemaName: string): Promise<void> {
  const [rows]: any = await conn.query(`SELECT GET_LOCK(?, 10) AS gotLock`, [lockNameForSchema(schemaName)]);
  const gotLock = Number(rows[0]?.gotLock ?? rows[0]?.gotlock ?? 0);
  if (gotLock !== 1) {
    throw new ProvisioningError(`Could not acquire provisioning lock for schema ${schemaName}`, 'conflict', { schemaName });
  }
}

async function releaseSchemaLock(conn: PoolConnection, schemaName: string): Promise<void> {
  await conn.query(`SELECT RELEASE_LOCK(?)`, [lockNameForSchema(schemaName)]).catch(() => {});
}

export async function startRun(args: StartRunArgs): Promise<{ runId: number }> {
  const { input, startedBy, catalogPool } = args;
  const schemaName = input.site.schemaName;
  auditAttempt({ action: 'start', user: startedBy, schemaName });

  const conn = await catalogPool.getConnection();
  let runId: number | null = null;

  try {
    await acquireSchemaLock(conn, schemaName);
    await conn.beginTransaction();

    const [existing]: any = await conn.query(
      `SELECT RunID FROM catalog.provisioning_runs
       WHERE SchemaName = ? AND Status = 'running' LIMIT 1`,
      [schemaName]
    );
    if (existing.length > 0) {
      throw new ProvisioningError(`A provisioning run is already in progress for schema ${schemaName}`, 'conflict', { schemaName });
    }

    const [result]: any = await conn.query(
      `INSERT INTO catalog.provisioning_runs
        (Status, StartedBy, StartedAt, SiteName, SchemaName, InputPayload)
       VALUES ('running', ?, NOW(), ?, ?, ?)`,
      [startedBy, input.site.siteName, schemaName, JSON.stringify(input)]
    );
    runId = result.insertId;

    const stepInserts = STEPS.map((step, idx) => [runId, idx, step.key, 'pending']);
    await conn.query(
      `INSERT INTO catalog.provisioning_steps
        (RunID, StepIndex, StepKey, Status)
       VALUES ?`,
      [stepInserts]
    );

    await conn.commit();
  } catch (err) {
    await conn.rollback().catch(() => {});
    auditFailure({ action: 'start', user: startedBy, schemaName, error: toError(err) });
    throw err;
  } finally {
    await releaseSchemaLock(conn, schemaName);
    conn.release();
  }

  if (runId == null) {
    const internalErr = new ProvisioningError('Failed to create provisioning run', 'internal', { schemaName });
    auditFailure({ action: 'start', user: startedBy, schemaName, error: internalErr });
    throw internalErr;
  }
  const createdRunId = runId;
  auditSuccess({ action: 'start', user: startedBy, runId: createdRunId, schemaName });
  dispatchRun(createdRunId, catalogPool);
  return { runId: createdRunId };
}

export async function runProvisioning(runId: number, catalogPool: Pool): Promise<void> {
  let ctx: StepContext | null = null;

  try {
    const run = await loadRun(catalogPool, runId);
    if (!run) return;
    const steps = await loadSteps(catalogPool, runId);

    ctx = {
      runId,
      schemaName: run.schemaName,
      input: run.input,
      catalogPool,
      sitePool: null,
      state: {},
      logger: {
        info: (m, meta) => ailogger.info(`[provisioning runId=${runId}] ${m}`, meta as any),
        error: (m, meta) => ailogger.error(`[provisioning runId=${runId}] ${m}`, undefined, meta as any)
      }
    };

    for (const stepRow of steps) {
      const currentRunStatus = await getRunStatus(catalogPool, runId);
      if (currentRunStatus !== 'running') return;

      if (stepRow.status === 'completed') {
        // Replay alreadyDone so ctx.state is populated for downstream steps
        const step = STEPS[stepRow.stepIndex];
        await step.alreadyDone(ctx);
        continue;
      }
      const step = STEPS[stepRow.stepIndex];
      if (await step.alreadyDone(ctx)) {
        await setStepStatus(catalogPool, runId, stepRow.stepIndex, 'completed');
        continue;
      }
      const startedAt = await setRunningStep(catalogPool, runId, stepRow.stepIndex);
      try {
        await step.run(ctx);
      } catch (err: any) {
        const failed = await setStepStatusIfStillRunning(catalogPool, runId, stepRow.stepIndex, startedAt, 'failed', err);
        if (failed > 0) await setRunStatus(catalogPool, runId, 'failed');
        return;
      }
      const completed = await setStepStatusIfStillRunning(catalogPool, runId, stepRow.stepIndex, startedAt, 'completed');
      if (completed === 0) return;
    }
    await setRunStatus(catalogPool, runId, 'completed');
  } catch (fatal: any) {
    // Unexpected error outside step.run() — mark any 'running' steps failed
    try {
      await catalogPool.query(
        `UPDATE catalog.provisioning_steps
         SET Status = 'failed', ErrorMessage = ?, FinishedAt = NOW()
         WHERE RunID = ? AND Status = 'running'`,
        [fatal.message ?? String(fatal), runId]
      );
      await catalogPool.query(
        `UPDATE catalog.provisioning_runs
         SET Status = 'failed', FinishedAt = NOW()
         WHERE RunID = ? AND Status = 'running'`,
        [runId]
      );
    } catch {
      // Swallow secondary errors — the original failure has already been recorded
    }
  } finally {
    if (ctx?.sitePool && typeof ctx.sitePool.end === 'function') {
      try {
        await ctx.sitePool.end();
      } catch {
        /* ignore */
      }
    }
  }
}

export async function retryRun(runId: number, catalogPool: Pool, startedBy: string): Promise<void> {
  auditAttempt({ action: 'retry', user: startedBy, runId });
  try {
    const run = await loadRun(catalogPool, runId);
    if (!run) throw new ProvisioningError(`Run ${runId} not found`, 'not_found', { runId });
    if (run.status !== 'failed') {
      throw new ProvisioningError(`Run ${runId} must be failed before retrying`, 'conflict', { runId });
    }

    const [failedStepRows]: any = await catalogPool.query(
      `SELECT MIN(StepIndex) AS firstFailed FROM catalog.provisioning_steps WHERE RunID = ? AND Status = 'failed'`,
      [runId]
    );
    const firstFailed = failedStepRows[0]?.firstFailed ?? failedStepRows[0]?.firstfailed;
    if (firstFailed != null) {
      await catalogPool.query(
        `UPDATE catalog.provisioning_steps
         SET Status = 'pending', StartedAt = NULL, FinishedAt = NULL, ErrorMessage = NULL, ErrorStack = NULL
         WHERE RunID = ? AND StepIndex >= ?`,
        [runId, firstFailed]
      );
    }
    await setRunStatus(catalogPool, runId, 'running');
    auditSuccess({ action: 'retry', user: startedBy, runId, schemaName: run.schemaName });

    dispatchRun(runId, catalogPool);
  } catch (err) {
    auditFailure({ action: 'retry', user: startedBy, runId, error: toError(err) });
    throw err;
  }
}

export async function abortRun(runId: number, catalogPool: Pool, startedBy: string): Promise<void> {
  auditAttempt({ action: 'abort', user: startedBy, runId });
  try {
    const run = await loadRun(catalogPool, runId);
    if (!run) throw new ProvisioningError(`Run ${runId} not found`, 'not_found', { runId });
    if (run.status !== 'failed') {
      throw new ProvisioningError(`Run ${runId} must be failed before aborting`, 'conflict', { runId });
    }

    await deleteCatalogSiteRowsAndSchema(catalogPool, run.schemaName, {
      actionLabel: 'abort run',
      actor: startedBy,
      ignoreUserRelationsDeleteError: true
    });
    await setRunStatus(catalogPool, runId, 'aborted');
    auditSuccess({ action: 'abort', user: startedBy, runId, schemaName: run.schemaName });
  } catch (err) {
    auditFailure({ action: 'abort', user: startedBy, runId, error: toError(err) });
    throw err;
  }
}

async function getHeartbeatAgeMs(catalogPool: Pool, runId: number): Promise<number | null> {
  const [rows]: any = await catalogPool.query(
    `SELECT WorkerHeartbeatAt,
            TIMESTAMPDIFF(SECOND, WorkerHeartbeatAt, NOW()) * 1000 AS HeartbeatAgeMs
     FROM catalog.provisioning_runs
     WHERE RunID = ?`,
    [runId]
  );
  if (rows.length === 0) return null;
  const heartbeatAt = rows[0]?.WorkerHeartbeatAt ?? rows[0]?.workerheartbeatat;
  if (heartbeatAt == null) return null;
  const ageMs = Number(rows[0]?.HeartbeatAgeMs ?? rows[0]?.heartbeatagems);
  return Number.isFinite(ageMs) ? ageMs : null;
}

/**
 * Reconciles a `running` run whose worker has gone silent. Uses the heartbeat
 * column (not an idle-step aggregate) as the source of truth for "is a worker
 * actually still progressing this run." If the heartbeat is fresh, returns
 * false even when no step appears to be running — the worker may simply be
 * between steps.
 */
export async function reconcileStaleRun(runId: number, catalogPool: Pool, staleThresholdMs = HEARTBEAT_STALE_MS): Promise<boolean> {
  const result = await getRunWithSteps(runId, catalogPool);
  if (!result || result.run.status !== 'running') return false;

  const steps = result.steps;
  const runningStep = steps.find(step => step.status === 'running');
  if (runningStep) return false;

  const failedStep = steps.find(step => step.status === 'failed');
  if (failedStep) {
    await setRunStatus(catalogPool, runId, 'failed');
    return true;
  }

  if (steps.length > 0 && steps.every(step => step.status === 'completed')) {
    await setRunStatus(catalogPool, runId, 'completed');
    return true;
  }

  const heartbeatAgeMs = await getHeartbeatAgeMs(catalogPool, runId);
  // Null heartbeat means the worker never wrote one (or the run was created
  // before this column existed). Treat that as "no proof of life" and proceed
  // to reconcile based on the steps state.
  if (heartbeatAgeMs != null && heartbeatAgeMs < staleThresholdMs) return false;

  const pendingStep = steps.find(step => step.status === 'pending' || step.status === 'skipped');
  if (pendingStep) {
    const now = new Date();
    await catalogPool.query(
      `UPDATE catalog.provisioning_steps
       SET Status = 'failed', StartedAt = COALESCE(StartedAt, ?), FinishedAt = ?, ErrorMessage = ?, ErrorStack = NULL
       WHERE RunID = ? AND StepIndex = ? AND Status IN ('pending', 'skipped')`,
      [now, now, STALLED_RUN_ERROR_MESSAGE, runId, pendingStep.stepIndex]
    );
  }

  await setRunStatus(catalogPool, runId, 'failed');
  return true;
}

interface DeleteCatalogSiteRowsAndSchemaOptions {
  actionLabel: 'abort run' | 'teardown provisioned site';
  actor: string;
  ignoreUserRelationsDeleteError?: boolean;
  requireExactlyOneCatalogSite?: boolean;
}

async function deleteCatalogSiteRowsAndSchema(catalogPool: Pool, schemaName: string, options: DeleteCatalogSiteRowsAndSchemaOptions): Promise<void> {
  if (!SCHEMA_PATTERN.test(schemaName)) {
    throw new ProvisioningError(`Refusing to ${options.actionLabel} with unsafe schema name`, 'unsafe_input', { schemaName });
  }

  const conn = await catalogPool.getConnection();
  try {
    await acquireSchemaLock(conn, schemaName);
    auditAttempt({ action: 'schema_drop', user: options.actor, schemaName });

    // Phase 1: catalog cleanup in a transaction. If any DELETE fails the
    // transaction rolls back and no DROP DATABASE runs.
    await conn.beginTransaction();
    try {
      const [siteRows]: any = await conn.query(`SELECT SiteID FROM catalog.sites WHERE SchemaName = ?`, [schemaName]);
      if (options.requireExactlyOneCatalogSite && siteRows.length !== 1) {
        throw new ProvisioningError(`Catalog state mismatch for schema: expected 1 site row, found ${siteRows.length}`, 'conflict', { schemaName });
      }
      for (const row of siteRows) {
        const siteId = row.SiteID ?? row.siteid;
        try {
          await conn.query(`DELETE FROM catalog.usersiterelations WHERE SiteID = ?`, [siteId]);
        } catch (relationsErr) {
          if (!options.ignoreUserRelationsDeleteError) throw relationsErr;
          // usersiterelations may not exist in test envs; non-fatal for failed-run abort cleanup
        }
        await conn.query(`DELETE FROM catalog.sites WHERE SiteID = ?`, [siteId]);
      }
      await conn.commit();
    } catch (txErr) {
      await conn.rollback().catch(() => {});
      throw txErr;
    }

    // Phase 2: DROP DATABASE outside the transaction. DDL can't be rolled back,
    // and we only reach this point if catalog cleanup committed successfully.
    await catalogPool.query(`DROP DATABASE IF EXISTS \`${schemaName}\``);
    auditSuccess({ action: 'schema_drop', user: options.actor, schemaName });
  } catch (err) {
    auditFailure({ action: 'schema_drop', user: options.actor, schemaName, error: toError(err) });
    throw err;
  } finally {
    await releaseSchemaLock(conn, schemaName);
    conn.release();
  }
}

export async function teardownProvisionedSite(runId: number, confirmSchemaName: string, catalogPool: Pool, startedBy: string): Promise<void> {
  auditAttempt({ action: 'teardown', user: startedBy, runId });
  try {
    const run = await loadRun(catalogPool, runId);
    if (!run) throw new ProvisioningError(`Run ${runId} not found`, 'not_found', { runId });
    if (run.status !== 'completed') {
      throw new ProvisioningError(`Run ${runId} must be completed before teardown`, 'conflict', { runId });
    }
    if (confirmSchemaName !== run.schemaName) {
      // Schema name is intentionally omitted from the public message; including it
      // would let a caller probe whether an arbitrary schema is the target.
      throw new ProvisioningError('Schema confirmation does not match', 'invalid_input', {
        runId,
        schemaName: run.schemaName
      });
    }

    await deleteCatalogSiteRowsAndSchema(catalogPool, run.schemaName, {
      actionLabel: 'teardown provisioned site',
      actor: startedBy,
      requireExactlyOneCatalogSite: true
    });
    await setRunStatus(catalogPool, runId, 'aborted');
    auditSuccess({ action: 'teardown', user: startedBy, runId, schemaName: run.schemaName });
  } catch (err) {
    auditFailure({ action: 'teardown', user: startedBy, runId, error: toError(err) });
    throw err;
  }
}

export async function getRunWithSteps(runId: number, catalogPool: Pool): Promise<{ run: ProvisioningRunRecord; steps: ProvisioningStepRecord[] } | null> {
  const run = await loadRun(catalogPool, runId);
  if (!run) return null;
  const steps = await loadSteps(catalogPool, runId);
  return { run, steps };
}

export async function listRuns(catalogPool: Pool, limit = 50): Promise<any[]> {
  const [rows]: any = await catalogPool.query(
    `SELECT RunID, Status, StartedBy, StartedAt, FinishedAt, SiteName, SchemaName
     FROM catalog.provisioning_runs
     ORDER BY StartedAt DESC LIMIT ?`,
    [limit]
  );
  return rows;
}

export async function markStepFailed(runId: number, stepIndex: number, catalogPool: Pool, startedBy: string): Promise<void> {
  auditAttempt({ action: 'mark_failed', user: startedBy, runId });
  try {
    const run = await loadRun(catalogPool, runId);
    if (!run) throw new ProvisioningError(`Run ${runId} not found`, 'not_found', { runId });
    if (run.status !== 'running') {
      throw new ProvisioningError(`Run ${runId} must be running before marking a step failed`, 'conflict', { runId });
    }

    const [rows]: any = await catalogPool.query(
      `SELECT StepIndex, Status, StartedAt, TIMESTAMPDIFF(SECOND, StartedAt, NOW()) AS AgeSeconds
       FROM catalog.provisioning_steps
       WHERE RunID = ? AND StepIndex = ?`,
      [runId, stepIndex]
    );
    if (rows.length === 0) throw new ProvisioningError(`No step ${stepIndex} found for run ${runId}`, 'not_found', { runId });

    const step = rows[0];
    const status = step.Status ?? step.status;
    if (status !== 'running') throw new ProvisioningError(`Step ${stepIndex} for run ${runId} is not running`, 'conflict', { runId });

    const startedAt = step.StartedAt ?? step.startedat;
    if (!startedAt) throw new ProvisioningError(`Step ${stepIndex} for run ${runId} has no start time`, 'conflict', { runId });

    const ageSeconds = Number(step.AgeSeconds ?? step.ageseconds ?? 0);
    if (ageSeconds * 1000 <= STUCK_THRESHOLD_MS) {
      throw new ProvisioningError(`Step ${stepIndex} for run ${runId} is not stuck yet`, 'conflict', { runId });
    }

    const [result] = await catalogPool.query(
      `UPDATE catalog.provisioning_steps
       SET Status = 'failed', FinishedAt = NOW(),
           ErrorMessage = 'Marked failed manually (stuck step)'
       WHERE RunID = ? AND StepIndex = ? AND Status = 'running' AND StartedAt = ?`,
      [runId, stepIndex, startedAt]
    );
    if (affectedRows(result) !== 1) {
      throw new ProvisioningError(`No running step at index ${stepIndex} for run ${runId}`, 'conflict', { runId });
    }
    await setRunStatus(catalogPool, runId, 'failed');
    auditSuccess({ action: 'mark_failed', user: startedBy, runId, schemaName: run.schemaName });
  } catch (err) {
    auditFailure({ action: 'mark_failed', user: startedBy, runId, error: toError(err) });
    throw err;
  }
}
