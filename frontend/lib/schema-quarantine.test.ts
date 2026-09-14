import { beforeEach, describe, expect, it, vi } from 'vitest';

// The global unit setup (tests/mocks/db-mocks.ts) mocks this module so route
// suites never hit the catalog. This file tests the real thing.
vi.unmock('@/lib/schema-quarantine');

import ailogger from '@/ailogger';
import {
  SCHEMA_GATE_UNAVAILABLE_CODE,
  SCHEMA_QUARANTINED_CODE,
  SCHEMA_QUARANTINE_CACHE_TTL_MS,
  findSchemaQuarantine,
  invalidateSchemaQuarantineCache,
  schemaGateUnavailableResponse,
  schemaQuarantinedResponse,
  type QuarantineRecord
} from '@/lib/schema-quarantine';

const STATUS_SERVICE_UNAVAILABLE = 503;
const ER_NO_SUCH_TABLE = 1146;
const ER_LOCK_WAIT_TIMEOUT = 1205;

function record(overrides: Partial<QuarantineRecord> = {}): QuarantineRecord {
  return {
    schemaName: 'forestgeo_new',
    quarantinedAt: new Date('2026-09-02T18:04:11Z'),
    reason: 'DRIFT [stems] column "PublishedStemID" missing',
    runRef: 'run-url',
    ...overrides
  };
}

function mysqlError(errno: number): Error {
  const error = new Error(`mysql ${errno}`) as Error & { errno: number };
  error.errno = errno;
  return error;
}

describe('schema-quarantine', () => {
  beforeEach(() => {
    invalidateSchemaQuarantineCache();
    vi.clearAllMocks();
  });

  it('matches schema names case-insensitively', async () => {
    const reader = vi.fn(async () => [record()]);

    const found = await findSchemaQuarantine('FORESTGEO_NEW', reader);
    console.log(`[quarantine lookup] found=${JSON.stringify(found)}`);

    expect(found?.schemaName).toBe('forestgeo_new');
    expect(await findSchemaQuarantine('forestgeo_serc', reader)).toBeNull();
  });

  it('caches for the TTL and re-reads after invalidation', async () => {
    const reader = vi.fn(async () => [record()]);
    const start = 1_000_000;

    await findSchemaQuarantine('forestgeo_new', reader, start);
    await findSchemaQuarantine('forestgeo_new', reader, start + SCHEMA_QUARANTINE_CACHE_TTL_MS - 1);
    expect(reader).toHaveBeenCalledTimes(1);

    await findSchemaQuarantine('forestgeo_new', reader, start + SCHEMA_QUARANTINE_CACHE_TTL_MS + 1);
    expect(reader).toHaveBeenCalledTimes(2);

    invalidateSchemaQuarantineCache();
    await findSchemaQuarantine('forestgeo_new', reader, start + SCHEMA_QUARANTINE_CACHE_TTL_MS + 2);
    expect(reader).toHaveBeenCalledTimes(3);
  });

  it('treats a missing gate table as "nothing quarantined" and warns once', async () => {
    const reader = vi.fn(async () => {
      throw mysqlError(ER_NO_SUCH_TABLE);
    });

    expect(await findSchemaQuarantine('forestgeo_new', reader)).toBeNull();
    invalidateSchemaQuarantineCache();
    expect(await findSchemaQuarantine('forestgeo_new', reader)).toBeNull();

    console.log(`[quarantine missing-table] reads=${reader.mock.calls.length} warns=${vi.mocked(ailogger.warn).mock.calls.length}`);
    expect(reader).toHaveBeenCalledTimes(2);
    // The warn flag is process-lifetime on purpose: invalidating the cache must
    // not re-arm a log line that would then repeat on every request.
    expect(vi.mocked(ailogger.warn)).toHaveBeenCalledTimes(1);
  });

  it('propagates every other reader error', async () => {
    const reader = vi.fn(async () => {
      throw mysqlError(ER_LOCK_WAIT_TIMEOUT);
    });

    await expect(findSchemaQuarantine('forestgeo_new', reader)).rejects.toThrow(/1205/);
  });

  it('does not cache a propagated failure, so the next request retries the gate', async () => {
    const failing = vi.fn(async (): Promise<QuarantineRecord[]> => {
      throw mysqlError(ER_LOCK_WAIT_TIMEOUT);
    });
    await expect(findSchemaQuarantine('forestgeo_new', failing)).rejects.toThrow(/1205/);

    const recovered = vi.fn(async () => [record()]);
    expect((await findSchemaQuarantine('forestgeo_new', recovered))?.schemaName).toBe('forestgeo_new');
    expect(recovered).toHaveBeenCalledTimes(1);
  });

  it('builds the 503 responses with their codes', async () => {
    const quarantined = schemaQuarantinedResponse(record());
    expect(quarantined.status).toBe(STATUS_SERVICE_UNAVAILABLE);

    const body = await quarantined.json();
    console.log(`[quarantined body] ${JSON.stringify(body)}`);
    expect(body).toMatchObject({
      code: SCHEMA_QUARANTINED_CODE,
      schema: 'forestgeo_new',
      quarantinedAt: '2026-09-02T18:04:11.000Z',
      runRef: 'run-url'
    });
    expect(body.error).toMatch(/quarantined/);
    expect(body.error).toMatch(/released automatically/);

    const unavailable = schemaGateUnavailableResponse(new Error('boom'));
    expect(unavailable.status).toBe(STATUS_SERVICE_UNAVAILABLE);
    expect(await unavailable.json()).toMatchObject({ code: SCHEMA_GATE_UNAVAILABLE_CODE });
  });
});
