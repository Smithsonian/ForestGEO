import { EventEmitter } from 'node:events';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createConnection, type Connection } from 'mysql2';
import { GET } from './route';
import { HEALTH_DB_PROBE_TIMEOUT_MESSAGE, HEALTH_DB_UNREACHABLE_MESSAGE } from './constants';
import { HEALTH_DB_PROBE_TIMEOUT_MS, resetDatabaseConnectivityCacheForTests } from '@/lib/db/connectivityprobe';
import { HTTPResponses } from '@/config/macros';

const BUILD_FIXTURE = vi.hoisted(() => ({
  buildId: 'test-build-id',
  // The route passes with 10 or more server chunks.
  serverChunkFiles: Array.from({ length: 10 }, (_, index) => `chunk-${index}.js`)
}));

// Present a complete build so the route's build checks pass. Without it every case is 503.
vi.mock('fs', async importOriginal => {
  const actual = await importOriginal<typeof import('fs')>();
  const completeBuildFs = {
    ...actual,
    existsSync: () => true,
    readFileSync: ((filePath: string, ...rest: unknown[]) =>
      String(filePath).endsWith('BUILD_ID')
        ? BUILD_FIXTURE.buildId
        : (actual.readFileSync as (...args: unknown[]) => unknown)(filePath, ...rest)) as typeof actual.readFileSync,
    readdirSync: ((dirPath: string, ...rest: unknown[]) =>
      String(dirPath).endsWith(path.join('server', 'chunks'))
        ? BUILD_FIXTURE.serverChunkFiles
        : (actual.readdirSync as (...args: unknown[]) => unknown)(dirPath, ...rest)) as typeof actual.readdirSync
  };
  return { ...completeBuildFs, default: completeBuildFs };
});
vi.mock('mysql2', () => ({ createConnection: vi.fn() }));

const DEEP_HEALTH_URL = 'http://localhost/api/health?deep=true';
const SHALLOW_HEALTH_URL = 'http://localhost/api/health';
const FAKE_HOST_TEXT = 'db.fake-host.example';

class FakeProbeConnection extends EventEmitter {
  readonly query = vi.fn<(sql: string, callback: (error: Error | null) => void) => void>();
  readonly end = vi.fn();
  readonly stream = { destroy: vi.fn() };
}

function useFakeConnection(): FakeProbeConnection {
  const fake = new FakeProbeConnection();
  vi.mocked(createConnection).mockImplementationOnce(() => fake as unknown as Connection);
  return fake;
}

interface HealthBody {
  status: string;
  checks: { name: string; status: string; message: string }[];
}

async function readHealth(responsePromise: Promise<Response>): Promise<{ status: number; body: HealthBody; raw: string }> {
  const response = await responsePromise;
  const raw = await response.text();
  return { status: response.status, body: JSON.parse(raw) as HealthBody, raw };
}

describe('GET /api/health — deep database probe (#524 item 11)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetDatabaseConnectivityCacheForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('deep with a healthy connection: 200 and database_connectivity pass, with no database_config check', async () => {
    const fake = useFakeConnection();
    const responsePromise = GET(new Request(DEEP_HEALTH_URL));
    await vi.advanceTimersByTimeAsync(0);
    fake.emit('connect');
    await vi.advanceTimersByTimeAsync(0);
    fake.query.mock.calls[0][1](null);

    const { status, body } = await readHealth(responsePromise);
    console.log(`[health deep pass] http=${status} checks=${JSON.stringify(body.checks)}`);
    expect(status).toBe(HTTPResponses.OK);
    expect(body.checks.find(check => check.name === 'database_connectivity')).toMatchObject({ status: 'pass' });
    expect(body.checks.some(check => check.name === 'database_config')).toBe(false);
  });

  it('deep with a query error naming a host: 503 with the generic message and no host text anywhere', async () => {
    const fake = useFakeConnection();
    const responsePromise = GET(new Request(DEEP_HEALTH_URL));
    await vi.advanceTimersByTimeAsync(0);
    fake.emit('connect');
    await vi.advanceTimersByTimeAsync(0);
    fake.query.mock.calls[0][1](new Error(`Access denied for ${FAKE_HOST_TEXT}`));

    const { status, body, raw } = await readHealth(responsePromise);
    console.log(`[health deep unreachable] http=${status} checks=${JSON.stringify(body.checks)}`);
    expect(status).toBe(HTTPResponses.SERVICE_UNAVAILABLE);
    expect(body.checks.find(check => check.name === 'database_connectivity')).toMatchObject({ status: 'fail', message: HEALTH_DB_UNREACHABLE_MESSAGE });
    expect(raw).not.toContain(FAKE_HOST_TEXT);
  });

  it('deep with a connect that never completes: 503 with the timeout message once the deadline passes', async () => {
    useFakeConnection();
    const responsePromise = GET(new Request(DEEP_HEALTH_URL));
    await vi.advanceTimersByTimeAsync(HEALTH_DB_PROBE_TIMEOUT_MS);

    const { status, body } = await readHealth(responsePromise);
    console.log(`[health deep timeout] http=${status} checks=${JSON.stringify(body.checks)}`);
    expect(status).toBe(HTTPResponses.SERVICE_UNAVAILABLE);
    expect(body.checks.find(check => check.name === 'database_connectivity')).toMatchObject({ status: 'fail', message: HEALTH_DB_PROBE_TIMEOUT_MESSAGE });
  });

  it('non-deep: never opens a database connection', async () => {
    const { status, body } = await readHealth(GET(new Request(SHALLOW_HEALTH_URL)));
    console.log(
      `[health shallow] http=${status} createConnection calls=${vi.mocked(createConnection).mock.calls.length} checks=${JSON.stringify(body.checks.map(check => check.name))}`
    );
    expect(vi.mocked(createConnection)).not.toHaveBeenCalled();
    expect(body.checks.some(check => check.name === 'database_connectivity')).toBe(false);
  });
});
