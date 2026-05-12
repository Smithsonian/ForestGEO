import path from 'path';
import mysql from 'mysql2/promise';
import type { ProvisioningStep, StepContext } from '../types';
import { executeSqlFile } from '../sql-runner';
import { validateSchemaOrThrow } from '@/config/utils/sqlsecurity';

const TABLES_FILE = () => path.join(process.cwd(), 'sqlscripting/tablestructures.sql');
const PROCS_FILE = () => path.join(process.cwd(), 'sqlscripting/storedprocedures.sql');
const QUERIES_FILE = () => path.join(process.cwd(), 'sqlscripting/corequeries.sql');

const SENTINEL_TABLE = 'plots';
const SENTINEL_PROCEDURE = 'bulkingestionprocess';
const VALIDATIONS_TABLE = 'sitespecificvalidations';

function buildSitePool(schemaName: string): mysql.Pool {
  return mysql.createPool({
    host: process.env.AZURE_SQL_HOST || process.env.TEST_DB_HOST || 'localhost',
    port: Number(process.env.AZURE_SQL_PORT || process.env.TEST_DB_PORT || 3306),
    user: process.env.AZURE_SQL_USER || process.env.TEST_DB_USER || 'root',
    password: process.env.AZURE_SQL_PASSWORD || process.env.TEST_DB_PASSWORD || 'testpassword',
    database: schemaName,
    multipleStatements: false,
    connectionLimit: 5
  });
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
    if (!ctx.sitePool) return false;
    const [rows]: any = await ctx.sitePool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = ? AND table_name = ? LIMIT 1`,
      [ctx.schemaName, SENTINEL_TABLE]
    );
    return rows.length > 0;
  },
  async run(ctx: StepContext): Promise<void> {
    if (!ctx.sitePool) throw new Error('sitePool not initialized; create_schema must run first');
    await executeSqlFile(ctx.sitePool, TABLES_FILE(), ctx.schemaName);
  }
};

export const deployProceduresStep: ProvisioningStep = {
  key: 'deploy_procedures',
  label: 'Deploy stored procedures',
  async alreadyDone(ctx: StepContext): Promise<boolean> {
    if (!ctx.sitePool) return false;
    const [rows]: any = await ctx.sitePool.query(
      `SELECT routine_name FROM information_schema.routines
       WHERE routine_schema = ? AND routine_name = ? LIMIT 1`,
      [ctx.schemaName, SENTINEL_PROCEDURE]
    );
    return rows.length > 0;
  },
  async run(ctx: StepContext): Promise<void> {
    if (!ctx.sitePool) throw new Error('sitePool not initialized');
    await executeSqlFile(ctx.sitePool, PROCS_FILE(), ctx.schemaName);
  }
};

export const seedValidationsStep: ProvisioningStep = {
  key: 'seed_validations',
  label: 'Seed default validations',
  async alreadyDone(ctx: StepContext): Promise<boolean> {
    if (!ctx.sitePool) return false;
    try {
      const [rows]: any = await ctx.sitePool.query(`SELECT COUNT(*) AS c FROM \`${ctx.schemaName}\`.\`${VALIDATIONS_TABLE}\``);
      const count = Number(rows[0]?.c ?? rows[0]?.C ?? 0);
      return count > 0;
    } catch {
      // Table doesn't exist yet (init_tables hasn't run)
      return false;
    }
  },
  async run(ctx: StepContext): Promise<void> {
    if (!ctx.sitePool) throw new Error('sitePool not initialized');
    await executeSqlFile(ctx.sitePool, QUERIES_FILE(), ctx.schemaName);
  }
};
