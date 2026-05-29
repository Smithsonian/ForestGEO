import path from 'path';
import mysql, { type PoolOptions } from 'mysql2/promise';
import type { ProvisioningStep, StepContext } from '../types';
import { executeSqlFile } from '../sql-runner';
import { validateSchemaOrThrow } from '@/config/utils/sqlsecurity';

const TABLES_FILE = () => path.join(process.cwd(), 'sqlscripting/tablestructures.sql');
const PROCS_FILE = () => path.join(process.cwd(), 'sqlscripting/storedprocedures.sql');
const QUERIES_FILE = () => path.join(process.cwd(), 'sqlscripting/corequeries.sql');

/**
 * Schema version stamp. Bump this date when DDL, stored procedures, or seeded
 * validations change in a way that requires re-running provisioning. The
 * `alreadyDone` checks compare this to the `SchemaVersion` row in
 * `_provisioning_meta` so partial or stale deploys are reprovisioned.
 */
const SCHEMA_VERSION = '2026-05-13';
const META_TABLE = '_provisioning_meta';

const VALIDATIONS_TABLE = 'sitespecificvalidations';
const REQUIRED_TABLES = ['plots', 'census', 'quadrats', 'coremeasurements', 'measurement_errors', 'uploadmetrics', 'validation_runs'] as const;
const REQUIRED_VIEWS = ['uploaddatalossreport'] as const;

/**
 * Canonical list of stored procedures defined in storedprocedures.sql.
 * Discovered by grepping `DEFINER ... PROCEDURE <name>` declarations.
 * Names are case-insensitively compared against information_schema.routines.
 */
const REQUIRED_PROCEDURES = [
  'bulkingestionprocess',
  'bulkingestioncollapser',
  'clearcensusfull',
  'clearcensusmsmts',
  'RefreshMeasurementsSummary',
  'RefreshViewFullTable',
  'RunSharedDBHChangeValidations',
  'RunSharedCrossCensusLocationValidations',
  'reinsertdefaultvalidations',
  'reinsertdefaultpostvalidations'
] as const;

/**
 * Expected minimum count of seeded validation rules in `sitespecificvalidations`.
 * Derived from `INSERT INTO sitespecificvalidations` statements in corequeries.sql
 * (currently 16: IDs 1-9, 11-15, 17-18). The 00-infrastructure test fixture adds
 * 2 more (IDs 20-21) via local-db-setup.ts, totaling 18 — those are test-only
 * extras and NOT part of provisioning. If corequeries.sql gains/loses validation
 * INSERTs, bump this constant and SCHEMA_VERSION together.
 */
const EXPECTED_VALIDATION_COUNT = 16;

interface ProvisioningMetaRow {
  SchemaVersion: string;
  TablesDeployedAt: Date | null;
  ProceduresDeployedAt: Date | null;
  ValidationsDeployedAt: Date | null;
}

async function ensureMetaTable(ctx: StepContext): Promise<void> {
  if (!ctx.sitePool) return;
  validateSchemaOrThrow(ctx.schemaName);
  await ctx.sitePool.query(
    `CREATE TABLE IF NOT EXISTS \`${ctx.schemaName}\`.\`${META_TABLE}\` (
       SchemaVersion VARCHAR(32) NOT NULL PRIMARY KEY,
       TablesDeployedAt DATETIME NULL,
       ProceduresDeployedAt DATETIME NULL,
       ValidationsDeployedAt DATETIME NULL
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
}

async function readMetaRow(ctx: StepContext): Promise<ProvisioningMetaRow | null> {
  if (!ctx.sitePool) return null;
  try {
    const [rows]: any = await ctx.sitePool.query(
      `SELECT SchemaVersion, TablesDeployedAt, ProceduresDeployedAt, ValidationsDeployedAt
       FROM \`${ctx.schemaName}\`.\`${META_TABLE}\`
       WHERE SchemaVersion = ?
       LIMIT 1`,
      [SCHEMA_VERSION]
    );
    return (rows[0] as ProvisioningMetaRow) ?? null;
  } catch {
    // Table doesn't exist yet — first provisioning run, or pre-meta schema.
    return null;
  }
}

