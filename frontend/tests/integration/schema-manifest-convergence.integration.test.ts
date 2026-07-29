/**
 * Manifest convergence proof (integration, real MySQL).
 *
 * INVARIANT: a site provisioned by the OLDEST release that can still provision one
 * must reach the canonical schema by applying the migration manifest alone.
 *
 * This is not hypothetical. Provisioning bakes the DEPLOYED app's copy of
 * tablestructures.sql into each new site, and the live site deploys from `main`,
 * which trails the dev branch. On 2026-07-29 forestgeo_niobrara was provisioned that
 * way and came up missing stems.PublishedStemID, coremeasurements.RawPublishedStemID,
 * idx_stems_publishedstemid, the arcgis import tables, the postvalidation last-run
 * columns, and both taxonomy views. Nothing in the manifest created any of them, so
 * the deploy's own post-apply contract audit failed with no automated remedy and
 * every dev deployment was blocked until the columns were added by hand.
 *
 * The test loads the pinned baseline DDL and the canonical DDL into two throwaway
 * schemas, applies the manifest to the baseline, and asserts the baseline is then a
 * superset of canonical. A new object added to tablestructures.sql without a
 * corresponding manifest migration fails here instead of in a deploy.
 *
 * Views are deliberately excluded from the migration assertion and covered
 * separately: they are CREATE OR REPLACE artifacts redeployed on every deploy by
 * scripts/deploy-taxonomy-views-to-all-schemas.ts, not one-shot migrations. The
 * final case proves that script's extraction actually creates them on a baseline
 * schema, so the deploy step is not merely assumed to work.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';
import { splitSqlFile } from '@/lib/provisioning/sql-runner';
import { applyPendingMigrations, loadMigrationSources, type SqlExecutor } from '@/scripts/apply-schema-migrations';
import { SCHEMA_MIGRATION_MANIFEST } from '@/db/migrations/manifest';

const BASELINE_SCHEMA = 'convergence_baseline';
const CANONICAL_SCHEMA = 'convergence_canonical';

const BASELINE_DDL_PATH = path.join(process.cwd(), 'tests/fixtures/schema-baselines/oldest-provisionable-release.sql');
const CANONICAL_DDL_PATH = path.join(process.cwd(), 'db/sql/tablestructures.sql');

const TAXONOMY_VIEWS = ['alltaxonomiesview', 'stemtaxonomiesview'] as const;
const BASE_TABLE_TYPE = 'BASE TABLE';
const VIEW_TYPE = 'VIEW';

interface ObjectSets {
  tables: Set<string>;
  columns: Set<string>;
  indexes: Set<string>;
}

async function loadDdlIntoSchema(connection: Connection, schema: string, ddlPath: string): Promise<void> {
  await connection.query(`DROP DATABASE IF EXISTS \`${schema}\``);
  await connection.query(`CREATE DATABASE \`${schema}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
  await connection.query(`USE \`${schema}\``);

  const statements = splitSqlFile(fs.readFileSync(ddlPath, 'utf-8'));
  const failures: string[] = [];
  for (const statement of statements) {
    try {
      await connection.query(statement.sql);
    } catch (error) {
      failures.push(`line ${statement.lineNumber}: ${(error as Error).message}`);
    }
  }

  // A DDL that half-loads would make every downstream assertion meaningless — a
  // "missing" object could just be a statement that never ran.
  expect(failures, `${schema} DDL failed to load cleanly:\n${failures.join('\n')}`).toEqual([]);
  expect(statements.length).toBeGreaterThan(100);
}

async function readObjectSets(connection: Connection, schema: string, tableType: string): Promise<ObjectSets> {
  const [tables] = await connection.query<RowDataPacket[]>(`SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = ?`, [
    schema,
    tableType
  ]);
  const names = tables.map(row => String(row.TABLE_NAME));

  const [columns] = await connection.query<RowDataPacket[]>(
    `SELECT CONCAT(TABLE_NAME, '.', COLUMN_NAME, ' ', COLUMN_TYPE, ' NULL=', IS_NULLABLE) AS sig
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?)`,
    [schema, names.length ? names : ['']]
  );
  const [indexes] = await connection.query<RowDataPacket[]>(
    `SELECT CONCAT(TABLE_NAME, '.', INDEX_NAME, '(', GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX), ')') AS sig
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?)
      GROUP BY TABLE_NAME, INDEX_NAME`,
    [schema, names.length ? names : ['']]
  );

  return {
    tables: new Set(names),
    columns: new Set(columns.map(row => String(row.sig))),
    indexes: new Set(indexes.map(row => String(row.sig)))
  };
}

function missingFrom(canonical: Set<string>, actual: Set<string>): string[] {
  return [...canonical].filter(entry => !actual.has(entry)).sort();
}

describe('Migration manifest converges an old-release schema to canonical', () => {
  let connection: Connection;
  let baseline: ObjectSets;
  let canonical: ObjectSets;
  let appliedIds: string[];

  beforeAll(async () => {
    connection = await mysql.createConnection({
      host: process.env.TEST_DB_HOST ?? 'localhost',
      user: process.env.TEST_DB_USER ?? 'root',
      password: process.env.TEST_DB_PASSWORD ?? 'testpassword',
      port: Number(process.env.TEST_DB_PORT ?? 3306),
      multipleStatements: true
    });

    await loadDdlIntoSchema(connection, BASELINE_SCHEMA, BASELINE_DDL_PATH);
    await loadDdlIntoSchema(connection, CANONICAL_SCHEMA, CANONICAL_DDL_PATH);

    await connection.query(`USE \`${BASELINE_SCHEMA}\``);
    const exec: SqlExecutor = async (sql, params) => {
      const [rows] = await connection.query(sql, params ?? []);
      return Array.isArray(rows) ? (rows as any[]) : [];
    };

    const result = await applyPendingMigrations(exec, BASELINE_SCHEMA, loadMigrationSources());
    expect(result.failed, `manifest failed on the baseline schema: ${JSON.stringify(result.failed)}`).toBeNull();
    appliedIds = result.appliedNow;

    baseline = await readObjectSets(connection, BASELINE_SCHEMA, BASE_TABLE_TYPE);
    canonical = await readObjectSets(connection, CANONICAL_SCHEMA, BASE_TABLE_TYPE);
  }, 120_000);

  afterAll(async () => {
    if (!connection) return;
    await connection.query(`DROP DATABASE IF EXISTS \`${BASELINE_SCHEMA}\``);
    await connection.query(`DROP DATABASE IF EXISTS \`${CANONICAL_SCHEMA}\``);
    await connection.end();
  });

  it('the baseline genuinely predates canonical, so the assertions below have something to prove', () => {
    // Guards the degenerate pass: if the fixture were accidentally replaced with a
    // copy of canonical, every convergence assertion would succeed vacuously.
    expect(appliedIds.length).toBeGreaterThan(0);
    expect(appliedIds).toEqual(SCHEMA_MIGRATION_MANIFEST.map(entry => entry.id));
  });

  it('every canonical BASE TABLE exists after applying the manifest', () => {
    const missing = missingFrom(canonical.tables, baseline.tables);
    expect(
      missing,
      `Tables in tablestructures.sql that no manifest migration creates:\n  ${missing.join('\n  ')}\n` +
        `Add a migration for them and append it to db/migrations/manifest.ts.`
    ).toEqual([]);
  });

  it('every canonical column exists after applying the manifest', () => {
    const missing = missingFrom(canonical.columns, baseline.columns);
    expect(missing, `Columns in tablestructures.sql that no manifest migration adds:\n  ${missing.join('\n  ')}`).toEqual([]);
  });

  it('every canonical index exists after applying the manifest', () => {
    const missing = missingFrom(canonical.indexes, baseline.indexes);
    expect(missing, `Indexes in tablestructures.sql that no manifest migration creates:\n  ${missing.join('\n  ')}`).toEqual([]);
  });

  it('the taxonomy views are absent from an old-release schema and are created by the deploy script, not the manifest', async () => {
    const viewsAfterManifest = await readObjectSets(connection, BASELINE_SCHEMA, VIEW_TYPE);
    for (const view of TAXONOMY_VIEWS) {
      expect(viewsAfterManifest.tables.has(view), `${view} unexpectedly created by a migration — update this test's split of responsibilities`).toBe(false);
    }

    // Same extraction the deploy step uses, applied here to prove the step actually
    // closes the gap the manifest deliberately leaves open.
    const canonicalSQL = fs.readFileSync(CANONICAL_DDL_PATH, 'utf-8');
    await connection.query(`USE \`${BASELINE_SCHEMA}\``);
    for (const view of TAXONOMY_VIEWS) {
      const match = canonicalSQL.match(new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+VIEW\\s+${view}\\b[\\s\\S]*?;`, 'i'));
      expect(match, `no CREATE OR REPLACE VIEW ${view} found in tablestructures.sql`).not.toBeNull();
      await connection.query(match![0]);
    }

    const viewsAfterDeploy = await readObjectSets(connection, BASELINE_SCHEMA, VIEW_TYPE);
    for (const view of TAXONOMY_VIEWS) {
      expect(viewsAfterDeploy.tables.has(view)).toBe(true);
      const [rows] = await connection.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM \`${view}\``);
      expect(Number(rows[0].n)).toBe(0);
    }
  });
});
