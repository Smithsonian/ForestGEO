/**
 * Executes the real text of a `db/ops/*.sql` operator script's marked
 * sections against a live connection, instead of a test-owned copy of the
 * SQL. This is what lets an integration test prove the script an operator
 * actually runs by hand behaves as documented — see
 * tests/integration/stem-plot-coordinate-backfill.integration.test.ts.
 *
 * Section convention (see db/ops/2026-09-09-backfill-stem-plot-coordinates.sql):
 * every section starts with a line exactly `-- SECTION: <name>` and runs to
 * the next marker (or EOF). Nothing executable precedes the first marker.
 */

import { readFileSync } from 'node:fs';
import type mysql from 'mysql2/promise';
import { splitSqlFile } from '../../../lib/provisioning/sql-runner';

const SECTION_MARKER = /^-- SECTION: (\w+)$/;

export interface OpsScriptSections {
  /**
   * Every line before the first `-- SECTION:` marker, joined with '\n'.
   * Must contain only comment/blank lines — nothing executable is allowed
   * to precede the first marker (see the ops script header). Callers assert
   * on this directly; it is never passed to `executeSection`.
   */
  preamble: string;
  /**
   * Section name -> raw SQL text (comments and all — pass straight to
   * `executeSection`, which strips comments itself). Insertion order
   * matches the order the markers appear in the file, so
   * `Array.from(sections.keys())` reflects the file's real section order.
   */
  sections: Map<string, string>;
}

/**
 * Splits an ops script into its preamble and its named sections.
 */
export function readOpsScriptSections(filePath: string): OpsScriptSections {
  const content = readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  const sections = new Map<string, string>();
  const preambleLines: string[] = [];
  let currentName: string | null = null;
  let buffer: string[] = [];

  for (const line of lines) {
    const match = line.match(SECTION_MARKER);
    if (match) {
      if (currentName !== null) {
        sections.set(currentName, buffer.join('\n'));
      }
      currentName = match[1];
      buffer = [];
      continue;
    }
    if (currentName !== null) {
      buffer.push(line);
    } else {
      preambleLines.push(line);
    }
  }
  if (currentName !== null) {
    sections.set(currentName, buffer.join('\n'));
  }

  return { preamble: preambleLines.join('\n'), sections };
}

export type MetricMap = Map<string, number>;

/**
 * Strips full-line `--` comments. Mirrors the approach
 * ctfs-export.integration.test.ts's loadAppSchema uses for its seed file —
 * splitSqlFile already tolerates `--` comments that open a statement, but
 * this script also uses `--` marker lines (e.g. "-- CANDIDATE SELECT START")
 * in the middle of a multi-line statement, which are simplest to remove
 * up front rather than rely on every downstream consumer understanding
 * MySQL's own comment syntax.
 */
function stripCommentLines(sql: string): string {
  return sql
    .split('\n')
    .filter(line => !line.trim().startsWith('--'))
    .join('\n');
}

/**
 * Runs every statement in a section's SQL text against `conn`, in order, on
 * the same session (so `SET @var := ...` state persists across sections the
 * way it does for a real operator's client). Returns each statement's raw
 * result rows (or `null` for a statement with no result set, e.g. CREATE
 * TABLE) in execution order — `executeSection` below collapses these into
 * its metric/n map, but a caller that also needs a report-style section's
 * other result sets (e.g. the sample-row diagnostic SELECTs in
 * db/ops/2026-09-09-check-quadrat-origin-equivalence.sql) can index into
 * this directly instead.
 */
export async function executeSectionStatements(conn: mysql.Connection, sectionSql: string): Promise<(Record<string, unknown>[] | null)[]> {
  const cleaned = stripCommentLines(sectionSql);
  const resultSets: (Record<string, unknown>[] | null)[] = [];

  for (const stmt of splitSqlFile(cleaned)) {
    if (!stmt.sql.trim()) continue;
    const [result] = await conn.query(stmt.sql);
    resultSets.push(Array.isArray(result) ? (result as Record<string, unknown>[]) : null);
  }

  return resultSets;
}

/**
 * Scans an `executeSectionStatements` result (one entry per statement) for
 * every row shaped like `{ metric, n }` and collects them into a name ->
 * number map — this is the script's diagnostic convention (see the ops
 * script header). Sample-row SELECTs (different columns) contribute
 * nothing to the returned map; index into the `executeSectionStatements`
 * result directly to assert on those.
 */
export function collectMetrics(resultSets: (Record<string, unknown>[] | null)[]): MetricMap {
  const metrics: MetricMap = new Map();

  for (const rows of resultSets) {
    if (!rows) continue;
    for (const row of rows) {
      if (row && typeof row === 'object' && 'metric' in row && 'n' in row) {
        metrics.set(String(row.metric), Number(row.n));
      }
    }
  }

  return metrics;
}

/**
 * `collectMetrics(await executeSectionStatements(conn, sectionSql))` — the
 * common case where a section's result sets are all `{ metric, n }` rows and
 * a caller doesn't need the raw per-statement result sets.
 */
export async function executeSection(conn: mysql.Connection, sectionSql: string): Promise<MetricMap> {
  return collectMetrics(await executeSectionStatements(conn, sectionSql));
}