async function writeMetaTimestamp(ctx: StepContext, column: 'TablesDeployedAt' | 'ProceduresDeployedAt' | 'ValidationsDeployedAt'): Promise<void> {
  if (!ctx.sitePool) return;
  validateSchemaOrThrow(ctx.schemaName);
  await ctx.sitePool.query(
    `INSERT INTO \`${ctx.schemaName}\`.\`${META_TABLE}\` (SchemaVersion, ${column})
     VALUES (?, NOW())
     ON DUPLICATE KEY UPDATE ${column} = NOW()`,
    [SCHEMA_VERSION]
  );
}

async function hasAllRequiredProcedures(ctx: StepContext): Promise<boolean> {
  if (!ctx.sitePool) return false;
  const [rows]: any = await ctx.sitePool.query(
    `SELECT LOWER(routine_name) AS name FROM information_schema.routines
     WHERE routine_schema = ? AND routine_type = 'PROCEDURE'`,
    [ctx.schemaName]
  );
  const existing = new Set(rows.map((r: any) => String(r.name ?? r.NAME ?? '').toLowerCase()));
  return REQUIRED_PROCEDURES.every(name => existing.has(name.toLowerCase()));
}

function buildSitePool(schemaName: string): mysql.Pool {
  const useTestDb = process.env.NODE_ENV === 'test' || Boolean(process.env.TEST_DB_HOST || process.env.TEST_DB_USER || process.env.TEST_DB_PASSWORD);
  const options: PoolOptions = {
    host: useTestDb ? process.env.TEST_DB_HOST || 'localhost' : process.env.AZURE_SQL_SERVER || 'localhost',
    port: Number(useTestDb ? process.env.TEST_DB_PORT || 3306 : process.env.AZURE_SQL_PORT || 3306),
    user: useTestDb ? process.env.TEST_DB_USER || 'root' : process.env.AZURE_SQL_USER,
    password: useTestDb ? process.env.TEST_DB_PASSWORD || 'testpassword' : process.env.AZURE_SQL_PASSWORD,
    database: schemaName,
    multipleStatements: false,
    connectionLimit: 5,
    charset: 'utf8mb4_0900_ai_ci',
    timezone: 'Z'
  };

  if (!useTestDb && process.env.AZURE_SQL_SERVER) {
    options.ssl = { rejectUnauthorized: false };
  }

  return mysql.createPool(options);
}

async function getExistingSiteObjects(ctx: StepContext): Promise<Set<string>> {
  if (!ctx.sitePool) return new Set();
  const [rows]: any = await ctx.sitePool.query(
    `SELECT table_name AS name FROM information_schema.tables WHERE table_schema = ?
     UNION
     SELECT table_name AS name FROM information_schema.views WHERE table_schema = ?`,
    [ctx.schemaName, ctx.schemaName]
  );
  return new Set(rows.map((row: any) => String(row.name ?? row.NAME ?? row.table_name ?? row.TABLE_NAME).toLowerCase()));
}

async function hasRequiredSchemaObjects(ctx: StepContext): Promise<boolean> {
  const existing = await getExistingSiteObjects(ctx);
  return REQUIRED_TABLES.every(name => existing.has(name)) && REQUIRED_VIEWS.every(name => existing.has(name));
}

async function resetSiteSchema(ctx: StepContext): Promise<void> {
  validateSchemaOrThrow(ctx.schemaName);
  if (ctx.sitePool) {
    await ctx.sitePool.end().catch(() => {});
    ctx.sitePool = null;
  }
  await ctx.catalogPool.query(`DROP DATABASE IF EXISTS \`${ctx.schemaName}\``);
  await ctx.catalogPool.query(
    `CREATE DATABASE \`${ctx.schemaName}\`
     CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`
  );
  ctx.sitePool = buildSitePool(ctx.schemaName);
}

