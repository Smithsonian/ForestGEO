import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mysql from 'mysql2/promise';
import { readFileSync } from 'fs';
import path from 'path';
import { startRun, retryRun, abortRun, markStepFailed, getRunWithSteps, listRuns } from './orchestrator';
import type { ProvisioningInput } from './types';

const CATALOG_TABLES_FILE = path.join(process.cwd(), 'sqlscripting/catalog-provisioning-tables.sql');
const POLL_INTERVAL_MS = 200;
const RUN_TIMEOUT_MS = 60000;

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

async function createManualRun(pool: mysql.Pool, schemaName: string, status: 'running' | 'failed' | 'completed' = 'running'): Promise<number> {
  const [result]: any = await pool.query(
    `INSERT INTO catalog.provisioning_runs
      (Status, StartedBy, StartedAt, FinishedAt, SiteName, SchemaName, InputPayload)
     VALUES (?, 'test@manual', NOW(), NULL, 'ManualRun', ?, ?)`,
    [status, schemaName, JSON.stringify(makeInput(schemaName))]
  );
  return result.insertId;
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
    await pool.query(`CREATE DATABASE IF NOT EXISTS catalog CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
    const ddl = readFileSync(CATALOG_TABLES_FILE, 'utf-8');
    for (const stmt of ddl
      .split(';')
      .map(s => s.trim())
      .filter(Boolean)) {
      await pool.query(stmt);
    }
    await pool.query(`
      CREATE TABLE IF NOT EXISTS catalog.sites (
        SiteID INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        SiteName VARCHAR(255) NOT NULL,
        SchemaName VARCHAR(255) NOT NULL,
        SQDimX INT NOT NULL,
        SQDimY INT NOT NULL,
        DefaultUOMDBH VARCHAR(16) NOT NULL,
        DefaultUOMHOM VARCHAR(16) NOT NULL,
        DoubleDataEntry TINYINT(1) NOT NULL DEFAULT 0
      ) ENGINE=InnoDB
    `);
  }, 30000);

  afterAll(async () => {
    for (const schema of createdSchemas) {
      await pool.query(`DROP DATABASE IF EXISTS \`${schema}\``).catch(() => {});
      await pool.query(`DELETE FROM catalog.sites WHERE SchemaName = ?`, [schema]).catch(() => {});
    }
    await pool.query(`DELETE FROM catalog.provisioning_runs WHERE SchemaName LIKE 'forestgeo_orch%'`).catch(() => {});
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

      await abortRun(runId, pool);

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

      await expect(abortRun(runId, pool)).rejects.toThrow(/must be failed/);

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
      await retryRun(runId, pool);
      const retryStatus = await waitForTerminal(runId, pool);
      expect(retryStatus).toBe('completed');

      const retryResult = await getRunWithSteps(runId, pool);
      expect(retryResult!.steps).toHaveLength(10);
      expect(retryResult!.steps.map(s => s.status)).toEqual(Array(10).fill('completed'));
    },
    RUN_TIMEOUT_MS * 2 + 5000
  );

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

      await expect(retryRun(runId, pool)).rejects.toThrow(/must be failed/);
    },
    RUN_TIMEOUT_MS + 5000
  );

  it('markStepFailed: only marks old running steps and leaves healthy steps alone', async () => {
    const schemaName = `forestgeo_orch_mark_recent_${process.pid}`;
    const runId = await createManualRun(pool, schemaName, 'running');
    await pool.query(
      `INSERT INTO catalog.provisioning_steps (RunID, StepIndex, StepKey, Status, StartedAt)
       VALUES (?, 0, 'validate_inputs', 'running', NOW())`,
      [runId]
    );

    await expect(markStepFailed(runId, 0, pool)).rejects.toThrow(/not stuck yet/);

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

    await markStepFailed(runId, 0, pool);

    const result = await getRunWithSteps(runId, pool);
    expect(result!.run.status).toBe('failed');
    expect(result!.steps[0].status).toBe('failed');
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
});
