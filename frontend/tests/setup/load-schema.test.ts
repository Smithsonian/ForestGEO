/**
 * Regression tests for the schema loader's statement-splitting and
 * table-completeness guard (issue #434).
 *
 * No real database is used: `schemaStatementsFrom` and `tableNamesDeclaredIn`
 * are pure functions, and `loadSchema` is exercised against a fake
 * `{ query: vi.fn() }` connection (same convention as local-db-setup.test.ts).
 */
import fs from 'fs';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';

import { loadSchema, schemaStatementsFrom, tableNamesDeclaredIn } from './local-db-setup';

const TABLE_UPLOAD_SESSIONS = 'upload_sessions';
const TABLE_UPLOAD_ERRORS = 'upload_errors';
const TABLE_VALIDATION_RUNS = 'validation_runs';
const TABLE_ATTRIBUTES = 'attributes';
const TABLE_PLOTS = 'plots';
const TABLE_WIDGETS = 'widgets';
const TABLE_GHOST = 'ghost';

const SET_FOREIGN_KEY_CHECKS_ON = 'SET FOREIGN_KEY_CHECKS = 1';
const INFORMATION_SCHEMA_QUERY_FRAGMENT = 'information_schema.TABLES';
const BANNER_LINE = '-- =====================================================================================';
const CREATE_TABLE_STATEMENT_PATTERN = /create\s+table/i;

describe('schemaStatementsFrom', () => {
  it('keeps a CREATE TABLE statement that follows a banner comment (LF line endings)', () => {
    const schemaSql =
      [
        BANNER_LINE,
        '-- Upload Session Tracking Tables',
        BANNER_LINE,
        '',
        `create table if not exists ${TABLE_UPLOAD_SESSIONS} (`,
        '    session_id varchar(64) not null',
        ')'
      ].join('\n') + ';';

    const statements = schemaStatementsFrom(schemaSql);

    expect(statements, `expected exactly one surviving statement, got: ${JSON.stringify(statements)}`).toHaveLength(1);
    expect(statements[0], 'the banner comment lines must be stripped from the returned statement').not.toContain('--');
    expect(statements[0].toLowerCase(), `expected the CREATE TABLE for '${TABLE_UPLOAD_SESSIONS}' to survive banner-stripping`).toContain(
      `create table if not exists ${TABLE_UPLOAD_SESSIONS}`
    );
  });

  it('keeps the same statement with CRLF line endings', () => {
    const schemaSql =
      [
        BANNER_LINE,
        '-- Upload Session Tracking Tables',
        BANNER_LINE,
        '',
        `create table if not exists ${TABLE_UPLOAD_SESSIONS} (`,
        '    session_id varchar(64) not null',
        ')'
      ].join('\r\n') + ';';

    const statements = schemaStatementsFrom(schemaSql);

    expect(statements, `expected exactly one surviving statement, got: ${JSON.stringify(statements)}`).toHaveLength(1);
    expect(statements[0].toLowerCase(), 'CRLF banner lines must be stripped just like LF ones').toContain(
      `create table if not exists ${TABLE_UPLOAD_SESSIONS}`
    );
  });

  it('discards a chunk that is comment-only', () => {
    const schemaSql = ['-- just a trailing note, no SQL follows', ''].join('\n');

    expect(schemaStatementsFrom(schemaSql), 'a chunk with no real SQL must produce zero statements, not an empty-string statement').toEqual([]);
  });

  it('treats a comment line with leading whitespace before -- as a comment', () => {
    const schemaSql = ['   -- indented banner note', `create table if not exists ${TABLE_WIDGETS} (id int)`].join('\n') + ';';

    const statements = schemaStatementsFrom(schemaSql);

    expect(statements).toHaveLength(1);
    expect(statements[0], 'an indented leading comment line must still be recognized and stripped').not.toContain('indented banner note');
  });

  it('preserves a mid-statement comment line inside the returned statement', () => {
    const schemaSql =
      [
        `create table if not exists ${TABLE_UPLOAD_SESSIONS} (`,
        '    -- Set once, in the same transaction as the census-wide cleanup',
        '    census_replacement_completed_at timestamp default null',
        ')'
      ].join('\n') + ';';

    const statements = schemaStatementsFrom(schemaSql);

    expect(statements).toHaveLength(1);
    expect(
      statements[0],
      'a comment line embedded inside a statement body must survive: MySQL accepts it there, and stripping it would be over-eager'
    ).toContain('-- Set once, in the same transaction as the census-wide cleanup');
  });

  it('keeps quoted semicolons and escaped quotes inside one statement', () => {
    const sql = "INSERT INTO widgets VALUES ('one; two', 'it''s; fine');\nSELECT 1;";
    expect(schemaStatementsFrom(sql)).toEqual(["INSERT INTO widgets VALUES ('one; two', 'it''s; fine')", 'SELECT 1']);
  });

  it('leaves string literal content that happens to contain -- untouched', () => {
    const schemaSql = `insert into ${TABLE_WIDGETS} (label) values ('a -- not a comment');`;

    const statements = schemaStatementsFrom(schemaSql);

    expect(statements).toEqual([`insert into ${TABLE_WIDGETS} (label) values ('a -- not a comment')`]);
  });
});

