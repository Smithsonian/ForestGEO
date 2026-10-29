import { describe, expect, it, vi } from 'vitest';
import type ConnectionManager from '@/lib/db/connectionmanager';
import { ACTIVE_UPLOAD_SESSION_STATES } from '@/config/uploadsessiontracker';
import { deleteOrphanedTemporaryMeasurements, findOrphanedTemporaryMeasurements } from './orphaned-staging-cleanup';

vi.mock('@/ailogger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const SCHEMA = 'forestgeo_testing';
const OWNERSHIP_PREDICATE =
  /NOT EXISTS\s*\(\s*SELECT 1 FROM\s+\S+\.upload_sessions us\s+WHERE us\.state IN \(\?(, \?)*\)\s+AND \(us\.session_id = tm\.SessionID OR us\.file_id = tm\.FileID\)\s*\)/;

const DELETE_TRANSACTION_ID = 'orphan-delete-tx';

function recorder(answer: unknown) {
  const calls: Array<{ sql: string; params: unknown[]; transactionID?: string }> = [];
  const executeQuery = vi.fn(async (sql: string, params: unknown[] = [], transactionID?: string) => (calls.push({ sql, params, transactionID }), answer));
  const withTransaction = vi.fn(async <T>(fn: (tx: { id: string }) => Promise<T>) => fn({ id: DELETE_TRANSACTION_ID }));
  const manager = { executeQuery, withTransaction } as unknown as ConnectionManager;
  return { manager, calls, withTransaction };
}

describe('orphaned staged-row ownership (#561 N2, AU14)', () => {
  it('the finder applies the session-or-file ownership rule with the active states bound as parameters', async () => {
    const { manager, calls } = recorder([{ fileId: 'old.csv', rowCount: 3 }]);
    const found = await findOrphanedTemporaryMeasurements(manager, SCHEMA);
    console.log(`[AU14] finder: ${calls[0].sql.replace(/\s+/g, ' ')} ${JSON.stringify(calls[0].params)}`);
    expect(found).toEqual([{ fileId: 'old.csv', rowCount: 3 }]);
    expect(calls[0].sql.replace(/\s+/g, ' ')).toMatch(OWNERSHIP_PREDICATE);
    expect(calls[0].params).toEqual([...ACTIVE_UPLOAD_SESSION_STATES]);
  });

  it('the DELETE carries the ownership rule itself, so a row that gains an owner after the listing survives (catches: a finder-only fix)', async () => {
    const { manager, calls } = recorder({ affectedRows: 2 });
    const deleted = await deleteOrphanedTemporaryMeasurements(manager, SCHEMA, ['old.csv', 'older.csv']);
    console.log(`[AU14] delete: ${calls[0].sql.replace(/\s+/g, ' ')} ${JSON.stringify(calls[0].params)}`);
    expect(deleted).toBe(2);
    expect(calls[0].sql.replace(/\s+/g, ' ')).toMatch(/^DELETE tm FROM\s+\S+\.temporarymeasurements tm WHERE tm\.FileID IN \(\?, \?\) AND /);
    expect(calls[0].sql.replace(/\s+/g, ' ')).toMatch(OWNERSHIP_PREDICATE);
    expect(calls[0].params).toEqual(['old.csv', 'older.csv', ...ACTIVE_UPLOAD_SESSION_STATES]);
    expect(calls[0].transactionID, 'the DELETE runs in its own READ COMMITTED transaction (P23)').toBe(DELETE_TRANSACTION_ID);
  });

  it('deletes nothing and issues no statement for an empty file list', async () => {
    const { manager, calls } = recorder({ affectedRows: 0 });
    expect(await deleteOrphanedTemporaryMeasurements(manager, SCHEMA, [])).toBe(0);
    expect(calls).toHaveLength(0);
  });
});
