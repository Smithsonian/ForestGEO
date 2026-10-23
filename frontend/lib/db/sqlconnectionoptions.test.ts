import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildSqlConnectionOptions } from './sqlconnectionoptions';

// mysql2 accepts these on a single connection without a warning (connection_config.js:63-69), so only this test
// stops one leaking from the pool into the probe (Pool.d.ts:12-39).
const POOL_ONLY_OPTION_NAMES = ['waitForConnections', 'connectionLimit', 'maxIdle', 'idleTimeout', 'queueLimit'] as const;
const REMOTE_HOST = 'forestgeo-db.example.test';
const LOCAL_HOSTS = ['127.0.0.1', 'localhost'] as const;

describe('buildSqlConnectionOptions', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('carries no pool-only settings', () => {
    const options = buildSqlConnectionOptions() as Record<string, unknown>;
    const leaked = POOL_ONLY_OPTION_NAMES.filter(name => name in options);
    console.log(`[sql connection options] keys=${JSON.stringify(Object.keys(options))} leakedPoolKeys=${JSON.stringify(leaked)}`);
    expect(leaked).toEqual([]);
  });

  it('sets ssl for a remote host', () => {
    vi.stubEnv('AZURE_SQL_SERVER', REMOTE_HOST);
    const options = buildSqlConnectionOptions();
    console.log(`[sql connection options] host=${options.host} ssl=${JSON.stringify(options.ssl)}`);
    expect(options.host).toBe(REMOTE_HOST);
    expect(options.ssl).toEqual({ rejectUnauthorized: false });
  });

  it.each(LOCAL_HOSTS)('omits ssl for %s', localHost => {
    vi.stubEnv('AZURE_SQL_SERVER', localHost);
    const options = buildSqlConnectionOptions();
    console.log(`[sql connection options] host=${options.host} hasSsl=${'ssl' in options}`);
    expect('ssl' in options).toBe(false);
  });
});
