/**
 * Real-MySQL proof that the schema migrations bring existing sites' DBH rule text to the
 * canonical corequeries.sql seeds without touching enablement or unrelated rules. This
 * replaces the deploy-time DBH seed refresh, so it is the only path that updates
 * existing schemas.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { setupTestDatabase, teardownTestDatabase } from '../setup/local-db-setup';
import { splitSqlFile } from '@/lib/provisioning/sql-runner';
import type { SchemaQueryRow } from '@/lib/db/schema-contract';
import { applyPendingMigrations, loadMigrationSources, type MigrationSource, type SqlExecutor } from '@/scripts/apply-schema-migrations';
import { parseSiteValidationSeeds } from '@/lib/validations/validation-seed-parser';
import { DBH_CHANGE_VALIDATION_IDS, DBH_GROWTH_PROCEDURE, DBH_SHRINKAGE_PROCEDURE } from '@/config/dbhchangevalidations';

const CANONICAL_DDL_PATH = path.join(process.cwd(), 'db', 'sql', 'tablestructures.sql');
const COREQUERIES_PATH = path.join(process.cwd(), 'db', 'sql', 'corequeries.sql');
const DBH_RULE_TEXT_MIGRATION_ID = '2026-09-13-01-annual-dbh-rule-text';
const DBH_RULE_TEXT_HELPER = 'mig_2026_09_13_01_raise_dbh_rule_conflict';
const LEGACY_GROWTH_DESCRIPTION = 'DBH growth exceeds maximum rate of 65 mm';
const LEGACY_SHRINKAGE_DESCRIPTION = 'DBH shrinkage exceeds maximum rate of 5 percent';
const LEGACY_DEFINITION = 'SELECT legacy_inline_rule;';
const CUSTOM_RULE_ID = 40;
const IDENTITY_CONFLICT_PATTERN = /DBH rule identity conflict/;

function isEnabledFlag(value: unknown): boolean {
  return Buffer.isBuffer(value) ? value[0] === 1 : Number(value) === 1;
}

describe('DBH rule text migration', () => {
  let connection: Connection;
  let config: { database: string };
  let sources: MigrationSource[];
  const canonicalSeeds = parseSiteValidationSeeds(fs.readFileSync(COREQUERIES_PATH, 'utf8'));
  const canonical = (id: number) => {
    const seed = canonicalSeeds.find(candidate => candidate.validationID === id);
    if (!seed) throw new Error(`corequeries.sql has no seed for ValidationID ${id}`);
    return seed;
  };

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    config = setup.config;
    sources = loadMigrationSources();
  }, 120_000);

  afterAll(async () => teardownTestDatabase(connection, config));

  async function provisionWithLegacyRules(schemaName: string, rules: Array<[number, string, string, string, boolean]>): Promise<SqlExecutor> {
    await connection.query(`DROP DATABASE IF EXISTS \`${schemaName}\``);
    await connection.query(`CREATE DATABASE \`${schemaName}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
    await connection.query(`USE \`${schemaName}\``);
    const failures: string[] = [];
    for (const statement of splitSqlFile(fs.readFileSync(CANONICAL_DDL_PATH, 'utf-8'))) {
      try {
        await connection.query(statement.sql);
      } catch (error) {
        failures.push(`line ${statement.lineNumber}: ${(error as Error).message}`);
      }
    }
    expect(failures, `${schemaName} canonical DDL failed to load:\n${failures.join('\n')}`).toEqual([]);
    for (const [id, procedureName, description, definition, isEnabled] of rules) {
      await connection.query(
        'INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition, ChangelogDefinition, IsEnabled) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [id, procedureName, description, 'measuredDBH', definition, '', isEnabled]
      );
    }
    return async (sql, params) => {
      const [rows] = await connection.query(sql, params ?? []);
      return Array.isArray(rows) ? (rows as SchemaQueryRow[]) : [];
    };
  }

  async function readRules(): Promise<RowDataPacket[]> {
    const [rows] = await connection.query<RowDataPacket[]>(
      'SELECT ValidationID, ProcedureName, Description, Criteria, Definition, IsEnabled FROM sitespecificvalidations WHERE ValidationID IN (?, ?, ?) ORDER BY ValidationID',
      [DBH_CHANGE_VALIDATION_IDS.growth, DBH_CHANGE_VALIDATION_IDS.shrinkage, CUSTOM_RULE_ID]
    );
    return rows;
  }

  it('rewrites DBH rule text to the canonical seeds, preserving IsEnabled and unrelated rules, and is idempotent', async () => {
    const schemaName = 'dbh_rule_text_happy_path';
    const exec = await provisionWithLegacyRules(schemaName, [
      [DBH_CHANGE_VALIDATION_IDS.growth, DBH_GROWTH_PROCEDURE, LEGACY_GROWTH_DESCRIPTION, LEGACY_DEFINITION, true],
      [DBH_CHANGE_VALIDATION_IDS.shrinkage, DBH_SHRINKAGE_PROCEDURE, LEGACY_SHRINKAGE_DESCRIPTION, LEGACY_DEFINITION, false],
      [CUSTOM_RULE_ID, 'SiteAuthoredRule', 'Site-authored text', 'SELECT site_rule;', true]
    ]);
    try {
      const result = await applyPendingMigrations(exec, schemaName, sources);
      expect(result.failed, result.failed ? `${result.failed.id}: ${result.failed.error}` : undefined).toBeNull();
      expect(result.appliedNow).toContain(DBH_RULE_TEXT_MIGRATION_ID);

      const expectedRules = [
        { id: DBH_CHANGE_VALIDATION_IDS.growth, enabled: true },
        { id: DBH_CHANGE_VALIDATION_IDS.shrinkage, enabled: false }
      ].map(({ id, enabled }) => ({
        ValidationID: id,
        ProcedureName: canonical(id).procedureName,
        Description: canonical(id).description,
        Criteria: 'measuredDBH',
        Definition: canonical(id).definition,
        IsEnabled: enabled
      }));
      const customRule = {
        ValidationID: CUSTOM_RULE_ID,
        ProcedureName: 'SiteAuthoredRule',
        Description: 'Site-authored text',
        Criteria: 'measuredDBH',
        Definition: 'SELECT site_rule;',
        IsEnabled: true
      };
      const normalize = (rows: RowDataPacket[]) => rows.map(row => ({ ...row, IsEnabled: isEnabledFlag(row.IsEnabled) }));

      expect(normalize(await readRules()), 'DBH rules take canonical text, keep their enablement, and the site rule is untouched').toEqual([
        ...expectedRules,
        customRule
      ]);

      const migration = sources.find(source => source.id === DBH_RULE_TEXT_MIGRATION_ID)!;
      await connection.query(migration.contents);
      expect(normalize(await readRules()), 're-running the migration SQL directly must be a no-op').toEqual([...expectedRules, customRule]);
    } finally {
      await connection.query(`DROP DATABASE IF EXISTS \`${schemaName}\``);
    }
  }, 60_000);

  it('refuses to rewrite when ValidationID 1 is held by a different rule, leaving it untouched and cleaning up its helper', async () => {
    const schemaName = 'dbh_rule_text_id_conflict';
    const exec = await provisionWithLegacyRules(schemaName, [
      [DBH_CHANGE_VALIDATION_IDS.growth, 'CustomSiteRule', 'Custom rule at ID 1', 'SELECT custom;', true],
      [DBH_CHANGE_VALIDATION_IDS.shrinkage, DBH_SHRINKAGE_PROCEDURE, LEGACY_SHRINKAGE_DESCRIPTION, LEGACY_DEFINITION, true]
    ]);
    try {
      const result = await applyPendingMigrations(exec, schemaName, sources);

      expect(result.failed?.id).toBe(DBH_RULE_TEXT_MIGRATION_ID);
      expect(result.failed?.error).toMatch(IDENTITY_CONFLICT_PATTERN);
      const rules = await readRules();
      expect(
        rules.map(row => [Number(row.ValidationID), row.ProcedureName, row.Description]),
        'a failed identity check must change neither DBH row'
      ).toEqual([
        [DBH_CHANGE_VALIDATION_IDS.growth, 'CustomSiteRule', 'Custom rule at ID 1'],
        [DBH_CHANGE_VALIDATION_IDS.shrinkage, DBH_SHRINKAGE_PROCEDURE, LEGACY_SHRINKAGE_DESCRIPTION]
      ]);
      const [helpers] = await connection.query<RowDataPacket[]>(
        'SELECT COUNT(*) AS count FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ? AND ROUTINE_NAME = ?',
        [schemaName, DBH_RULE_TEXT_HELPER]
      );
      expect(Number(helpers[0].count), 'the failed migration must not leave its helper procedure behind').toBe(0);
    } finally {
      await connection.query(`DROP DATABASE IF EXISTS \`${schemaName}\``);
    }
  }, 60_000);
});
