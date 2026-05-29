import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import mysql from 'mysql2/promise';
import { readFileSync } from 'fs';
import path from 'path';

// Silence ailogger output during DB-backed tests so audit calls (introduced
// by the orchestrator's destructive paths) don't print or hit Application
// Insights from this suite.
vi.mock('@/ailogger', () => ({
  default: { info: () => undefined, warn: () => undefined, error: () => undefined }
}));

import { startRun, retryRun, abortRun, teardownProvisionedSite, markStepFailed, reconcileStaleRun, getRunWithSteps, listRuns } from './orchestrator';
import type { ProvisioningInput } from './types';

const CATALOG_TABLES_FILE = path.join(process.cwd(), 'sqlscripting/catalog-provisioning-tables.sql');
const POLL_INTERVAL_MS = 200;
const RUN_TIMEOUT_MS = 60000;
const ORCH_SCHEMA_PREFIX = 'forestgeo_orch';

function makeInput(schemaName: string): ProvisioningInput {
  return {
    site: {
      siteName: 'OrchTest',
      schemaName,
      sqDimX: 5,
      sqDimY: 5,
      defaultUOMDBH: 'mm',
      defaultUOMHOM: 'm',
      doubleDataEntry: false,
      location: 'OrchLoc',
      country: 'OrchCountry'
    },
    plot: {
      plotName: 'OrchPlot',
      dimensionX: 100,
      dimensionY: 100,
      area: 10000,
      globalX: 0,
      globalY: 0,
      globalZ: 0,
      plotShape: 'square',
      description: '',
      defaultDimensionUnits: 'm',
      defaultCoordinateUnits: 'm',
      defaultAreaUnits: 'm2',
      defaultDBHUnits: 'mm',
      defaultHOMUnits: 'm'
    },
    quadrats: { mode: 'grid', quadratSizeX: 20, quadratSizeY: 20, namingPattern: 'sequential' }
  };
}

async function waitForTerminal(runId: number, pool: mysql.Pool): Promise<string> {
  const deadline = Date.now() + RUN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const result = await getRunWithSteps(runId, pool);
    if (result && result.run.status !== 'running') return result.run.status;
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`Run ${runId} did not reach terminal state within ${RUN_TIMEOUT_MS}ms`);
}

async function createManualRun(pool: mysql.Pool, schemaName: string, status: 'running' | 'failed' | 'completed' | 'aborted' = 'running'): Promise<number> {
  const [result]: any = await pool.query(
    `INSERT INTO catalog.provisioning_runs
      (Status, StartedBy, StartedAt, FinishedAt, SiteName, SchemaName, InputPayload)
     VALUES (?, 'test@manual', NOW(), NULL, 'ManualRun', ?, ?)`,
    [status, schemaName, JSON.stringify(makeInput(schemaName))]
  );
  return result.insertId;
}

async function applyCatalogDdl(pool: mysql.Pool): Promise<void> {
  const ddl = readFileSync(CATALOG_TABLES_FILE, 'utf-8');
  for (const stmt of ddl
    .split(';')
    .map(s => s.trim())
    .filter(Boolean)) {
    await pool.query(stmt);
  }
}

async function assertOnlyOrchestratorRuns(pool: mysql.Pool): Promise<void> {
  const [tableRows]: any = await pool.query(
    `SELECT TABLE_NAME FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = 'catalog' AND TABLE_NAME = 'provisioning_runs'`
  );
  if (tableRows.length === 0) return;

  const [rows]: any = await pool.query(
    `SELECT COUNT(*) AS NonTestRuns
     FROM catalog.provisioning_runs
     WHERE SchemaName NOT LIKE ?`,
    [`${ORCH_SCHEMA_PREFIX}%`]
  );
  const nonTestRuns = Number(rows[0]?.NonTestRuns ?? rows[0]?.nontestruns ?? 0);
  if (nonTestRuns > 0) {
    throw new Error(`Refusing to drop catalog.provisioning_* tables with ${nonTestRuns} non-orchestrator test runs present`);
  }
}

