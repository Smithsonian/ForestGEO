import { createHash } from 'crypto';
import type { Pool, PoolConnection, ResultSetHeader } from 'mysql2/promise';
import type { ProvisioningInput, ProvisioningRunRecord, ProvisioningStepRecord, StepContext, RunStatus, StepStatus } from './types';
import { STEPS } from './steps';

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
    runId: r.RunID,
    status: r.Status,
    startedBy: r.StartedBy,
    startedAt: r.StartedAt,
    finishedAt: r.FinishedAt,
    siteName: r.SiteName,
    schemaName: r.SchemaName,
    input: typeof r.InputPayload === 'string' ? JSON.parse(r.InputPayload) : r.InputPayload
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
const STUCK_THRESHOLD_MS = 5 * 60 * 1000;

function lockNameForSchema(schemaName: string): string {
  return `provisioning:${createHash('sha256').update(schemaName).digest('hex').slice(0, 48)}`;
}

async function acquireSchemaLock(conn: PoolConnection, schemaName: string): Promise<void> {
  const [rows]: any = await conn.query(`SELECT GET_LOCK(?, 10) AS gotLock`, [lockNameForSchema(schemaName)]);
  const gotLock = Number(rows[0]?.gotLock ?? rows[0]?.gotlock ?? 0);
  if (gotLock !== 1) {
    throw new Error(`Could not acquire provisioning lock for schema ${schemaName}`);
  }
}

async function releaseSchemaLock(conn: PoolConnection, schemaName: string): Promise<void> {
  await conn.query(`SELECT RELEASE_LOCK(?)`, [lockNameForSchema(schemaName)]).catch(() => {});
}

export async function startRun(args: StartRunArgs): Promise<{ runId: number }> {
  const { input, startedBy, catalogPool } = args;
  const schemaName = input.site.schemaName;
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
      throw new Error(`A provisioning run is already in progress for schema ${schemaName}`);
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
    throw err;
  } finally {
    await releaseSchemaLock(conn, schemaName);
    conn.release();
  }

  if (runId == null) throw new Error('Failed to create provisioning run');
  const createdRunId = runId;
  setImmediate(() => {
    void runProvisioning(createdRunId, catalogPool);
  });
  return { runId: createdRunId };
}

export async function runProvisioning(runId: number, catalogPool: Pool): Promise<void> {
  const run = await loadRun(catalogPool, runId);
  if (!run) return;
  const steps = await loadSteps(catalogPool, runId);

  const ctx: StepContext = {
    runId,
    schemaName: run.schemaName,
    input: run.input,
    catalogPool,
    sitePool: null,
    state: {},
    logger: {
      info: (m, meta) => console.log('[provisioning]', runId, m, meta ?? ''),
      error: (m, meta) => console.error('[provisioning]', runId, m, meta ?? '')
    }
  };

  try {
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
      await setRunStatus(catalogPool, runId, 'failed');
    } catch {
      // Swallow secondary errors — the original failure has already been recorded
    }
  } finally {
    if (ctx.sitePool && typeof ctx.sitePool.end === 'function') {
      try {
        await ctx.sitePool.end();
      } catch {
        /* ignore */
      }
    }
  }
}

export async function retryRun(runId: number, catalogPool: Pool): Promise<void> {
  const run = await loadRun(catalogPool, runId);
  if (!run) throw new Error(`Run ${runId} not found`);
  if (run.status !== 'failed') throw new Error(`Run ${runId} must be failed before retrying`);

  await catalogPool.query(
    `UPDATE catalog.provisioning_steps
     SET Status = 'pending', StartedAt = NULL, FinishedAt = NULL, ErrorMessage = NULL, ErrorStack = NULL
     WHERE RunID = ? AND Status IN ('failed', 'pending')`,
    [runId]
  );
  await setRunStatus(catalogPool, runId, 'running');

  setImmediate(() => {
    void runProvisioning(runId, catalogPool);
  });
}

export async function abortRun(runId: number, catalogPool: Pool): Promise<void> {
  const run = await loadRun(catalogPool, runId);
  if (!run) throw new Error(`Run ${runId} not found`);
  if (run.status !== 'failed') throw new Error(`Run ${runId} must be failed before aborting`);

  if (!SCHEMA_PATTERN.test(run.schemaName)) {
    throw new Error(`Refusing to abort run with unsafe schema name: ${run.schemaName}`);
  }

  const [siteRows]: any = await catalogPool.query(`SELECT SiteID FROM catalog.sites WHERE SchemaName = ?`, [run.schemaName]);
  if (siteRows.length > 0) {
    const siteId = siteRows[0].SiteID ?? siteRows[0].siteid;
    await catalogPool.query(`DELETE FROM catalog.usersiterelations WHERE SiteID = ?`, [siteId]).catch(() => {
      // usersiterelations may not exist in test envs; non-fatal
    });
    await catalogPool.query(`DELETE FROM catalog.sites WHERE SiteID = ?`, [siteId]);
  }
  await catalogPool.query(`DROP DATABASE IF EXISTS \`${run.schemaName}\``);
  await setRunStatus(catalogPool, runId, 'aborted');
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

export async function markStepFailed(runId: number, stepIndex: number, catalogPool: Pool): Promise<void> {
  const run = await loadRun(catalogPool, runId);
  if (!run) throw new Error(`Run ${runId} not found`);
  if (run.status !== 'running') throw new Error(`Run ${runId} must be running before marking a step failed`);

  const [rows]: any = await catalogPool.query(
    `SELECT StepIndex, Status, StartedAt, TIMESTAMPDIFF(SECOND, StartedAt, NOW()) AS AgeSeconds
     FROM catalog.provisioning_steps
     WHERE RunID = ? AND StepIndex = ?`,
    [runId, stepIndex]
  );
  if (rows.length === 0) throw new Error(`No step ${stepIndex} found for run ${runId}`);

  const step = rows[0];
  const status = step.Status ?? step.status;
  if (status !== 'running') throw new Error(`Step ${stepIndex} for run ${runId} is not running`);

  const startedAt = step.StartedAt ?? step.startedat;
  if (!startedAt) throw new Error(`Step ${stepIndex} for run ${runId} has no start time`);

  const ageSeconds = Number(step.AgeSeconds ?? step.ageseconds ?? 0);
  if (ageSeconds * 1000 <= STUCK_THRESHOLD_MS) {
    throw new Error(`Step ${stepIndex} for run ${runId} is not stuck yet`);
  }

  const [result] = await catalogPool.query(
    `UPDATE catalog.provisioning_steps
     SET Status = 'failed', FinishedAt = NOW(),
         ErrorMessage = 'Marked failed manually (stuck step)'
     WHERE RunID = ? AND StepIndex = ? AND Status = 'running' AND StartedAt = ?`,
    [runId, stepIndex, startedAt]
  );
  if (affectedRows(result) !== 1) {
    throw new Error(`No running step at index ${stepIndex} for run ${runId}`);
  }
  await setRunStatus(catalogPool, runId, 'failed');
}
