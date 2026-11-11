import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Connection } from 'mysql2/promise';

const APP_DB_SEED_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'app-db-seed.sql');
const SQL_LINE_COMMENT_PREFIX = '--';
const SQL_STATEMENT_SEPARATOR = ';';

/**
 * Loads app-db-seed.sql: one fully exportable measurement (CoreMeasurementID 1,
 * StemGUID 1, census 1, plot 1) and the reference rows it needs. Comment lines
 * are dropped before splitting so a leading comment block cannot swallow the
 * first statement.
 */
export async function loadAppDbSeed(conn: Connection): Promise<void> {
  const statements = readFileSync(APP_DB_SEED_PATH, 'utf8')
    .split('\n')
    .filter(line => !line.trimStart().startsWith(SQL_LINE_COMMENT_PREFIX))
    .join('\n')
    .split(SQL_STATEMENT_SEPARATOR)
    .map(statement => statement.trim())
    .filter(statement => statement.length > 0);
  for (const statement of statements) {
    await conn.query(statement);
  }
}
