import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mysql from 'mysql2/promise';
import { readFileSync } from 'fs';
import path from 'path';

const CATALOG_SCHEMA = 'catalog';
const PROVISIONING_RUNS_TABLE = 'provisioning_runs';
const PROVISIONING_STEPS_TABLE = 'provisioning_steps';
const PROVISIONING_STEPS_FK_NAME = 'fk_provisioning_steps_run';
const DDL_FILE_PATH = path.join(process.cwd(), 'sqlscripting/catalog-provisioning-tables.sql');

const EXPECTED_PROVISIONING_RUNS_COLUMNS = ['RunID', 'Status', 'StartedBy', 'StartedAt', 'FinishedAt', 'SiteName', 'SchemaName', 'InputPayload'];

describe('catalog provisioning tables', () => {
  let conn: mysql.Connection;

  beforeAll(async () => {
    conn = await mysql.createConnection({
      host: process.env.TEST_DB_HOST || 'localhost',
      port: Number(process.env.TEST_DB_PORT || 3306),
      user: process.env.TEST_DB_USER || 'root',
      password: process.env.TEST_DB_PASSWORD || 'testpassword',
      multipleStatements: true
    });

    await conn.query(`CREATE DATABASE IF NOT EXISTS ${CATALOG_SCHEMA} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);

    const ddl = readFileSync(DDL_FILE_PATH, 'utf-8');
    for (const stmt of ddl
      .split(';')
      .map(s => s.trim())
      .filter(Boolean)) {
      await conn.query(stmt);
    }
  });

  afterAll(async () => {
    await conn.query(`DROP TABLE IF EXISTS ${CATALOG_SCHEMA}.${PROVISIONING_STEPS_TABLE}`);
    await conn.query(`DROP TABLE IF EXISTS ${CATALOG_SCHEMA}.${PROVISIONING_RUNS_TABLE}`);
    await conn.end();
  });

  it('creates provisioning_runs with expected columns', async () => {
    const [rows]: any = await conn.query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = ? AND table_name = ?
       ORDER BY ordinal_position`,
      [CATALOG_SCHEMA, PROVISIONING_RUNS_TABLE]
    );
    const cols = rows.map((r: any) => r.column_name ?? r.COLUMN_NAME);
    expect(cols).toEqual(EXPECTED_PROVISIONING_RUNS_COLUMNS);
  });

  it('creates provisioning_steps with FK cascade on delete', async () => {
    const [rows]: any = await conn.query(
      `SELECT delete_rule
       FROM information_schema.referential_constraints
       WHERE constraint_schema = ? AND constraint_name = ?`,
      [CATALOG_SCHEMA, PROVISIONING_STEPS_FK_NAME]
    );
    const deleteRule = rows[0]?.delete_rule ?? rows[0]?.DELETE_RULE;
    expect(deleteRule).toBe('CASCADE');
  });

  it('is idempotent when DDL is re-applied', async () => {
    const ddl = readFileSync(DDL_FILE_PATH, 'utf-8');
    for (const stmt of ddl
      .split(';')
      .map(s => s.trim())
      .filter(Boolean)) {
      await conn.query(stmt);
    }
    // No throw = idempotent re-application succeeded
  });
});