export const createSchemaStep: ProvisioningStep = {
  key: 'create_schema',
  label: 'Create database schema',
  async alreadyDone(ctx: StepContext): Promise<boolean> {
    const [rows]: any = await ctx.catalogPool.query(`SELECT schema_name FROM information_schema.schemata WHERE schema_name = ? LIMIT 1`, [ctx.schemaName]);
    if (rows.length > 0) {
      if (!ctx.sitePool) ctx.sitePool = buildSitePool(ctx.schemaName);
      return true;
    }
    return false;
  },
  async run(ctx: StepContext): Promise<void> {
    validateSchemaOrThrow(ctx.schemaName);
    await ctx.catalogPool.query(
      `CREATE DATABASE IF NOT EXISTS \`${ctx.schemaName}\`
       CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`
    );
    ctx.sitePool = buildSitePool(ctx.schemaName);
  }
};

export const initTablesStep: ProvisioningStep = {
  key: 'init_tables',
  label: 'Initialize core tables',
  async alreadyDone(ctx: StepContext): Promise<boolean> {
    const meta = await readMetaRow(ctx);
    if (!meta || meta.TablesDeployedAt == null) return false;
    return hasRequiredSchemaObjects(ctx);
  },
  async run(ctx: StepContext): Promise<void> {
    if (!ctx.sitePool) throw new Error('sitePool not initialized; create_schema must run first');
    const existing = await getExistingSiteObjects(ctx);
    if (existing.size > 0 && !(await hasRequiredSchemaObjects(ctx))) {
      await resetSiteSchema(ctx);
    }
    await executeSqlFile(ctx.sitePool, TABLES_FILE(), ctx.schemaName);
    await ensureMetaTable(ctx);
    await writeMetaTimestamp(ctx, 'TablesDeployedAt');
  }
};

export const deployProceduresStep: ProvisioningStep = {
  key: 'deploy_procedures',
  label: 'Deploy stored procedures',
  async alreadyDone(ctx: StepContext): Promise<boolean> {
    if (!ctx.sitePool) return false;
    const meta = await readMetaRow(ctx);
    if (!meta || meta.ProceduresDeployedAt == null) return false;
    return hasAllRequiredProcedures(ctx);
  },
  async run(ctx: StepContext): Promise<void> {
    if (!ctx.sitePool) throw new Error('sitePool not initialized');
    await executeSqlFile(ctx.sitePool, PROCS_FILE(), ctx.schemaName);
    await ensureMetaTable(ctx);
    await writeMetaTimestamp(ctx, 'ProceduresDeployedAt');
  }
};

export const seedValidationsStep: ProvisioningStep = {
  key: 'seed_validations',
  label: 'Seed default validations',
  async alreadyDone(ctx: StepContext): Promise<boolean> {
    if (!ctx.sitePool) return false;
    const meta = await readMetaRow(ctx);
    if (!meta || meta.ValidationsDeployedAt == null) return false;
    try {
      const [rows]: any = await ctx.sitePool.query(`SELECT COUNT(*) AS c FROM \`${ctx.schemaName}\`.\`${VALIDATIONS_TABLE}\``);
      const count = Number(rows[0]?.c ?? rows[0]?.C ?? 0);
      return count >= EXPECTED_VALIDATION_COUNT;
    } catch {
      // Table doesn't exist yet (init_tables hasn't run)
      return false;
    }
  },
  async run(ctx: StepContext): Promise<void> {
    if (!ctx.sitePool) throw new Error('sitePool not initialized');
    await executeSqlFile(ctx.sitePool, QUERIES_FILE(), ctx.schemaName);
    await ensureMetaTable(ctx);
    await writeMetaTimestamp(ctx, 'ValidationsDeployedAt');
  }
};
