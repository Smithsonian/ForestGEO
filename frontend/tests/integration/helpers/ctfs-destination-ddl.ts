/**
 * Loads the canonical Smithsonian (CTFS-shaped) destination DDL into a test
 * connection, tolerating only the production-only-object errors a fresh test
 * database is expected to hit.
 *
 * This duplicates the private `loadCtfsDdl` helper in
 * ctfs-export.integration.test.ts and the private `loadCanonicalDdl` helper
 * in csv-to-sql-v2.integration.test.ts, so that a third suite
 * (stem-plot-coordinate-backfill.integration.test.ts) does not have to
 * reimplement the production-only-object tolerance list a third time.
 * Neither existing suite has been switched over to call this shared version
 * yet — that is a pending follow-up, not done here.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type mysql from 'mysql2/promise';
import { splitSqlFile } from '../../../lib/provisioning/sql-runner';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CTFS_DDL_PATH = path.resolve(__dirname, '../../fixtures/csv-to-sql-v2/canonical-ddl.sql');

/**
 * DBCHANGES2014f (the tail of canonical-ddl.sql) ALTERs/RENAMEs objects that
 * only exist on a live, fully-migrated CTFS destination (the reporting view
 * and its predecessor table). A fresh test database never has them — the
 * DDL load tolerates exactly these ER_NO_SUCH_TABLE errors and nothing else.
 */
const PRODUCTION_ONLY_OBJECTS = ['ViewTaxonomy', 'ViewFullTable', 'TAX1temp'];

function isTolerableDdlError(errCode: string, stmt: string): boolean {
  if (errCode !== 'ER_NO_SUCH_TABLE') return false;
  return PRODUCTION_ONLY_OBJECTS.some(obj => stmt.includes(obj));
}

function stripBlockComments(content: string): string {
  return content.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Load canonical-ddl.sql into `conn`, tolerating only the production-only
 * object errors above. The DDL's own DBCHANGES2014f section already issues
 * the historical ALTERs (including widening Stem/Coordinates PX/PY/QX/QY to
 * decimal(16,5)) — no extra step needed.
 */
export async function loadCanonicalDestinationDdl(conn: mysql.Connection): Promise<void> {
  const content = stripBlockComments(readFileSync(CTFS_DDL_PATH, 'utf8'));
  for (const stmt of splitSqlFile(content)) {
    if (!stmt.sql.trim()) continue;
    try {
      await conn.query(stmt.sql);
    } catch (err: any) {
      if (isTolerableDdlError(err.code, stmt.sql)) continue;
      const preview = stmt.sql.slice(0, 200).replace(/\s+/g, ' ');
      throw new Error(`Canonical destination DDL load failed at line ${stmt.lineNumber}: ${err.message}\nStatement: ${preview}`);
    }
  }
}
