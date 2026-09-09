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
 * way it does for a real operator's client). Collects every result row that
 * carries both a `metric` and an `n` column into a name -> number map —
 * this is the script's diagnostic convention (see the ops script header).
 * Sample-row SELECTs (different columns) execute normally but contribute
 * nothing to the returned map; assert on them with a direct query instead.
 */
export async function executeSection(conn: mysql.Connection, sectionSql: string): Promise<MetricMap> {
  const metrics: MetricMap = new Map();
  const cleaned = stripCommentLines(sectionSql);

  for (const stmt of splitSqlFile(cleaned)) {
    if (!stmt.sql.trim()) continue;
    const [result] = await conn.query(stmt.sql);
    if (!Array.isArray(result)) continue;
    for (const row of result as Record<string, unknown>[]) {
      if (row && typeof row === 'object' && 'metric' in row && 'n' in row) {
        metrics.set(String(row.metric), Number(row.n));
      }
    }
  }

  return metrics;
}
