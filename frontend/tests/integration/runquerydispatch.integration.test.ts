import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import mysql, { type Connection } from 'mysql2/promise';
import { DEFAULT_TEST_CONFIG } from '../setup/local-db-setup';
import { runQueryDispatch } from '../setup/runquerydispatch';

const LOCAL_HOSTS = ['127.0.0.1', 'localhost'] as const;
const LIMIT_PROBE = 'SELECT n FROM (SELECT 1 AS n UNION ALL SELECT 2 UNION ALL SELECT 3) AS numbers ORDER BY n LIMIT ?';
const MYSQL_WRONG_ARGUMENTS = 'ER_WRONG_ARGUMENTS';
const PROBE_LIMIT = 2;

describe('runQueryDispatch MySQL protocol', () => {
  let connection: Connection;

  beforeAll(async () => {
    const { host, port, user, password } = DEFAULT_TEST_CONFIG;
    if (!host || !LOCAL_HOSTS.includes(host as (typeof LOCAL_HOSTS)[number])) {
      throw new Error(`REFUSING TO RUN: MySQL host is '${host}', not local. Aborting to avoid connecting to a real database.`);
    }
    connection = await mysql.createConnection({ host, port, user, password });
  });

  afterAll(async () => {
    await connection?.end();
  });

  it('rejects a numeric LIMIT parameter under execute(), as production would (F5)', async () => {
    const outcome = await runQueryDispatch(connection, LIMIT_PROBE, [PROBE_LIMIT]).then(
      rows => ({ rows }),
      (error: { code?: string }) => ({ code: error.code })
    );
    console.log('[F5 pin] numeric LIMIT', JSON.stringify(outcome));
    expect(outcome).toEqual({ code: MYSQL_WRONG_ARGUMENTS });
  });

  it('returns rows for a decimal-string LIMIT parameter under execute() (F5)', async () => {
    const rows = await runQueryDispatch(connection, LIMIT_PROBE, [String(PROBE_LIMIT)]);
    console.log('[F5 pin] string LIMIT', JSON.stringify(rows));
    expect(rows).toEqual([{ n: 1 }, { n: 2 }]);
  });
});
