import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import { readFileSync } from 'fs';
import mysql from 'mysql2/promise';
import { splitSqlFile, executeSqlFile } from './sql-runner';

const TABLES_FILE = path.join(process.cwd(), 'sqlscripting/tablestructures.sql');
const PROCS_FILE = path.join(process.cwd(), 'sqlscripting/storedprocedures.sql');
const QUERIES_FILE = path.join(process.cwd(), 'sqlscripting/corequeries.sql');

describe('splitSqlFile', () => {
  it('parses tablestructures.sql into statements with line numbers', () => {
    const content = readFileSync(TABLES_FILE, 'utf-8');
    const stmts = splitSqlFile(content);
    expect(stmts.length).toBeGreaterThan(10);
    const sourceLines = content.split('\n');
    // First non-comment, non-blank line in tablestructures.sql is ALTER DATABASE — verify
    // line numbers track correctly by checking the reported line matches the start of that statement.
    const firstStmt = stmts[0];
    const firstStmtFirstLine = sourceLines[firstStmt.lineNumber - 1].toUpperCase();
    // The line must begin the SQL keyword that opens the first statement
    expect(firstStmtFirstLine).toMatch(/\b(CREATE|ALTER|DROP|INSERT|SET|USE)\b/);
  });

  it('preserves stored procedure bodies across DELIMITER blocks', () => {
    const content = readFileSync(PROCS_FILE, 'utf-8');
    const stmts = splitSqlFile(content);
    // The actual DDL uses "CREATE\n    DEFINER = ... PROCEDURE bulkingestionprocess" across multiple lines
    const bulkIngestion = stmts.find(s => /CREATE[\s\S]*?PROCEDURE\s+`?bulkingestionprocess/i.test(s.sql));
    expect(bulkIngestion).toBeDefined();
    expect(bulkIngestion!.sql).toContain('BEGIN');
    expect(bulkIngestion!.sql).toContain('END');
    // Verify exactly one procedure definition — the DDL uses "CREATE\n    DEFINER = ... PROCEDURE name"
    // so we match on the procedure name appearing exactly once rather than the literal "CREATE PROCEDURE"
    expect((bulkIngestion!.sql.match(/PROCEDURE\s+`?bulkingestionprocess/gi) ?? []).length).toBe(1);
  });

  it('parses corequeries.sql without errors', () => {
    const content = readFileSync(QUERIES_FILE, 'utf-8');
    const stmts = splitSqlFile(content);
    expect(stmts.length).toBeGreaterThan(0);
  });

  it('strips trailing delimiters from emitted statements', () => {
    const content = 'CREATE TABLE foo (id INT);\nSELECT 1;';
    const stmts = splitSqlFile(content);
    expect(stmts[0].sql).toBe('CREATE TABLE foo (id INT)');
    expect(stmts[1].sql).toBe('SELECT 1');
  });

  it('handles DELIMITER $$ blocks', () => {
    const content = `
DELIMITER $$
CREATE PROCEDURE foo()
BEGIN
  SELECT 1;
  SELECT 2;
END$$
DELIMITER ;
SELECT 3;
`;
    const stmts = splitSqlFile(content);
    expect(stmts).toHaveLength(2);
    expect(stmts[0].sql).toContain('CREATE PROCEDURE foo()');
    expect(stmts[0].sql).toContain('SELECT 1');
    expect(stmts[0].sql).toContain('SELECT 2');
    expect(stmts[1].sql).toBe('SELECT 3');
  });
});

describe('executeSqlFile', () => {
  const SCHEMA_NAME = `forestgeo_sqlrunner_test_${process.pid}`;
  let pool: mysql.Pool;

  beforeAll(async () => {
    pool = mysql.createPool({
      host: process.env.TEST_DB_HOST || 'localhost',
      port: Number(process.env.TEST_DB_PORT || 3306),
      user: process.env.TEST_DB_USER || 'root',
      password: process.env.TEST_DB_PASSWORD || 'testpassword',
      multipleStatements: false,
      connectionLimit: 5
    });
    await pool.query(`DROP DATABASE IF EXISTS \`${SCHEMA_NAME}\``);
    await pool.query(`CREATE DATABASE \`${SCHEMA_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
  });

  afterAll(async () => {
    await pool.query(`DROP DATABASE IF EXISTS \`${SCHEMA_NAME}\``);
    await pool.end();
  });

  it('initializes the core tables from tablestructures.sql', async () => {
    await executeSqlFile(pool, TABLES_FILE, SCHEMA_NAME);
    const [rows]: any = await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = ?`, [SCHEMA_NAME]);
    const names = rows.map((r: any) => (r.table_name ?? r.TABLE_NAME).toLowerCase());
    expect(names).toContain('plots');
    expect(names).toContain('census');
    expect(names).toContain('quadrats');
    expect(names).toContain('coremeasurements');
  });

  it('attaches file and lineNumber metadata on SQL errors', async () => {
    // Force a duplicate-table error by running tablestructures.sql against the already-initialized schema
    await expect(executeSqlFile(pool, TABLES_FILE, SCHEMA_NAME)).rejects.toMatchObject({
      file: TABLES_FILE,
      lineNumber: expect.any(Number)
    });
  });
});