describe('tableNamesDeclaredIn', () => {
  it('finds a table whose CREATE follows a banner comment', () => {
    const schemaSql =
      [BANNER_LINE, '-- Validation Runs', BANNER_LINE, '', `create table if not exists ${TABLE_VALIDATION_RUNS} (`, '    RunID int', ')'].join('\n') + ';';

    expect(tableNamesDeclaredIn(schemaSql)).toEqual([TABLE_VALIDATION_RUNS]);
  });

  it('finds both the "if not exists" and the plain "create table" forms', () => {
    const schemaSql = [`create table if not exists ${TABLE_ATTRIBUTES} (Code varchar(10));`, `create table ${TABLE_PLOTS} (PlotID int);`].join('\n');

    expect(tableNamesDeclaredIn(schemaSql)).toEqual([TABLE_ATTRIBUTES, TABLE_PLOTS]);
  });

  it('is independent of statement splitting: finds a name in raw text the OLD buggy splitter would have dropped', () => {
    const schemaSql =
      ['-- Upload Session Tracking Tables', `create table if not exists ${TABLE_UPLOAD_SESSIONS} (`, '    session_id varchar(64) not null', ')'].join('\n') +
      ';';

    // Reproduce the OLD (buggy) splitter to confirm this fixture is one it
    // would have dropped entirely.
    const oldBuggySplitterOutput = schemaSql
      .split(';')
      .map(chunk => chunk.trim())
      .filter(chunk => chunk.length > 0 && !chunk.startsWith('--'));
    expect(oldBuggySplitterOutput, 'sanity check failed: this fixture no longer reproduces the old splitter dropping the statement').toEqual([]);

    expect(
      tableNamesDeclaredIn(schemaSql),
      `tableNamesDeclaredIn must find '${TABLE_UPLOAD_SESSIONS}' even though the old splitter would have discarded it entirely`
    ).toEqual([TABLE_UPLOAD_SESSIONS]);
  });

  it('does not report a commented-out CREATE TABLE declaration', () => {
    const schemaSql = `-- create table ${TABLE_GHOST} (id int);`;

    const declaredTableNames = tableNamesDeclaredIn(schemaSql);

    expect(declaredTableNames, `a commented-out declaration must not be reported as a real table. Found: ${declaredTableNames.join(', ')}`).not.toContain(
      TABLE_GHOST
    );
  });

  it('does not report a CREATE TABLE that only appears inside a string literal', () => {
    const schemaSql = `insert into log_messages (msg) values ('rejected: CREATE TABLE ${TABLE_GHOST} (id int)');`;

    const declaredTableNames = tableNamesDeclaredIn(schemaSql);

    expect(declaredTableNames, `a CREATE TABLE embedded in a string literal must not be reported. Found: ${declaredTableNames.join(', ')}`).not.toContain(
      TABLE_GHOST
    );
  });

  it('reports a genuine declaration written with uppercase keywords and a backticked name, with or without IF NOT EXISTS', () => {
    const withIfNotExists = tableNamesDeclaredIn(`CREATE TABLE IF NOT EXISTS \`${TABLE_WIDGETS}\` (\n    id int\n);`);
    expect(
      withIfNotExists,
      `expected '${TABLE_WIDGETS}' from an uppercase, backticked, IF NOT EXISTS declaration. Found: ${withIfNotExists.join(', ')}`
    ).toEqual([TABLE_WIDGETS]);

    const withoutIfNotExists = tableNamesDeclaredIn(`CREATE TABLE \`${TABLE_WIDGETS}\` (\n    id int\n);`);
    expect(
      withoutIfNotExists,
      `expected '${TABLE_WIDGETS}' from an uppercase, backticked declaration without IF NOT EXISTS. Found: ${withoutIfNotExists.join(', ')}`
    ).toEqual([TABLE_WIDGETS]);
  });

  it('reports a declaration indented with leading whitespace', () => {
    const schemaSql = `    create table if not exists ${TABLE_WIDGETS} (\n    id int\n);`;

    const declaredTableNames = tableNamesDeclaredIn(schemaSql);

    expect(declaredTableNames, `an indented declaration must still be reported. Found: ${declaredTableNames.join(', ')}`).toEqual([TABLE_WIDGETS]);
  });
});

interface FakeConnectionOptions {
  informationSchemaTables?: string[];
  informationSchemaError?: Error;
}

function createFakeConnection({ informationSchemaTables = [], informationSchemaError }: FakeConnectionOptions = {}) {
  const executedStatements: string[] = [];
  const query = vi.fn(async (sql: string) => {
    executedStatements.push(sql);
    if (sql.includes(INFORMATION_SCHEMA_QUERY_FRAGMENT)) {
      if (informationSchemaError) {
        throw informationSchemaError;
      }
      return [informationSchemaTables.map(tableName => ({ TABLE_NAME: tableName })), []];
    }
    return [[], []];
  });
  return { query, executedStatements };
}

