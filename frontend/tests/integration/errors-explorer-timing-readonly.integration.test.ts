import mysql, { type Connection } from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prepareReadOnlySession } from '@/scripts/errors-explorer-timing';
import { AZURE_HOST, LOCAL_HOSTS } from '@/scripts/lib/schema-cli';
import { DEFAULT_TEST_CONFIG } from '@/tests/setup/local-db-setup';
import { cleanupTimingConnections, createTestDatabaseStrict } from '@/tests/setup/stricttestdatabasecleanup';

const TIMING_RO_DATABASE = `${DEFAULT_TEST_CONFIG.database}_timing_ro`;
const READ_ONLY_ERRNO = 1792;
const MAX_STATEMENT_MS = 60_000;
let setupConnection: Connection | null = null;
let readOnlyConnection: Connection | null = null;

function assertLocalWriteProbeHost(host: string): void {
  if (!(LOCAL_HOSTS as readonly string[]).includes(host)) throw new Error('REFUSING TO RUN: write probes require a local host');
}

describe('timing read-only session', () => {
  beforeAll(async () => {
    assertLocalWriteProbeHost(DEFAULT_TEST_CONFIG.host);
    try {
      setupConnection = await createTestDatabaseStrict({ ...DEFAULT_TEST_CONFIG, database: TIMING_RO_DATABASE });
      await setupConnection.query('CREATE TABLE probe (a INT)');
      readOnlyConnection = await mysql.createConnection({
        host: DEFAULT_TEST_CONFIG.host,
        port: DEFAULT_TEST_CONFIG.port,
        user: DEFAULT_TEST_CONFIG.user,
        password: DEFAULT_TEST_CONFIG.password,
        database: TIMING_RO_DATABASE,
        multipleStatements: false,
        timezone: 'Z',
        charset: 'utf8mb4_0900_ai_ci'
      });
      await prepareReadOnlySession(readOnlyConnection, MAX_STATEMENT_MS);
    } catch (error) {
      const ro = readOnlyConnection;
      const writable = setupConnection;
      readOnlyConnection = null;
      setupConnection = null;
      await cleanupTimingConnections(ro, writable, TIMING_RO_DATABASE, error);
    }
  });
  afterAll(async () => {
    await cleanupTimingConnections(readOnlyConnection, setupConnection, TIMING_RO_DATABASE);
    readOnlyConnection = null;
    setupConnection = null;
  });
  it('refuses a remote probe before connecting', () => {
    expect(() => assertLocalWriteProbeHost(AZURE_HOST)).toThrow('REFUSING TO RUN');
  });
  it('rejects an INSERT with errno 1792', async () => {
    await expect(readOnlyConnection!.query('INSERT INTO probe VALUES (1)')).rejects.toMatchObject({ errno: READ_ONLY_ERRNO });
  });
  it('rejects DDL with errno 1792', async () => {
    await expect(readOnlyConnection!.query('CREATE TABLE probe2 (a INT)')).rejects.toMatchObject({ errno: READ_ONLY_ERRNO });
  });
});
