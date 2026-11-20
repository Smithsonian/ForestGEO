import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Connection } from 'mysql2/promise';
import { createBenchmarkDatabase, createBenchmarkSchemaSession, killDropAndClose } from './benchmarkharness';

const mocks = vi.hoisted(() => ({ createConnection: vi.fn() }));
vi.mock('mysql2/promise', () => ({ default: { createConnection: mocks.createConnection } }));

afterEach(() => vi.unstubAllEnvs());

describe('benchmark schema setup cleanup', () => {
  it('retains the setup connection when changeUser fails and drops the owned schema before releasing the lock', async () => {
    vi.stubEnv('AZURE_SQL_SERVER', '127.0.0.1');
    const events: string[] = [];
    const failure = new Error('changeUser failed');
    const setup = {
      query: vi.fn(async (sql: string, params: unknown[]) => {
        events.push(`${sql} ${params[0]}`);
      }),
      changeUser: vi.fn(async () => {
        events.push('changeUser');
        throw failure;
      }),
      destroy: vi.fn(() => {
        events.push('setup destroy');
      })
    };
    const owner = {
      query: vi.fn(async (sql: string, params: unknown[]) => {
        events.push(`${sql} ${params[0]}`);
      }),
      destroy: vi.fn(() => {
        events.push('owner destroy');
      })
    };
    const session = createBenchmarkSchemaSession({ schema: 'forestgeo_bench_test', lockName: 'test_lock', logPrefix: '[test]' });
    session.schemaOwnerConnection = owner as unknown as Connection;
    mocks.createConnection.mockResolvedValue(setup);
    console.log('setup input', session.schema, 'changeUser failure', failure.message);
    await expect(createBenchmarkDatabase(session)).rejects.toBe(failure);
    expect(session.setupConnection).toBe(setup);
    await killDropAndClose(session);
    expect(events).toEqual([
      'DROP DATABASE IF EXISTS ?? forestgeo_bench_test',
      'CREATE DATABASE ?? CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci forestgeo_bench_test',
      'changeUser',
      'DROP DATABASE IF EXISTS ?? forestgeo_bench_test',
      'setup destroy',
      'SELECT RELEASE_LOCK(?) test_lock',
      'owner destroy'
    ]);
  });

  it('surfaces a cleanup drop failure and still closes extra resources and releases the lock', async () => {
    const events: string[] = [];
    const dropFailure = new Error('drop failed');
    const closeFailure = new Error('close failed');
    const setup = {
      query: vi.fn(async () => {
        events.push('drop');
        throw dropFailure;
      }),
      destroy: vi.fn(() => {
        events.push('setup destroy');
      })
    };
    const owner = {
      query: vi.fn(async () => {
        events.push('release');
      }),
      destroy: vi.fn(() => {
        events.push('owner destroy');
      })
    };
    const session = createBenchmarkSchemaSession({ schema: 'forestgeo_bench_test', lockName: 'test_lock', logPrefix: '[test]' });
    session.setupConnection = setup as unknown as Connection;
    session.schemaOwnerConnection = owner as unknown as Connection;
    let caught: unknown;
    try {
      await killDropAndClose(session, async () => {
        events.push('close extra');
        throw closeFailure;
      });
    } catch (error: unknown) {
      caught = error;
    }
    console.log('cleanup input failures', dropFailure.message, closeFailure.message, 'events', events);
    expect(caught).toBeInstanceOf(AggregateError);
    expect((caught as AggregateError).errors).toEqual([dropFailure, closeFailure]);
    expect(events).toEqual(['drop', 'setup destroy', 'close extra', 'release', 'owner destroy']);
  });
});
