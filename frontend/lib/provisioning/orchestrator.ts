import type { Pool } from 'mysql2/promise';
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

async function setStepStatus(catalogPool: Pool, runId: number, stepIndex: number, status: StepStatus, error?: Error): Promise<void> {
  const now = new Date();
  if (status === 'running') {
    await catalogPool.query(
      `UPDATE catalog.provisioning_steps
       SET Status = ?, StartedAt = ?, FinishedAt = NULL, ErrorMessage = NULL, ErrorStack = NULL
       WHERE RunID = ? AND StepIndex = ?`,
      [status, now, runId, stepIndex]
    );
  } else if (status === 'failed') {
    await catalogPool.query(
      `UPDATE catalog.provisioning_steps
       SET Status = ?, FinishedAt = ?, ErrorMessage = ?, ErrorStack = ?
       WHERE RunID = ? AND StepIndex = ?`,
      [status, now, error?.message ?? null, error?.stack ?? null, runId, stepIndex]
    );
  } else {
    await catalogPool.query(
      `UPDATE catalog.provisioning_steps
       SET Status = ?, FinishedAt = ?
       WHERE RunID = ? AND StepIndex = ?`,
      [status, now, runId, stepIndex]
    );
  }
}

export async function setRunStatus(catalogPool: Pool, runId: number, status: RunStatus): Promise<void> {
  const now = new Date();
  const terminal = status !== 'running';
  if (terminal) {
    await catalogPool.query(`UPDATE catalog.provisioning_runs SET Status = ?, FinishedAt = ? WHERE RunID = ?`, [status, now, runId]);
  } else {
    await catalogPool.query(`UPDATE catalog.provisioning_runs SET Status = ?, FinishedAt = NULL WHERE RunID = ?`, [status, runId]);
  }
}

const SCHEMA_PATTERN = /^forestgeo_[a-z0-9_]+$/;

export async function startRun(args: StartRunArgs): Promise<{ runId: number }> {
  const { input, startedBy, catalogPool } = args;
  const schemaName = input.site.schemaName;

  // Concurrency guard: no other 'running' run for this schema
  const [existing]: any = await catalogPool.query(
    `SELECT RunID FROM catalog.provisioning_runs
     WHERE SchemaName = ? AND Status = 'running' LIMIT 1`,
    [schemaName]
  );
  if (existing.length > 0) {
    throw new Error(`A provisioning run is already in progress for schema ${schemaName}`);
  }

  const [result]: any = await catalogPool.query(
    `INSERT INTO catalog.provisioning_runs
      (Status, StartedBy, StartedAt, SiteName, SchemaName, InputPayload)
     VALUES ('running', ?, NOW(), ?, ?, ?)`,
    [startedBy, input.site.siteName, schemaName, JSON.stringify(input)]
  );
  const runId = result.insertId;

  const stepInserts = STEPS.map((step, idx) => [runId, idx, step.key, 'pending']);
  await catalogPool.query(
    `INSERT INTO catalog.provisioning_steps
      (RunID, StepIndex, StepKey, Status)
     VALUES ?`,
    [stepInserts]
  );

  setImmediate(() => {
    void runProvisioning(runId, catalogPool);
  });
  return { runId };
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
      await setStepStatus(catalogPool, runId, stepRow.stepIndex, 'running');
      try {
        await step.run(ctx);
      } catch (err: any) {
        await setStepStatus(catalogPool, runId, stepRow.stepIndex, 'failed', err);
        await setRunStatus(catalogPool, runId, 'failed');
        return;
      }
      await setStepStatus(catalogPool, runId, stepRow.stepIndex, 'completed');
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
  if (run.status === 'running') throw new Error(`Run ${runId} is already running`);

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
  await catalogPool.query(
    `UPDATE catalog.provisioning_steps
     SET Status = 'failed', FinishedAt = NOW(),
         ErrorMessage = 'Marked failed manually (stuck step)'
     WHERE RunID = ? AND StepIndex = ? AND Status = 'running'`,
    [runId, stepIndex]
  );
  await setRunStatus(catalogPool, runId, 'failed');
}
