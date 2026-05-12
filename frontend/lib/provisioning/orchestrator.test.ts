import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mysql from 'mysql2/promise';
import { readFileSync } from 'fs';
import path from 'path';
import { startRun, retryRun, abortRun, getRunWithSteps, listRuns } from './orchestrator';
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

      const { runId } = await startRun({
        input: makeInput(schemaName),
        startedBy: 'test@1',
        catalogPool: pool
      });

      // Immediate second start should reject before it can pick up state
      await expect(
        startRun({
          input: makeInput(schemaName),
          startedBy: 'test@2',
          catalogPool: pool
        })
      ).rejects.toThrow(/already in progress/);

      // Let the first complete
      await waitForTerminal(runId, pool);
    },
    RUN_TIMEOUT_MS + 5000
  );

  it(
    'abort: drops schema and deletes catalog row',
    async () => {
      const schemaName = `forestgeo_orch_abort_${process.pid}`;
      createdSchemas.push(schemaName);
      const { runId } = await startRun({
        input: makeInput(schemaName),
        startedBy: 'test@abort',
        catalogPool: pool
      });
      await waitForTerminal(runId, pool);

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