async function createCompletedRunWithSite(pool: mysql.Pool, schemaName: string): Promise<{ runId: number; siteId: number }> {
  const runId = await createManualRun(pool, schemaName, 'completed');
  await pool.query(`CREATE DATABASE IF NOT EXISTS \`${schemaName}\``);
  const [siteResult]: any = await pool.query(
    `INSERT INTO catalog.sites
      (SiteName, SchemaName, SQDimX, SQDimY, DefaultUOMDBH, DefaultUOMHOM, DoubleDataEntry)
     VALUES ('TeardownSite', ?, 5, 5, 'mm', 'm', 0)`,
    [schemaName]
  );
  const siteId = siteResult.insertId;
  await pool.query(`INSERT INTO catalog.usersiterelations (UserID, SiteID) VALUES (999, ?)`, [siteId]);
  return { runId, siteId };
}

describe('orchestrator', () => {
  let pool: mysql.Pool;
  const createdSchemas: string[] = [];

  beforeAll(async () => {
    pool = mysql.createPool({
      host: process.env.TEST_DB_HOST || 'localhost',
      port: Number(process.env.TEST_DB_PORT || 3306),
      user: process.env.TEST_DB_USER || 'root',
      password: process.env.TEST_DB_PASSWORD || 'testpassword',
      multipleStatements: true,
      connectionLimit: 10
    });
    await applyCatalogDdl(pool);
  }, 30000);

  afterAll(async () => {
    for (const schema of createdSchemas) {
      await pool.query(`DROP DATABASE IF EXISTS \`${schema}\``).catch(() => {});
      await pool
        .query(
          `DELETE usr FROM catalog.usersiterelations usr
           JOIN catalog.sites s ON usr.SiteID = s.SiteID
           WHERE s.SchemaName = ?`,
          [schema]
        )
        .catch(() => {});
      await pool.query(`DELETE FROM catalog.sites WHERE SchemaName = ?`, [schema]).catch(() => {});
    }
    await pool.query(`DELETE FROM catalog.provisioning_runs WHERE SchemaName LIKE ?`, [`${ORCH_SCHEMA_PREFIX}%`]).catch(() => {});
    await pool.end();
  });

  it(
    'happy path: 10 steps complete, run flips to completed',
    async () => {
      const schemaName = `forestgeo_orch_happy_${process.pid}`;
      createdSchemas.push(schemaName);
      const { runId } = await startRun({
        input: makeInput(schemaName),
        startedBy: 'test@happy',
        catalogPool: pool
      });

      const finalStatus = await waitForTerminal(runId, pool);
      expect(finalStatus).toBe('completed');

      const result = await getRunWithSteps(runId, pool);
      expect(result).not.toBeNull();
      expect(result!.steps).toHaveLength(10);
      expect(result!.steps.map(s => s.status)).toEqual(Array(10).fill('completed'));
    },
    RUN_TIMEOUT_MS + 5000
  );

  it(
    'concurrent same-schema: second startRun rejects',
    async () => {
      const schemaName = `forestgeo_orch_concurrent_${process.pid}`;
      createdSchemas.push(schemaName);

      const results = await Promise.allSettled([
        startRun({
          input: makeInput(schemaName),
          startedBy: 'test@1',
          catalogPool: pool
        }),
        startRun({
          input: makeInput(schemaName),
          startedBy: 'test@2',
          catalogPool: pool
        })
      ]);

      const fulfilled = results.filter((result): result is PromiseFulfilledResult<{ runId: number }> => result.status === 'fulfilled');
      const rejected = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(String(rejected[0].reason?.message ?? rejected[0].reason)).toMatch(/already in progress/);

      // Let the first complete
      await waitForTerminal(fulfilled[0].value.runId, pool);
    },
    RUN_TIMEOUT_MS + 5000
  );

  it(
    'abort: drops schema and deletes catalog row for failed runs',
    async () => {
      const schemaName = `forestgeo_orch_abort_${process.pid}`;
      createdSchemas.push(schemaName);

      // Create the schema manually so validate_inputs fails before catalog row insertion.
      await pool.query(`CREATE DATABASE IF NOT EXISTS \`${schemaName}\``);
      const { runId } = await startRun({
        input: makeInput(schemaName),
        startedBy: 'test@abort',
        catalogPool: pool
      });
      const finalStatus = await waitForTerminal(runId, pool);
      expect(finalStatus).toBe('failed');

      await abortRun(runId, pool, 'test@abort');

      const result = await getRunWithSteps(runId, pool);
      expect(result!.run.status).toBe('aborted');

      const [schemaRows]: any = await pool.query(`SELECT schema_name FROM information_schema.schemata WHERE schema_name = ?`, [schemaName]);
      expect(schemaRows).toHaveLength(0);

      const [siteRows]: any = await pool.query(`SELECT SiteID FROM catalog.sites WHERE SchemaName = ?`, [schemaName]);
      expect(siteRows).toHaveLength(0);
    },
    RUN_TIMEOUT_MS + 5000
  );

  it(
    'abort: refuses to destroy a completed run',
    async () => {
      const schemaName = `forestgeo_orch_abort_completed_${process.pid}`;
      createdSchemas.push(schemaName);
      const { runId } = await startRun({
        input: makeInput(schemaName),
        startedBy: 'test@abort-completed',
        catalogPool: pool
      });
      await waitForTerminal(runId, pool);

      await expect(abortRun(runId, pool, 'test@abort-completed')).rejects.toThrow(/must be failed/);

      const result = await getRunWithSteps(runId, pool);
      expect(result!.run.status).toBe('completed');
      const [schemaRows]: any = await pool.query(`SELECT schema_name FROM information_schema.schemata WHERE schema_name = ?`, [schemaName]);
      expect(schemaRows).toHaveLength(1);
    },
    RUN_TIMEOUT_MS + 5000
  );

  it(
    'retry: failed run resets failed steps to pending and reruns to completion',
    async () => {
      const schemaName = `forestgeo_orch_retry_${process.pid}`;
      createdSchemas.push(schemaName);

      // Create the schema manually so validate_inputs will reject it
      await pool.query(`CREATE DATABASE IF NOT EXISTS \`${schemaName}\``);

      const { runId } = await startRun({
        input: makeInput(schemaName),
        startedBy: 'test@retry',
        catalogPool: pool
      });

      // Wait for the run to fail (validate_inputs detects orphan schema)
      const failedStatus = await waitForTerminal(runId, pool);
      expect(failedStatus).toBe('failed');

      const failedResult = await getRunWithSteps(runId, pool);
      expect(failedResult!.steps[0].status).toBe('failed');
      // All remaining steps should still be pending
      const remainingStatuses = failedResult!.steps.slice(1).map(s => s.status);
      expect(remainingStatuses).toEqual(Array(9).fill('pending'));

      // Fix the blocking condition: drop the orphaned schema so validate_inputs passes
      await pool.query(`DROP DATABASE IF EXISTS \`${schemaName}\``);

      // Retry the run
      await retryRun(runId, pool, 'test@retry');
      const retryStatus = await waitForTerminal(runId, pool);
      expect(retryStatus).toBe('completed');

      const retryResult = await getRunWithSteps(runId, pool);
      expect(retryResult!.steps).toHaveLength(10);
      expect(retryResult!.steps.map(s => s.status)).toEqual(Array(10).fill('completed'));
    },
    RUN_TIMEOUT_MS * 2 + 5000
  );

  it('retry: only resets steps at or after the first failed step; earlier completed steps are preserved', async () => {
    const schemaName = `forestgeo_orch_retry_scope_${process.pid}`;
    createdSchemas.push(schemaName);
    // Suppress the worker dispatch so retryRun is observed purely as catalog mutations.
    // (Per worker.ts:79, vi.spyOn(globalThis, 'setImmediate') is the documented seam for this.)
    const setImmediateSpy = vi.spyOn(globalThis, 'setImmediate').mockImplementation((() => 0) as any);
    const runId = await createManualRun(pool, schemaName, 'failed');
    const completedStartedAt = new Date(Date.now() - 60_000);
    const completedFinishedAt = new Date(Date.now() - 30_000);
    const failedStartedAt = new Date(Date.now() - 20_000);
    const failedFinishedAt = new Date(Date.now() - 10_000);
    // Layout: 0=completed, 1=completed, 2=failed, 3..9=pending.
    // Only indices >= 2 (the first failed) should be reset.
    await pool.query(
      `INSERT INTO catalog.provisioning_steps
        (RunID, StepIndex, StepKey, Status, StartedAt, FinishedAt, ErrorMessage, ErrorStack)
       VALUES
        (?, 0, 'validate_inputs', 'completed', ?, ?, NULL, NULL),
        (?, 1, 'create_schema',   'completed', ?, ?, NULL, NULL),
        (?, 2, 'init_tables',     'failed',    ?, ?, 'boom', 'stack-here'),
        (?, 3, 'deploy_procedures','pending',  NULL, NULL, NULL, NULL),
        (?, 4, 'seed_validations','pending',   NULL, NULL, NULL, NULL),
        (?, 5, 'insert_catalog_row','pending', NULL, NULL, NULL, NULL),
        (?, 6, 'insert_plot',     'pending',   NULL, NULL, NULL, NULL),
        (?, 7, 'insert_census',   'pending',   NULL, NULL, NULL, NULL),
        (?, 8, 'insert_quadrats', 'pending',   NULL, NULL, NULL, NULL),
        (?, 9, 'verify',          'pending',   NULL, NULL, NULL, NULL)`,
      [
        runId,
        completedStartedAt,
        completedFinishedAt,
        runId,
        completedStartedAt,
        completedFinishedAt,
        runId,
        failedStartedAt,
        failedFinishedAt,
        runId,
        runId,
        runId,
        runId,
        runId,
        runId,
        runId
      ]
    );

    await retryRun(runId, pool, 'test@retry-scope');

    const result = await getRunWithSteps(runId, pool);
    expect(result).not.toBeNull();
    // Indices 0 and 1 must remain completed with their original timestamps and no error fields.
    expect(result!.steps[0].status).toBe('completed');
    expect(result!.steps[0].errorMessage).toBeNull();
    expect(result!.steps[0].startedAt).not.toBeNull();
    expect(result!.steps[0].finishedAt).not.toBeNull();
    expect(result!.steps[1].status).toBe('completed');
    expect(result!.steps[1].errorMessage).toBeNull();
    expect(result!.steps[1].startedAt).not.toBeNull();
    expect(result!.steps[1].finishedAt).not.toBeNull();
    // Index 2 (failed) must reset to pending with cleared error/timestamps.
    expect(result!.steps[2].status).toBe('pending');
    expect(result!.steps[2].startedAt).toBeNull();
    expect(result!.steps[2].finishedAt).toBeNull();
    expect(result!.steps[2].errorMessage).toBeNull();
    expect(result!.steps[2].errorStack).toBeNull();
    // Indices 3..9 should all be pending (they already were, but still pending after reset).
    for (let i = 3; i <= 9; i++) {
      expect(result!.steps[i].status).toBe('pending');
    }
    // Run is flipped back to running.
    expect(result!.run.status).toBe('running');

    setImmediateSpy.mockRestore();
    await pool.query(`UPDATE catalog.provisioning_runs SET Status = 'failed', FinishedAt = NOW() WHERE RunID = ?`, [runId]);
  });

  it(
    'retry: refuses non-failed runs',
    async () => {
      const schemaName = `forestgeo_orch_retry_completed_${process.pid}`;
      createdSchemas.push(schemaName);
      const { runId } = await startRun({
        input: makeInput(schemaName),
        startedBy: 'test@retry-completed',
        catalogPool: pool
      });
      await waitForTerminal(runId, pool);

      await expect(retryRun(runId, pool, 'test@retry-completed')).rejects.toThrow(/must be failed/);
    },
    RUN_TIMEOUT_MS + 5000
  );

  it('teardownProvisionedSite: drops schema and removes catalog rows for a completed run', async () => {
    const schemaName = `forestgeo_orch_teardown_${process.pid}`;
    createdSchemas.push(schemaName);
    const { runId, siteId } = await createCompletedRunWithSite(pool, schemaName);

    await teardownProvisionedSite(runId, schemaName, pool, 'test@teardown');

    const result = await getRunWithSteps(runId, pool);
    expect(result!.run.status).toBe('aborted');

    const [schemaRows]: any = await pool.query(`SELECT schema_name FROM information_schema.schemata WHERE schema_name = ?`, [schemaName]);
    expect(schemaRows).toHaveLength(0);

    const [siteRows]: any = await pool.query(`SELECT SiteID FROM catalog.sites WHERE SchemaName = ?`, [schemaName]);
    expect(siteRows).toHaveLength(0);

    const [relationRows]: any = await pool.query(`SELECT UserSiteRelationID FROM catalog.usersiterelations WHERE SiteID = ?`, [siteId]);
    expect(relationRows).toHaveLength(0);
  });

  it.each(['running', 'failed', 'aborted'] as const)('teardownProvisionedSite: refuses %s runs', async status => {
    const schemaName = `forestgeo_orch_teardown_${status}_${process.pid}`;
    const runId = await createManualRun(pool, schemaName, status);

    await expect(teardownProvisionedSite(runId, schemaName, pool, 'test@teardown-status')).rejects.toThrow(/must be completed/);

    const result = await getRunWithSteps(runId, pool);
    expect(result!.run.status).toBe(status);
  });

  it('teardownProvisionedSite: rejects mismatched confirmation and leaves schema/catalog rows intact', async () => {
    const schemaName = `forestgeo_orch_teardown_mismatch_${process.pid}`;
    createdSchemas.push(schemaName);
    const { runId } = await createCompletedRunWithSite(pool, schemaName);

    await expect(teardownProvisionedSite(runId, `${schemaName}_wrong`, pool, 'test@teardown-mismatch')).rejects.toThrow(/confirmation does not match/);

    const result = await getRunWithSteps(runId, pool);
    expect(result!.run.status).toBe('completed');

    const [schemaRows]: any = await pool.query(`SELECT schema_name FROM information_schema.schemata WHERE schema_name = ?`, [schemaName]);
    expect(schemaRows).toHaveLength(1);

    const [siteRows]: any = await pool.query(`SELECT SiteID FROM catalog.sites WHERE SchemaName = ?`, [schemaName]);
    expect(siteRows).toHaveLength(1);
  });

  it('teardownProvisionedSite: rejects unsafe schema names', async () => {
    const schemaName = `forestgeo_orch_unsafe-${process.pid}`;
    const runId = await createManualRun(pool, schemaName, 'completed');

    await expect(teardownProvisionedSite(runId, schemaName, pool, 'test@teardown-unsafe')).rejects.toThrow(/unsafe schema name/);
  });

  it('markStepFailed: only marks old running steps and leaves healthy steps alone', async () => {
    const schemaName = `forestgeo_orch_mark_recent_${process.pid}`;
    const runId = await createManualRun(pool, schemaName, 'running');
    await pool.query(
      `INSERT INTO catalog.provisioning_steps (RunID, StepIndex, StepKey, Status, StartedAt)
       VALUES (?, 0, 'validate_inputs', 'running', NOW())`,
      [runId]
    );

    await expect(markStepFailed(runId, 0, pool, 'test@mark-recent')).rejects.toThrow(/not stuck yet/);

    const result = await getRunWithSteps(runId, pool);
    expect(result!.run.status).toBe('running');
    expect(result!.steps[0].status).toBe('running');
  });

  it('markStepFailed: marks an old running step failed and flips the run failed', async () => {
    const schemaName = `forestgeo_orch_mark_old_${process.pid}`;
    const runId = await createManualRun(pool, schemaName, 'running');
    await pool.query(
      `INSERT INTO catalog.provisioning_steps (RunID, StepIndex, StepKey, Status, StartedAt)
       VALUES (?, 0, 'validate_inputs', 'running', NOW() - INTERVAL 10 MINUTE)`,
      [runId]
    );

    await markStepFailed(runId, 0, pool, 'test@mark-old');

    const result = await getRunWithSteps(runId, pool);
    expect(result!.run.status).toBe('failed');
    expect(result!.steps[0].status).toBe('failed');
  });

  it('reconcileStaleRun: marks stale pending runs failed so admins can retry or abort', async () => {
    const schemaName = `forestgeo_orch_stale_pending_${process.pid}`;
    const runId = await createManualRun(pool, schemaName, 'running');
    await pool.query(`UPDATE catalog.provisioning_runs SET StartedAt = NOW() - INTERVAL 10 MINUTE WHERE RunID = ?`, [runId]);
    await pool.query(
      `INSERT INTO catalog.provisioning_steps (RunID, StepIndex, StepKey, Status)
       VALUES
         (?, 0, 'validate_inputs', 'completed'),
         (?, 1, 'create_schema', 'pending'),
         (?, 2, 'init_tables', 'pending')`,
      [runId, runId, runId]
    );

    const reconciled = await reconcileStaleRun(runId, pool);

    expect(reconciled).toBe(true);
    const result = await getRunWithSteps(runId, pool);
    expect(result!.run.status).toBe('failed');
    expect(result!.steps[1].status).toBe('failed');
    expect(result!.steps[1].errorMessage).toMatch(/stalled/);
    expect(result!.steps[2].status).toBe('pending');
  });

  it('reconcileStaleRun: marks a stale running step failed', async () => {
    const schemaName = `forestgeo_orch_stale_running_${process.pid}`;
    const runId = await createManualRun(pool, schemaName, 'running');
    await pool.query(
      `INSERT INTO catalog.provisioning_steps (RunID, StepIndex, StepKey, Status, StartedAt)
       VALUES (?, 0, 'validate_inputs', 'running', NOW() - INTERVAL 10 MINUTE)`,
      [runId]
    );

    const reconciled = await reconcileStaleRun(runId, pool);

    expect(reconciled).toBe(true);
    const result = await getRunWithSteps(runId, pool);
    expect(result!.run.status).toBe('failed');
    expect(result!.steps[0].status).toBe('failed');
    expect(result!.steps[0].errorMessage).toMatch(/stalled/);
  });

  it('reconcileStaleRun: leaves a fresh running step alone', async () => {
    const schemaName = `forestgeo_orch_fresh_running_${process.pid}`;
    const runId = await createManualRun(pool, schemaName, 'running');
    await pool.query(`UPDATE catalog.provisioning_runs SET WorkerHeartbeatAt = NOW() WHERE RunID = ?`, [runId]);
    await pool.query(
      `INSERT INTO catalog.provisioning_steps (RunID, StepIndex, StepKey, Status, StartedAt)
       VALUES (?, 0, 'validate_inputs', 'running', NOW())`,
      [runId]
    );

    const reconciled = await reconcileStaleRun(runId, pool);

    expect(reconciled).toBe(false);
    const result = await getRunWithSteps(runId, pool);
    expect(result!.run.status).toBe('running');
    expect(result!.steps[0].status).toBe('running');
  });

  it('reconcileStaleRun: completes a stale running run when every step already completed', async () => {
    const schemaName = `forestgeo_orch_stale_completed_${process.pid}`;
    const runId = await createManualRun(pool, schemaName, 'running');
    await pool.query(`UPDATE catalog.provisioning_runs SET StartedAt = NOW() - INTERVAL 10 MINUTE WHERE RunID = ?`, [runId]);
    await pool.query(
      `INSERT INTO catalog.provisioning_steps (RunID, StepIndex, StepKey, Status, StartedAt, FinishedAt)
       VALUES
         (?, 0, 'validate_inputs', 'completed', NOW() - INTERVAL 10 MINUTE, NOW() - INTERVAL 9 MINUTE),
         (?, 1, 'create_schema', 'completed', NOW() - INTERVAL 9 MINUTE, NOW() - INTERVAL 8 MINUTE)`,
      [runId, runId]
    );

    const reconciled = await reconcileStaleRun(runId, pool);

    expect(reconciled).toBe(true);
    const result = await getRunWithSteps(runId, pool);
    expect(result!.run.status).toBe('completed');
  });

  it('listRuns: returns runs in reverse chronological order', async () => {
    const all = await listRuns(pool, 100);
    const ours = all.filter((r: any) => (r.SchemaName ?? r.schemaname).startsWith('forestgeo_orch_'));
    expect(ours.length).toBeGreaterThan(0);
    for (let i = 1; i < ours.length; i++) {
      const prev = new Date(ours[i - 1].StartedAt ?? ours[i - 1].startedat);
      const cur = new Date(ours[i].StartedAt ?? ours[i].startedat);
      expect(prev.getTime()).toBeGreaterThanOrEqual(cur.getTime());
    }
  });

  it(
    'startRun: bootstraps provisioning catalog tables when state tables are missing',
    async () => {
      // Use a dedicated pool so the WeakMap-cached bootstrap promise from the
      // shared `pool` does not short-circuit the test.
      const isolatedPool = mysql.createPool({
        host: process.env.TEST_DB_HOST || 'localhost',
        port: Number(process.env.TEST_DB_PORT || 3306),
        user: process.env.TEST_DB_USER || 'root',
        password: process.env.TEST_DB_PASSWORD || 'testpassword',
        multipleStatements: true,
        connectionLimit: 4
      });

      const schemaName = `forestgeo_orch_bootstrap_${process.pid}`;
      createdSchemas.push(schemaName);

      try {
        await isolatedPool.query(`CREATE DATABASE IF NOT EXISTS catalog CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
        await assertOnlyOrchestratorRuns(isolatedPool);
        await isolatedPool.query(`DROP TABLE IF EXISTS catalog.provisioning_steps`);
        await isolatedPool.query(`DROP TABLE IF EXISTS catalog.provisioning_runs`);
        const [missing]: any = await isolatedPool.query(
          `SELECT TABLE_NAME FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = 'catalog' AND TABLE_NAME IN ('provisioning_runs', 'provisioning_steps')`
        );
        expect(missing.length).toBe(0);

        const { runId } = await startRun({
          input: makeInput(schemaName),
          startedBy: 'test@bootstrap',
          catalogPool: isolatedPool
        });

        expect(runId).toBeGreaterThan(0);
        await expect(waitForTerminal(runId, isolatedPool)).resolves.toBe('completed');

        const [present]: any = await isolatedPool.query(
          `SELECT TABLE_NAME FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = 'catalog'
           AND TABLE_NAME IN ('provisioning_runs', 'provisioning_steps', 'sites', 'usersiterelations')`
        );
        expect(present.length).toBe(4);
      } finally {
        // Re-seed the shared pool's catalog state for any later tests (none today,
        // but keep this defensive in case the suite grows).
        await applyCatalogDdl(isolatedPool);
        await isolatedPool.end();
      }
    },
    RUN_TIMEOUT_MS + 5000
  );
});
