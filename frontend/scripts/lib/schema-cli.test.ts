import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { assertExpectedHost, resolveConnectionSettings, UnexpectedHostError, AZURE_HOST, AZURE_USER, AZURE_PORT, LOCAL_HOSTS } from './schema-cli';

describe('assertExpectedHost', () => {
  it('throws when the host is missing', () => {
    expect(() => assertExpectedHost(undefined, [AZURE_HOST])).toThrow(UnexpectedHostError);
  });

  it('throws when the host is not in the allowed set', () => {
    expect(() => assertExpectedHost('evil.example.com', [AZURE_HOST])).toThrow(UnexpectedHostError);
    expect(() => assertExpectedHost('localhost', [AZURE_HOST])).toThrow(UnexpectedHostError);
  });

  it('passes for an allowed host', () => {
    expect(() => assertExpectedHost(AZURE_HOST, [AZURE_HOST])).not.toThrow();
    expect(() => assertExpectedHost('127.0.0.1', LOCAL_HOSTS)).not.toThrow();
  });
});

describe('resolveConnectionSettings', () => {
  const saved = {
    pwd: process.env.AZURE_SQL_PASSWORD,
    host: process.env.TEST_DB_HOST,
    user: process.env.TEST_DB_USER,
    tpwd: process.env.TEST_DB_PASSWORD,
    port: process.env.TEST_DB_PORT
  };

  beforeEach(() => {
    delete process.env.AZURE_SQL_PASSWORD;
    delete process.env.TEST_DB_HOST;
    delete process.env.TEST_DB_USER;
    delete process.env.TEST_DB_PASSWORD;
    delete process.env.TEST_DB_PORT;
  });

  afterEach(() => {
    process.env.AZURE_SQL_PASSWORD = saved.pwd;
    process.env.TEST_DB_HOST = saved.host;
    process.env.TEST_DB_USER = saved.user;
    process.env.TEST_DB_PASSWORD = saved.tpwd;
    process.env.TEST_DB_PORT = saved.port;
  });

  it('--all-sites resolves to the Azure host with an Azure-only allow-list', () => {
    process.env.AZURE_SQL_PASSWORD = 'secret';
    const settings = resolveConnectionSettings(true);
    expect(settings.host).toBe(AZURE_HOST);
    expect(settings.user).toBe(AZURE_USER);
    expect(settings.port).toBe(AZURE_PORT);
    expect(settings.password).toBe('secret');
    expect(settings.allowedHosts).toEqual([AZURE_HOST]);
    // The resolved host must clear its own allow-list.
    expect(() => assertExpectedHost(settings.host, settings.allowedHosts)).not.toThrow();
  });

  it('--all-sites requires AZURE_SQL_PASSWORD', () => {
    expect(() => resolveConnectionSettings(true)).toThrow(/AZURE_SQL_PASSWORD is required/);
  });

  it('single-schema defaults to a LOCAL-only host/allow-list (never production)', () => {
    const settings = resolveConnectionSettings(false);
    expect(settings.host).toBe('localhost');
    expect(settings.allowedHosts).toEqual(LOCAL_HOSTS);
    expect(settings.host).not.toBe(AZURE_HOST);
    // The Azure host must NOT clear the local allow-list.
    expect(() => assertExpectedHost(AZURE_HOST, settings.allowedHosts)).toThrow(UnexpectedHostError);
  });

  it('single-schema honors TEST_DB_* overrides', () => {
    process.env.TEST_DB_HOST = '127.0.0.1';
    process.env.TEST_DB_USER = 'tester';
    process.env.TEST_DB_PASSWORD = 'pw';
    process.env.TEST_DB_PORT = '3307';
    const settings = resolveConnectionSettings(false);
    expect(settings.host).toBe('127.0.0.1');
    expect(settings.user).toBe('tester');
    expect(settings.password).toBe('pw');
    expect(settings.port).toBe(3307);
  });
});
