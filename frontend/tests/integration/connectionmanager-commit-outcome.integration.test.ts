import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import ConnectionManager, { TransactionCommitCleanupError, TransactionCommitOutcomeUnknownError } from '@/lib/db/connectionmanager';
import { setupTestDatabase, teardownTestDatabase, DEFAULT_TEST_CONFIG, type TestDatabaseConfig } from '../setup/local-db-setup';
import type { Connection } from 'mysql2/promise';

const LOCAL_HOSTS = ['127.0.0.1', 'localhost'] as const;
const tableName = `tx_commit_fault_${process.pid}`;
let setupConnection: Connection | null = null;
let config: TestDatabaseConfig;
const manager = ConnectionManager.getInstance();
const qualifiedTable = () => `\`${config.database}\`.\`${tableName}\``;

type ManagerInternals = {
  transactionConnections: Map<string, { commit: () => Promise<void> }>;
  cleanupApplicationLocks: (transactionId: string) => Promise<void>;
};
const internals = manager as unknown as ManagerInternals;

beforeAll(async () => {
  const host = process.env.AZURE_SQL_SERVER;
  if (!host || !LOCAL_HOSTS.includes(host as (typeof LOCAL_HOSTS)[number])) {
    throw new Error(`REFUSING TO RUN: ConnectionManager host is '${host}', not local.`);
  }
  const setup = await setupTestDatabase(DEFAULT_TEST_CONFIG);
  setupConnection = setup.connection;
  config = setup.config;
  await setupConnection.query(`CREATE TABLE ${qualifiedTable()} (id INT PRIMARY KEY)`);
}, 90000);

afterAll(async () => {
  await setupConnection?.query(`DROP TABLE IF EXISTS ${qualifiedTable()}`);
  await manager.closeConnection();
  await teardownTestDatabase(setupConnection, config);
});

async function durableRowCount(id: number): Promise<number> {
  const [rows] = await setupConnection!.query(`SELECT COUNT(*) AS count FROM ${qualifiedTable()} WHERE id = ?`, [id]);
  return Number((rows as Array<{ count: number }>)[0]?.count ?? 0);
}

describe('ConnectionManager commit outcome fault injection', () => {
  it('detects a lost acknowledgement after the server durably committed', async () => {
    const events: Array<{ type: string; commitDurationMs?: number; cleanupDurationMs?: number }> = [];
    const error = await manager
      .withTransaction(
        async tx => {
          await tx.query(`INSERT INTO ${qualifiedTable()} (id) VALUES (1)`);
          const connection = internals.transactionConnections.get(tx.id)!;
          const actualCommit = connection.commit.bind(connection);
          connection.commit = async () => {
            await actualCommit();
            throw new Error('fault injection: acknowledgement lost after durable commit');
          };
        },
        { lifecycleObserver: event => events.push(event) }
      )
      .catch(value => value);

    expect(error).toBeInstanceOf(TransactionCommitOutcomeUnknownError);
    expect(error.code).toBe('TRANSACTION_COMMIT_OUTCOME_UNKNOWN');
    expect(error.cause.message).toContain('acknowledgement lost');
    expect(await durableRowCount(1)).toBe(1);
    expect(events.some(event => event.type === 'commit_outcome_unknown' && typeof event.commitDurationMs === 'number')).toBe(true);
    expect(events.some(event => event.type === 'cleanup_finished' && typeof event.cleanupDurationMs === 'number')).toBe(true);
    expect(events.at(-1)?.cleanupDurationMs).toEqual(expect.any(Number));
  });

  it('discards after a pre-ack commit transport fault and leaves the transaction uncommitted', async () => {
    const error = await manager
      .withTransaction(async tx => {
        await tx.query(`INSERT INTO ${qualifiedTable()} (id) VALUES (2)`);
        internals.transactionConnections.get(tx.id)!.commit = async () => {
          throw new Error('fault injection: transport failed before commit acknowledgement');
        };
      })
      .catch(value => value);

    expect(error).toBeInstanceOf(TransactionCommitOutcomeUnknownError);
    expect(await durableRowCount(2)).toBe(0);
  });

  it('keeps delayed acknowledgement timing separate from callback timing', async () => {
    const events: Array<{ type: string; callbackDurationMs?: number; commitDurationMs?: number; totalDurationMs?: number }> = [];
    await manager.withTransaction(
      async tx => {
        await tx.query(`INSERT INTO ${qualifiedTable()} (id) VALUES (3)`);
        const connection = internals.transactionConnections.get(tx.id)!;
        const actualCommit = connection.commit.bind(connection);
        connection.commit = async () => {
          await new Promise(resolve => setTimeout(resolve, 150));
          await actualCommit();
        };
      },
      { lifecycleObserver: event => events.push(event) }
    );
    const acknowledged = events.find(event => event.type === 'commit_acknowledged');
    const finished = events.find(event => event.type === 'transaction_finished');
    expect(acknowledged?.commitDurationMs).toBeGreaterThanOrEqual(140);
    expect(acknowledged?.callbackDurationMs).toBeLessThan(140);
    expect(finished?.totalDurationMs).toBeGreaterThanOrEqual(acknowledged!.commitDurationMs!);
    expect(await durableRowCount(3)).toBe(1);
  });

  it('reports cleanup failure after an acknowledged durable commit', async () => {
    const cleanupSpy = vi.spyOn(internals, 'cleanupApplicationLocks').mockRejectedValueOnce(new Error('fault injection: cleanup failed'));
    try {
      const error = await manager
        .withTransaction(async tx => {
          await tx.query(`INSERT INTO ${qualifiedTable()} (id) VALUES (4)`);
        })
        .catch(value => value);
      expect(error).toBeInstanceOf(TransactionCommitCleanupError);
      expect(error.committed).toBe(true);
      expect(await durableRowCount(4)).toBe(1);
    } finally {
      cleanupSpy.mockRestore();
    }
  });
});