function mockSchemaFile(schemaSql: string): void {
  vi.spyOn(fs, 'existsSync').mockReturnValue(true);
  vi.spyOn(fs, 'readFileSync').mockReturnValue(schemaSql as any);
}

describe('loadSchema (fake connection, no real database)', () => {
  const SYNTHETIC_SCHEMA_SQL =
    [BANNER_LINE, '-- Widget Tables', BANNER_LINE, '', `create table if not exists ${TABLE_WIDGETS} (`, '    id int not null primary key', ')'].join('\n') +
    ';';

  it('executes the CREATE TABLE statement that follows a banner comment (direct regression proof)', async () => {
    mockSchemaFile(SYNTHETIC_SCHEMA_SQL);
    const { query, executedStatements } = createFakeConnection({ informationSchemaTables: [TABLE_WIDGETS] });

    await loadSchema({ query } as any);

    const executedCreateTable = executedStatements.find(sql => sql.toLowerCase().includes(`create table if not exists ${TABLE_WIDGETS}`));
    expect(
      executedCreateTable,
      `expected an executed statement containing the banner-prefixed CREATE TABLE for '${TABLE_WIDGETS}'. Executed statements:\n${executedStatements.join('\n---\n')}`
    ).toBeTruthy();
  });

  it('rejects when information_schema is missing a table the file declares, naming that table, and still restores FOREIGN_KEY_CHECKS', async () => {
    mockSchemaFile(SYNTHETIC_SCHEMA_SQL);
    const { query, executedStatements } = createFakeConnection({ informationSchemaTables: [] });

    await expect(loadSchema({ query } as any)).rejects.toThrow(new RegExp(TABLE_WIDGETS));

    expect(
      executedStatements,
      `FOREIGN_KEY_CHECKS must be restored even when the completeness guard throws. Executed statements:\n${executedStatements.join('\n---\n')}`
    ).toContain(SET_FOREIGN_KEY_CHECKS_ON);
  });

  it('propagates an information_schema query failure and still restores FOREIGN_KEY_CHECKS', async () => {
    mockSchemaFile(SYNTHETIC_SCHEMA_SQL);
    const metadataError = new Error('ER_ACCESS_DENIED_ERROR: metadata query failed');
    const { query, executedStatements } = createFakeConnection({ informationSchemaError: metadataError });

    await expect(loadSchema({ query } as any)).rejects.toThrow(metadataError.message);

    expect(
      executedStatements,
      `FOREIGN_KEY_CHECKS must be restored even when the information_schema query itself rejects. Executed statements:\n${executedStatements.join('\n---\n')}`
    ).toContain(SET_FOREIGN_KEY_CHECKS_ON);
  });
});

describe('real schema file sanity (db/sql/tablestructures.sql, no database)', () => {
  const REAL_SCHEMA_PATH = path.join(process.cwd(), 'db/sql', 'tablestructures.sql');

  it('recovers every previously-dropped CREATE TABLE, and the two independent derivations cross-check to the same count', () => {
    const schemaSql = fs.readFileSync(REAL_SCHEMA_PATH, 'utf-8');

    const declaredTableNames = tableNamesDeclaredIn(schemaSql);
    const statements = schemaStatementsFrom(schemaSql);
    const createTableStatements = statements.filter(statement => CREATE_TABLE_STATEMENT_PATTERN.test(statement));

    for (const tableName of [TABLE_UPLOAD_ERRORS, TABLE_UPLOAD_SESSIONS, TABLE_VALIDATION_RUNS]) {
      expect(
        declaredTableNames,
        `tableNamesDeclaredIn should include '${tableName}'. Found (${declaredTableNames.length}): ${declaredTableNames.join(', ')}`
      ).toContain(tableName);

      const nameEscapedForRegex = tableName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const hasSurvivingCreateStatement = createTableStatements.some(statement =>
        new RegExp(`create\\s+table\\s+(if\\s+not\\s+exists\\s+)?${nameEscapedForRegex}\\b`, 'i').test(statement)
      );
      expect(
        hasSurvivingCreateStatement,
        `schemaStatementsFrom should yield a CREATE TABLE statement for '${tableName}' after banner-stripping (this is the ` +
          `statement the old splitter silently dropped). CREATE TABLE statements found (${createTableStatements.length}):\n${createTableStatements.join('\n---\n')}`
      ).toBe(true);
    }

    expect(
      declaredTableNames.length,
      `tableNamesDeclaredIn found ${declaredTableNames.length} name(s) but schemaStatementsFrom yielded ${createTableStatements.length} CREATE TABLE statement(s); ` +
        `these two independent derivations must cross-check to the same count. Declared: ${declaredTableNames.join(', ')}`
    ).toBe(createTableStatements.length);
  });
});
