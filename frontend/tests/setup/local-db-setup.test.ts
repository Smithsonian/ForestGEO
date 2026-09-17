import { describe, expect, it, vi } from 'vitest';

import { backfillLegacyUploadTrackingColumns, resolveTestDatabaseNamespace, testDatabaseName, TEST_DB_NAME_PREFIX } from './local-db-setup';

describe('backfillLegacyUploadTrackingColumns', () => {
  it('returns the backfill summary from the executed queries', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([{ affectedRows: 4 }])
      .mockResolvedValueOnce([[{ count: 1 }]])
      .mockResolvedValueOnce([[{ count: 2 }]]);

    const result = await backfillLegacyUploadTrackingColumns({ query } as any);

    expect(result).toEqual({
      backfilledRows: 4,
      remainingRowsWithMetadataGaps: 1,
      conflictingRows: 2
    });

    expect(query).toHaveBeenCalledTimes(3);
    expect(String(query.mock.calls[0][0])).toContain('UPDATE coremeasurements');
    expect(String(query.mock.calls[1][0])).toContain('UploadFileID IS NULL OR UploadBatchID IS NULL');
    expect(String(query.mock.calls[2][0])).toContain('UploadFileID <>');
  });
});

describe('test database naming', () => {
  const WORKTREE_A = '/Users/example/dev/ForestGEO/frontend';
  const WORKTREE_B = '/Users/example/dev/ForestGEO-worktrees/feature/frontend';
  const MYSQL_MAX_IDENTIFIER_LENGTH = 64;
  const SEGMENT_PATTERN = /^[a-z0-9_]{1,32}$/;
  const LONGEST_VALID_SEGMENT = 'a'.repeat(32);
  const OVERLONG_SEGMENT = 'a'.repeat(33);
  const BACKTICK = '`';

  it('derives the same namespace for the same worktree on every run', () => {
    expect(resolveTestDatabaseNamespace(undefined, WORKTREE_A)).toBe(resolveTestDatabaseNamespace(undefined, WORKTREE_A));
  });

  it('derives different namespaces for different worktrees', () => {
    expect(resolveTestDatabaseNamespace(undefined, WORKTREE_A)).not.toBe(resolveTestDatabaseNamespace(undefined, WORKTREE_B));
  });

  it('prefers an explicit TEST_DB_NAMESPACE', () => {
    expect(resolveTestDatabaseNamespace('local', WORKTREE_A)).toBe('local');
  });

  it('treats an empty TEST_DB_NAMESPACE as unset', () => {
    expect(resolveTestDatabaseNamespace('', WORKTREE_A)).toBe(resolveTestDatabaseNamespace(undefined, WORKTREE_A));
  });

  it('rejects a namespace that is not a safe identifier fragment', () => {
    expect(() => resolveTestDatabaseNamespace('drop-me; --', WORKTREE_A)).toThrow(/TEST_DB_NAMESPACE/);
    expect(() => resolveTestDatabaseNamespace(BACKTICK, WORKTREE_A)).toThrow(/TEST_DB_NAMESPACE/);
    expect(() => resolveTestDatabaseNamespace(OVERLONG_SEGMENT, WORKTREE_A)).toThrow(/TEST_DB_NAMESPACE/);
    expect(() => resolveTestDatabaseNamespace('Local', WORKTREE_A)).toThrow(/TEST_DB_NAMESPACE/);
  });

  it('rejects a pool id that is not a safe identifier fragment', () => {
    expect(() => testDatabaseName('local', BACKTICK)).toThrow(/pool id/);
  });

  it('builds a prefixed, pool-suffixed name that fits a MySQL identifier', () => {
    const namespace = resolveTestDatabaseNamespace(undefined, WORKTREE_A);
    expect(namespace, 'a hashed namespace must itself be a safe identifier fragment').toMatch(SEGMENT_PATTERN);

    const name = testDatabaseName(namespace, 'default');
    expect(name.startsWith(TEST_DB_NAME_PREFIX), `cleanup tooling matches on ${TEST_DB_NAME_PREFIX}%`).toBe(true);
    expect(name.endsWith('_default')).toBe(true);
    expect(name.length).toBeLessThanOrEqual(MYSQL_MAX_IDENTIFIER_LENGTH);
    expect(testDatabaseName(LONGEST_VALID_SEGMENT, '1').length).toBeLessThanOrEqual(MYSQL_MAX_IDENTIFIER_LENGTH);
    expect(testDatabaseName('local', '1')).toBe('forestgeo_test_local_1');
  });
});
