/**
 * Server-level mysql2 options every test pool and connection must share.
 *
 * `timezone: 'Z'` mirrors lib/db/poolmonitorsingleton.ts. Without it mysql2
 * binds JS Dates and decodes DATETIME/TIMESTAMP columns in the runtime's local
 * zone: on a +02:00 machine NOW() reads back two hours old, an upload session
 * looks stale the moment it is created, and a retry scheduled 60 s out lands
 * two hours in the future. A test pool that omits this option tests a
 * different database contract than the one production runs.
 */

export const TEST_DB_DRIVER_TIMEZONE = 'Z';

export interface TestDbServerOptions {
  host: string;
  port: number;
  user: string;
  password: string;
  timezone: typeof TEST_DB_DRIVER_TIMEZONE;
}

export function testDbServerOptions(): TestDbServerOptions {
  return {
    host: process.env.TEST_DB_HOST || 'localhost',
    port: Number(process.env.TEST_DB_PORT || 3306),
    user: process.env.TEST_DB_USER || 'root',
    password: process.env.TEST_DB_PASSWORD || 'testpassword',
    timezone: TEST_DB_DRIVER_TIMEZONE
  };
}
