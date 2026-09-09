/** Real-MySQL proof that the DBH release refresh changes only rule text. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import { type Connection, type RowDataPacket } from 'mysql2/promise';
import path from 'path';
import { buildDbhRuleDeploymentManifest, refreshDbhRuleSeeds } from '@/lib/validations/dbh-rule-deployment';
import { buildRealSweepDeps } from '@/lib/validations/dbh-rescore-cli';
import type { TestDatabaseConfig } from '../setup/local-db-setup';
import { setupTestDatabase, teardownTestDatabase } from '../setup/local-db-setup';

const TEST_DB_HOST = process.env.TEST_DB_HOST || 'localhost';
if (!['localhost', '127.0.0.1', '::1'].includes(TEST_DB_HOST)) throw new Error(`[dbh-rule-deployment] refusing non-local TEST_DB_HOST=${TEST_DB_HOST}`);

describe('DBH rule deployment — integration', () => {
  let connection: Connection;
  let config: TestDatabaseConfig;
  let schema: string;
  const manifest = buildDbhRuleDeploymentManifest(
    fs.readFileSync(path.join(process.cwd(), 'db/sql/storedprocedures.sql'), 'utf8'),
    fs.readFileSync(path.join(process.cwd(), 'db/sql/corequeries.sql'), 'utf8')
  );

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    config = setup.config;
    schema = config.database;
    await connection.query('CREATE DATABASE IF NOT EXISTS catalog');
    await connection.query(
      "CREATE TABLE IF NOT EXISTS catalog.background_jobs (JobID INT AUTO_INCREMENT PRIMARY KEY, SchemaName VARCHAR(64), PlotID INT, CensusID INT, Status ENUM ('queued','running','cancel_requested','waiting_retry','completed','failed','cancelled') NOT NULL) ENGINE=InnoDB"
    );
    await connection.query(
      "CREATE TABLE IF NOT EXISTS validation_runs (RunID INT AUTO_INCREMENT PRIMARY KEY, PlotID INT NOT NULL, CensusID INT NOT NULL, Status ENUM ('running','completed','failed','cancelled') NOT NULL DEFAULT 'running') ENGINE=InnoDB"
    );
    await connection.query(
      "CREATE TABLE IF NOT EXISTS upload_sessions (session_id VARCHAR(64) PRIMARY KEY, schema_name VARCHAR(64), plot_id INT, census_id INT, state ENUM ('initialized','uploading','uploaded','processing','collapsing','completed','failed','abandoned','cleaned_up') NOT NULL DEFAULT 'initialized') ENGINE=InnoDB"
    );
  }, 120000);

  afterAll(async () => teardownTestDatabase(connection, config));

  beforeEach(async () => {
    await connection.query(
      `UPDATE \`${schema}\`.sitespecificvalidations
          SET Description = CONCAT('legacy-', ValidationID), Definition = CONCAT('CALL legacy_', ValidationID, '();')
        WHERE ValidationID IN (1, 2)`
    );
    await connection.query(
      `UPDATE \`${schema}\`.sitespecificvalidations
          SET Criteria = 'custom-criteria', ChangelogDefinition = 'custom-changelog', IsEnabled = TRUE
        WHERE ValidationID = 1`
    );
    await connection.query(`DELETE FROM \`${schema}\`.sitespecificvalidations WHERE ValidationID = 77`);
    await connection.query(
      `INSERT INTO \`${schema}\`.sitespecificvalidations
         (ValidationID, ProcedureName, Description, Criteria, Definition, ChangelogDefinition, IsEnabled)
       VALUES (77, 'CustomSiteRule', 'site-authored', 'custom', 'SELECT 77;', 'custom-log', FALSE)`
    );
  });

  async function validationRows(): Promise<RowDataPacket[]> {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT ValidationID, ProcedureName, Description, Criteria, Definition, ChangelogDefinition, IsEnabled
         FROM \`${schema}\`.sitespecificvalidations WHERE ValidationID IN (1, 2, 77) ORDER BY ValidationID`
    );
    return rows;
  }

  it('updates canonical DBH text, preserves every other DBH column and non-DBH row, and is idempotent', async () => {
    await refreshDbhRuleSeeds(connection, [schema], manifest, true);
    await refreshDbhRuleSeeds(connection, [schema], manifest, true);

    const rows = await validationRows();
    const growth = rows[0];
    const shrinkage = rows[1];
    const custom = rows[2];
    expect(growth).toMatchObject({
      ValidationID: 1,
      ProcedureName: manifest.seeds[0].procedureName,
      Description: manifest.seeds[0].description,
      Definition: manifest.seeds[0].definition,
      Criteria: 'custom-criteria',
      ChangelogDefinition: 'custom-changelog'
    });
    expect(shrinkage).toMatchObject({
      ValidationID: 2,
      ProcedureName: manifest.seeds[1].procedureName,
      Description: manifest.seeds[1].description,
      Definition: manifest.seeds[1].definition
    });
    expect(custom).toMatchObject({
      ValidationID: 77,
      ProcedureName: 'CustomSiteRule',
      Description: 'site-authored',
      Criteria: 'custom',
      Definition: 'SELECT 77;',
      ChangelogDefinition: 'custom-log'
    });
    expect(Buffer.isBuffer(custom.IsEnabled) ? custom.IsEnabled[0] : Number(custom.IsEnabled)).toBe(0);
  }, 120000);

  it.each([{ disabledIDs: [1] }, { disabledIDs: [1, 2] }])(
    'preserves operator-disabled DBH rules ($disabledIDs) during refresh, while the re-score sweep still rejects them',
    async ({ disabledIDs }) => {
      await connection.query(`UPDATE \`${schema}\`.sitespecificvalidations SET IsEnabled = FALSE WHERE ValidationID IN (?)`, [disabledIDs]);

      await refreshDbhRuleSeeds(connection, [schema], manifest, true);

      const rows = await validationRows();
      expect(
        rows
          .filter(row => disabledIDs.includes(Number(row.ValidationID)))
          .map(row => (Buffer.isBuffer(row.IsEnabled) ? row.IsEnabled[0] : Number(row.IsEnabled)))
      ).toEqual(disabledIDs.map(() => 0));
      await expect(buildRealSweepDeps(connection, manifest).verifySchema(schema)).rejects.toThrow(/differs/);
    },
    120000
  );

  it('does not write any schema when a later all-schema preflight fails', async () => {
    await expect(refreshDbhRuleSeeds(connection, [schema, 'forestgeo_missing'], manifest, true)).rejects.toThrow();
    const rows = await validationRows();
    expect(rows[0].Description).toBe('legacy-1');
    expect(rows[1].Definition).toBe('CALL legacy_2();');
  });

  it('rolls back the seed update when final revision verification fails', async () => {
    let updates = 0;
    const proxy = {
      query: async (sql: string, params?: unknown[]) => {
        if (/^\s*UPDATE\s/i.test(sql)) updates += 1;
        if (updates > 0 && sql.includes('SHOW CREATE PROCEDURE') && sql.includes('BuildDBHChangePairs'))
          return [[{ 'Create Procedure': 'CREATE PROCEDURE BuildDBHChangePairs() BEGIN SELECT 999; END' }], []] as never;
        return connection.query(sql, params);
      },
      beginTransaction: () => connection.beginTransaction(),
      commit: () => connection.commit(),
      rollback: () => connection.rollback()
    } as unknown as Connection;

    await expect(refreshDbhRuleSeeds(proxy, [schema], manifest, true)).rejects.toThrow(/differs/);
    const rows = await validationRows();
    expect(rows[0].Description).toBe('legacy-1');
    expect(rows[1].Definition).toBe('CALL legacy_2();');
  });
});
