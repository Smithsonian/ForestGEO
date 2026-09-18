import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { setupTestDatabase, teardownTestDatabase } from '../setup/local-db-setup';
import { splitSqlFile } from '@/lib/provisioning/sql-runner';
import { SCHEMA_MIGRATION_MANIFEST } from '@/db/migrations/manifest';

const migration = SCHEMA_MIGRATION_MANIFEST.find(entry => entry.id === '2026-09-18-01-separate-validation-run-messages')!;
const statements = splitSqlFile(readFileSync(`db/migrations/${migration.file}`, 'utf8'));

describe('validation run message storage migration', () => {
  let connection: Connection;
  let config: { database: string };
  beforeAll(async () => {
    ({ connection, config } = await setupTestDatabase());
  }, 120_000);
  afterAll(async () => teardownTestDatabase(connection, config));

  async function migrate() {
    for (const { sql } of statements) await connection.query(sql);
  }

  it('upgrades an old table, preserves historical evidence, and tolerates reruns and a partial DDL attempt', async () => {
    await connection.query('ALTER TABLE validation_runs DROP COLUMN Notices, DROP COLUMN RescoreAttemptID');
    const historical = ['dbh-rescore-attempt:old-attempt', 'Historical notice'];
    await connection.query("INSERT INTO validation_runs (PlotID, CensusID, Status, ErrorMessages) VALUES (1, 1, 'completed', ?)", [JSON.stringify(historical)]);
    await migrate();
    await migrate();
    const [rows] = await connection.query<RowDataPacket[]>('SELECT ErrorMessages, Notices, RescoreAttemptID FROM validation_runs');
    expect(rows).toEqual([{ ErrorMessages: historical, Notices: null, RescoreAttemptID: null }]);
    await connection.query('ALTER TABLE validation_runs DROP COLUMN RescoreAttemptID');
    await migrate();
    await connection.query("UPDATE validation_runs SET Notices=JSON_ARRAY('Below floor'), ErrorMessages=JSON_ARRAY(), RescoreAttemptID='new-attempt'");
    await migrate();
    const [updated] = await connection.query<RowDataPacket[]>('SELECT ErrorMessages, Notices, RescoreAttemptID FROM validation_runs');
    expect(updated).toEqual([{ ErrorMessages: [], Notices: ['Below floor'], RescoreAttemptID: 'new-attempt' }]);
  });
});
