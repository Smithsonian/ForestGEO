import { describe, expect, it, vi } from 'vitest';
import type ConnectionManager from '@/lib/db/connectionmanager';
import { auditHandleUpsertResult, auditCensusActivePersonnelLink } from './reference-audit';

const TEST_SCHEMA = 'forestgeo_harvard';
const TEST_TRANSACTION_ID = 'tx-under-test';
const TEST_CHANGED_BY = 'jess@si.edu';

type MockedCall = { sql: string; params: unknown[] };

function createMockConnectionManager(responses: unknown[]) {
  const calls: MockedCall[] = [];
  const executeQuery = vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    const response = responses[calls.length - 1];
    if (response === undefined) throw new Error(`No mocked response configured for call #${calls.length} (sql: ${sql})`);
    return response;
  });
  const connectionManager = { executeQuery } as unknown as ConnectionManager;
  return { connectionManager, executeQuery, calls };
}

/** The changelog INSERT's positional param list, matching lib/changelog/record-mutation.ts. */
const CHANGELOG_PARAM_ORDER = ['tableName', 'recordID', 'operation', 'oldRowState', 'newRowState', 'changedBy', 'plotID', 'censusID'] as const;

function decodeChangelogCall(call: MockedCall) {
  const row = Object.fromEntries(CHANGELOG_PARAM_ORDER.map((name, index) => [name, call.params[index]]));
  // eslint-disable-next-line no-console
  console.log('[reference-audit.test] decoded changelog call', { sql: call.sql, row });
  return row;
}

describe('auditHandleUpsertResult', () => {
  it('skips the audit entirely for an unchanged upsert result -- it is not a real mutation', async () => {
    const { connectionManager, executeQuery } = createMockConnectionManager([]);

    await auditHandleUpsertResult(connectionManager, TEST_SCHEMA, TEST_TRANSACTION_ID, 'roles', 'RoleID', { id: 1, operation: 'unchanged' }, TEST_CHANGED_BY);

    expect(executeQuery).not.toHaveBeenCalled();
  });

  it('throws when the row vanishes immediately after its own upsert, before attempting to audit it', async () => {
    const { connectionManager, executeQuery } = createMockConnectionManager([[]]);

    await expect(
      auditHandleUpsertResult(connectionManager, TEST_SCHEMA, TEST_TRANSACTION_ID, 'roles', 'RoleID', { id: 99, operation: 'inserted' }, TEST_CHANGED_BY)
    ).rejects.toThrow(/roles row 99 vanished immediately after its own upsert/);

    // Only the lookup SELECT ran -- no changelog write for a row that can't be read back.
    expect(executeQuery).toHaveBeenCalledTimes(1);
  });

  it('records an INSERT with the persisted row as NewRowState', async () => {
    const persistedRow = { RoleID: 1, RoleName: 'field crew' };
    const { connectionManager, calls } = createMockConnectionManager([[persistedRow], { affectedRows: 1 }]);

    await auditHandleUpsertResult(connectionManager, TEST_SCHEMA, TEST_TRANSACTION_ID, 'roles', 'RoleID', { id: 1, operation: 'inserted' }, TEST_CHANGED_BY);

    expect(calls).toHaveLength(2);
    const row = decodeChangelogCall(calls[1]);
    expect(row.operation).toBe('INSERT');
    expect(row.oldRowState).toBeNull();
    expect(row.newRowState).toBe(JSON.stringify(persistedRow));
    expect(row.recordID).toBe('1');
  });

  it('records an UPDATE with oldRowState null -- handleUpsert overwrote the row before anything could read its prior state', async () => {
    const persistedRow = { RoleID: 1, RoleName: 'revised field crew' };
    const { connectionManager, calls } = createMockConnectionManager([[persistedRow], { affectedRows: 1 }]);

    await auditHandleUpsertResult(connectionManager, TEST_SCHEMA, TEST_TRANSACTION_ID, 'roles', 'RoleID', { id: 1, operation: 'updated' }, TEST_CHANGED_BY);

    const row = decodeChangelogCall(calls[1]);
    expect(row.operation).toBe('UPDATE');
    expect(row.oldRowState).toBeNull();
    expect(row.newRowState).toBe(JSON.stringify(persistedRow));
  });
});

describe('auditCensusActivePersonnelLink', () => {
  const CENSUS_ID = 42;
  const PERSONNEL_ID = 7;

  it('does not audit a link that already existed -- INSERT IGNORE reporting affectedRows: 0 is not a mutation', async () => {
    const { connectionManager, executeQuery } = createMockConnectionManager([{ affectedRows: 0, insertId: 0 }]);

    await auditCensusActivePersonnelLink(connectionManager, TEST_SCHEMA, TEST_TRANSACTION_ID, CENSUS_ID, PERSONNEL_ID, TEST_CHANGED_BY);

    // Only the INSERT IGNORE ran -- no changelog write for a link that was already there.
    expect(executeQuery).toHaveBeenCalledTimes(1);
  });

  it('throws rather than audit a link whose own id is unknown, when affectedRows claims a row was created but insertId is missing', async () => {
    const { connectionManager, executeQuery } = createMockConnectionManager([{ affectedRows: 1, insertId: 0 }]);

    await expect(auditCensusActivePersonnelLink(connectionManager, TEST_SCHEMA, TEST_TRANSACTION_ID, CENSUS_ID, PERSONNEL_ID, TEST_CHANGED_BY)).rejects.toThrow(
      /returned no insertId; cannot audit a link whose own id is unknown/
    );

    // The malformed result must stop before any changelog write is attempted.
    expect(executeQuery).toHaveBeenCalledTimes(1);
  });

  it('throws the same way when insertId is entirely absent from the result, not just 0', async () => {
    const { connectionManager, executeQuery } = createMockConnectionManager([{ affectedRows: 1 }]);

    await expect(auditCensusActivePersonnelLink(connectionManager, TEST_SCHEMA, TEST_TRANSACTION_ID, CENSUS_ID, PERSONNEL_ID, TEST_CHANGED_BY)).rejects.toThrow(
      /cannot audit a link whose own id is unknown/
    );

    expect(executeQuery).toHaveBeenCalledTimes(1);
  });

  it("records an INSERT for a genuinely new link, keyed by the link row's own CAPID", async () => {
    const CAP_ID = 123;
    const { connectionManager, calls } = createMockConnectionManager([{ affectedRows: 1, insertId: CAP_ID }, { affectedRows: 1 }]);

    await auditCensusActivePersonnelLink(connectionManager, TEST_SCHEMA, TEST_TRANSACTION_ID, CENSUS_ID, PERSONNEL_ID, TEST_CHANGED_BY);

    expect(calls).toHaveLength(2);
    const row = decodeChangelogCall(calls[1]);
    expect(row.operation).toBe('INSERT');
    expect(row.recordID).toBe(String(CAP_ID));
    expect(row.censusID).toBe(CENSUS_ID);
    expect(JSON.parse(row.newRowState as string)).toEqual({ CAPID: CAP_ID, CensusID: CENSUS_ID, PersonnelID: PERSONNEL_ID });
  });
});
