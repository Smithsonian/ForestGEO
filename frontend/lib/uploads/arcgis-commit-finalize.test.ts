import { beforeEach, describe, expect, it, vi } from 'vitest';
import type ConnectionManager from '@/lib/db/connectionmanager';
import { UploadMode } from '@/config/uploadmodes';
import {
  ArcgisImportSessionError,
  ArcgisImportSessionInvariantError,
  type ArcgisCommitAttempt,
  type ArcgisCommitUnitSnapshot
} from '@/lib/arcgis/import-session';
import { CensusReplacementIncompleteError } from '@/lib/uploads/stage-measurements';
import { deriveArcgisCommitBatchID } from '@/lib/uploads/batch-family';
import { ARCGIS_COMMIT_STATEMENT, WRITE_STATEMENT } from '@/tests/setup/arcgis-commit-statement-patterns';

const mocks = vi.hoisted(() => ({ countStaged: vi.fn(), markCommitted: vi.fn() }));
vi.mock('@/ailogger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/uploads/stage-measurements', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/uploads/stage-measurements')>()),
  countStagedRows: mocks.countStaged
}));
vi.mock('@/lib/arcgis/import-session', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/arcgis/import-session')>()),
  markArcgisImportCommitCompleted: mocks.markCommitted
}));

import { ArcgisCommitVerificationError, finalizeArcgisCommit } from './arcgis-commit-finalize';

const IMPORT_SESSION_ID = '6f1c2d3e-4a5b-4c6d-8e7f-901234567890';
const ROW_COUNT = 10_007;
const STAGED = 10_006;
const TX = 'finalize-tx';
const ATTEMPT: ArcgisCommitAttempt = {
  schema: 'forestgeo_testing',
  importSessionId: IMPORT_SESSION_ID,
  plotID: 22,
  censusID: 6,
  batchID: deriveArcgisCommitBatchID(IMPORT_SESSION_ID),
  uploadMode: UploadMode.CLEAN_REUPLOAD,
  uploadSessionID: 'upload-session-B',
  attemptID: 'attempt-2',
  changedBy: 'arcgis-owner@example.com'
};
const SNAPSHOT: ArcgisCommitUnitSnapshot = {
  commitCompleted: false,
  rowCount: ROW_COUNT,
  stagingNextRowIndex: ROW_COUNT,
  committedRowCount: STAGED,
  censusReplacementCompleted: true,
  fileName: 'arcgis.xlsx'
};

function finalizeConnection(failureRows: number) {
  const statements: Array<{ sql: string; params: unknown[]; transactionID?: string }> = [];
  const executeQuery = vi.fn(async (sql: string, params: unknown[] = [], transactionID?: string) => {
    statements.push({ sql, params, transactionID });
    if (ARCGIS_COMMIT_STATEMENT.FAMILY_FAILURE_COUNT.test(sql)) return [{ failureRowCount: failureRows }];
    if (ARCGIS_COMMIT_STATEMENT.FILE_UPLOAD_CHANGELOG_LOCK.test(sql)) return [];
    return { affectedRows: 1 };
  });
  return { manager: { executeQuery } as unknown as ConnectionManager, statements };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.countStaged.mockResolvedValue(STAGED);
  mocks.markCommitted.mockResolvedValue(undefined);
});

describe('finalizeArcgisCommit', () => {
  it('verifies both counts in its transaction, writes the changelog, then marks committed', async () => {
    const { manager, statements } = finalizeConnection(ROW_COUNT - STAGED);
    const result = await finalizeArcgisCommit(manager, ATTEMPT, SNAPSHOT, TX);
    const insert = statements.find(({ sql }) => ARCGIS_COMMIT_STATEMENT.FILE_UPLOAD_CHANGELOG_INSERT.test(sql))!;
    const metadata = JSON.parse(String(insert.params[3]));
    console.log(`[finalize] result=${JSON.stringify(result)} metadata=${JSON.stringify(metadata)}`);
    expect(result).toEqual({ committedRowCount: STAGED, droppedRowCount: ROW_COUNT - STAGED });
    expect(mocks.countStaged).toHaveBeenCalledWith(manager, ATTEMPT.schema, SNAPSHOT.fileName, ATTEMPT.batchID, ATTEMPT.plotID, ATTEMPT.censusID, TX);
    expect(statements.every(({ transactionID }) => transactionID === TX)).toBe(true);
    expect(JSON.stringify(metadata)).toContain(ATTEMPT.batchID);
    expect(mocks.markCommitted).toHaveBeenCalledWith(manager, ATTEMPT, TX);
  });

  it.each([
    ['staged rows removed', STAGED - 10, ROW_COUNT - STAGED],
    ['failure rows removed', STAGED, 0]
  ])('refuses to finalize when %s (AU7)', async (label, stagedFound, failuresFound) => {
    mocks.countStaged.mockResolvedValueOnce(stagedFound);
    const { manager, statements } = finalizeConnection(failuresFound);
    let thrown: unknown;
    try {
      await finalizeArcgisCommit(manager, ATTEMPT, SNAPSHOT, TX);
    } catch (error) {
      thrown = error;
    }
    console.log(`[AU7] ${label}: ${thrown instanceof Error ? thrown.message : String(thrown)}`);
    expect(thrown).toBeInstanceOf(ArcgisCommitVerificationError);
    expect(thrown).not.toBeInstanceOf(ArcgisImportSessionError);
    expect((thrown as ArcgisCommitVerificationError).detail).toEqual({
      importSessionId: IMPORT_SESSION_ID,
      expectedStagedRows: STAGED,
      foundStagedRows: stagedFound,
      expectedFailureRows: ROW_COUNT - STAGED,
      foundFailureRows: failuresFound
    });
    expect(statements.filter(({ sql }) => WRITE_STATEMENT.test(sql))).toEqual([]);
    expect(mocks.markCommitted).not.toHaveBeenCalled();
  });

  it('refuses a CLEAN finalize without the replacement marker, and a cursor short of the row count', async () => {
    const { manager, statements } = finalizeConnection(1);
    await expect(finalizeArcgisCommit(manager, ATTEMPT, { ...SNAPSHOT, censusReplacementCompleted: false }, TX)).rejects.toBeInstanceOf(
      CensusReplacementIncompleteError
    );
    await expect(finalizeArcgisCommit(manager, ATTEMPT, { ...SNAPSHOT, stagingNextRowIndex: ROW_COUNT - 7 }, TX)).rejects.toBeInstanceOf(
      ArcgisImportSessionInvariantError
    );
    expect(statements).toEqual([]);
  });

  it('does not require the marker for REVISIONS', async () => {
    const { manager } = finalizeConnection(ROW_COUNT - STAGED);
    await expect(
      finalizeArcgisCommit(manager, { ...ATTEMPT, uploadMode: UploadMode.REVISIONS }, { ...SNAPSHOT, censusReplacementCompleted: false }, TX)
    ).resolves.toBeDefined();
  });
});
