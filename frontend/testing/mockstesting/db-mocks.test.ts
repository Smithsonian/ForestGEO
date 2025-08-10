// testing/mockstesting/db-mocks.spec.ts
import { beforeEach, describe, expect, it } from 'vitest';

// 1) Turn on the mocks from your file under test
import '@/testing/db-mocks';

// 2) Bring in the public test helpers from the mock module
import { __clearDbQueues, __pushExecuteError, __pushExecuteResult, __pushQueryError, __pushQueryResult } from '@/testing/db-mocks';

type PoolConnection = {
  query: (sql: string, params?: any[]) => Promise<[any, any]>;
  execute: (sql: string, params?: any[]) => Promise<[any, any]>;
  on: (evt: string, cb: (...args: any[]) => void) => void;
  release: () => void;
  ping: () => Promise<void>;
};

describe('db-mocks wiring (PoolMonitor + mysql2 echo + queues)', () => {
  let getPoolMonitorInstance: () => any;
  let PoolMonitorClass: any;

  beforeEach(async () => {
    // ensure clean queues each test (also done inside the mock’s beforeEach)
    __clearDbQueues();

    // load mocked modules after mock import
    ({ getPoolMonitorInstance } = await import('@/config/poolmonitorsingleton'));
    ({ PoolMonitor: PoolMonitorClass } = await import('@/config/poolmonitor'));
  });

  it('returns a singleton PoolMonitor and provides a shared connection', async () => {
    const m1 = getPoolMonitorInstance();
    const m2 = getPoolMonitorInstance();
    expect(m1).toBe(m2);
    expect(m1).toBeInstanceOf(PoolMonitorClass);

    const conn1: PoolConnection = await m1.getConnection();
    const conn2: PoolConnection = await m2.getConnection();
    // same shared connection instance
    expect(conn1).toBe(conn2);
  });

  it('query FIFO: returns queued results, then default echo', async () => {
    // queue two results
    __pushQueryResult([{ id: 1 }]);
    __pushQueryResult([{ id: 2 }]);

    const monitor = getPoolMonitorInstance();
    const conn: PoolConnection = await monitor.getConnection();

    const [r1] = await conn.query('SELECT * FROM t WHERE id=?', [1]);
    const [r2] = await conn.query('SELECT * FROM t WHERE id=?', [2]);
    expect(r1).toEqual([{ id: 1 }]);
    expect(r2).toEqual([{ id: 2 }]);

    // no queue left: default echo shape
    const [r3] = await conn.query('SELECT * FROM t WHERE id=?', [3]);
    expect(r3).toMatchObject({ ok: true, sql: 'SELECT * FROM t WHERE id=?', params: [3] });
  });

  it('execute FIFO: returns queued results, then default echo', async () => {
    __pushExecuteResult({ rows: [{ name: 'ok' }] });

    const monitor = getPoolMonitorInstance();
    const conn: PoolConnection = await monitor.getConnection();

    const [r1] = await conn.execute('UPDATE t SET x=? WHERE id=?', [9, 1]);
    expect(r1).toEqual({ rows: [{ name: 'ok' }] });

    const [r2] = await conn.execute('UPDATE t SET x=? WHERE id=?', [8, 2]);
    expect(r2).toMatchObject({ ok: true, sql: 'UPDATE t SET x=? WHERE id=?', params: [8, 2] });
  });

  it('propagates queued errors for query/execute', async () => {
    __pushQueryError(new Error('query boom'));
    __pushExecuteError(new Error('execute boom'));

    const monitor = getPoolMonitorInstance();
    const conn: PoolConnection = await monitor.getConnection();

    await expect(conn.query('SELECT 1')).rejects.toThrow(/query boom/);
    await expect(conn.execute('SELECT 1')).rejects.toThrow(/execute boom/);
  });

  it('supports ping() and release() with release listeners', async () => {
    const monitor = getPoolMonitorInstance();
    const conn: PoolConnection = await monitor.getConnection();

    // ping should resolve normally
    await expect(conn.ping()).resolves.toBeUndefined();

    const released: boolean[] = [];
    conn.on('release', () => released.push(true));
    conn.release();
    expect(released).toEqual([true]);
  });

  it('PoolMonitor closeAllConnections / isPoolClosed toggles state', async () => {
    const monitor = getPoolMonitorInstance();
    expect(monitor.isPoolClosed()).toBe(false);
    await monitor.closeAllConnections();
    expect(monitor.isPoolClosed()).toBe(true);
  });

  it('mysql2/promise.createPool is mocked and delegates to shared connection', async () => {
    const mysql2 = await import('mysql2/promise');
    // @ts-expect-error mocked function
    const pool = mysql2.createPool();
    const [r1] = await pool.query('SELECT ? as v', [11]);
    expect(r1).toMatchObject({ ok: true, sql: 'SELECT ? as v', params: [11] });

    const [r2] = await pool.getConnection().then((c: any) => c.query('SELECT ? as v', [12]));
    expect(r2).toMatchObject({ ok: true, sql: 'SELECT ? as v', params: [12] });

    await expect(pool.end()).resolves.toBeUndefined();
    expect(typeof pool.on).toBe('function');
  });

  it('chalk + logger are mocked quietly', async () => {
    const chalk = await import('chalk');
    // @ts-expect-error our mock uses String passthroughs
    expect(chalk.default.red('x')).toBe('x');

    const logger = (await import('@/ailogger')).default as any;
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.error).toBe('function');
    // no output expected; just ensure they’re callable
    logger.info('hello');
    logger.error('world');
  });

  it('env defaults are present for DB configuration', () => {
    expect(process.env.AZURE_SQL_USER).toBeTruthy();
    expect(process.env.AZURE_SQL_PASSWORD).toBeTruthy();
    expect(process.env.AZURE_SQL_SERVER).toBeTruthy();
    expect(process.env.AZURE_SQL_PORT).toBeTruthy();
    expect(process.env.AZURE_SQL_CATALOG_SCHEMA).toBeTruthy();
  });
});
