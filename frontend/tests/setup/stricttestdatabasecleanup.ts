import mysql, { type Connection } from 'mysql2/promise';
import { safeEscapeId } from '@/lib/db/sqlsecurity';
import type { TestDatabaseConfig } from './local-db-setup';
import { TEST_DB_DRIVER_TIMEZONE, TEST_DB_NAME_PREFIX } from './test-db-connection';

const LOCAL_TEST_HOSTS: readonly string[] = ['127.0.0.1', 'localhost'];
const TEST_DATABASE_CHARSET = 'UTF8MB4_0900_AI_CI';

export async function teardownTestDatabaseStrict(connection: Pick<Connection, 'query' | 'end'>, database: string): Promise<void> {
  const failures: unknown[] = [];
  try {
    if (!database.startsWith(TEST_DB_NAME_PREFIX)) throw new Error('Strict cleanup requires an owned test database');
    await connection.query(`DROP DATABASE IF EXISTS ${safeEscapeId(database)}`);
  } catch (error) {
    failures.push(error);
  }
  try {
    await connection.end();
  } catch (error) {
    failures.push(error);
  }
  if (failures.length > 0) throw new AggregateError(failures, 'Local test database cleanup failed');
}

export async function cleanupTimingConnections(
  readOnly: Pick<Connection, 'end'> | null,
  writable: Pick<Connection, 'query' | 'end'> | null,
  database: string,
  primaryError: unknown = null
): Promise<void> {
  const failures: unknown[] = primaryError === null ? [] : [primaryError];
  try {
    await readOnly?.end();
  } catch (error) {
    failures.push(error);
  }
  try {
    if (writable) await teardownTestDatabaseStrict(writable, database);
  } catch (error) {
    failures.push(...(error instanceof AggregateError ? error.errors : [error]));
  }
  if (failures.length === 1 && primaryError !== null) throw primaryError;
  if (failures.length) throw new AggregateError(failures, 'Local timing cleanup failed');
}

export async function createTestDatabaseStrict(config: TestDatabaseConfig): Promise<Connection> {
  if (!LOCAL_TEST_HOSTS.includes(config.host)) throw new Error('Strict test setup requires a local host');
  if (!config.database.startsWith(TEST_DB_NAME_PREFIX) || !/^[A-Za-z0-9_]+$/.test(config.database)) {
    throw new Error('Strict test setup requires an owned test database');
  }
  const { database, ...serverOptions } = config;
  const connection = await mysql.createConnection({
    ...serverOptions,
    timezone: config.timezone ?? TEST_DB_DRIVER_TIMEZONE,
    charset: TEST_DATABASE_CHARSET
  });
  try {
    await connection.query(`DROP DATABASE IF EXISTS ${safeEscapeId(database)}`);
    await connection.query(`CREATE DATABASE ${safeEscapeId(database)} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
    await connection.changeUser({ database });
    return connection;
  } catch (primaryError) {
    try {
      await teardownTestDatabaseStrict(connection, database);
    } catch (cleanupError) {
      const cleanupErrors: unknown[] = cleanupError instanceof AggregateError ? cleanupError.errors : [cleanupError];
      throw new AggregateError([primaryError, ...cleanupErrors], 'Local test setup and cleanup failed');
    }
    throw primaryError;
  }
}
