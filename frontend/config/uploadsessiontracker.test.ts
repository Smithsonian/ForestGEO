import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  beginTransaction: vi.fn(),
  executeQuery: vi.fn(),
  commitTransaction: vi.fn(),
  rollbackTransaction: vi.fn(),
  withTransaction: vi.fn(),
  moveTemporaryBatchToFailedMeasurements: vi.fn(),
  getConn: vi.fn(),
  runQuery: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn()
}));

vi.mock('@/lib/db/connectionmanager', () => ({
  default: {
    getInstance: () => ({
      beginTransaction: mocks.beginTransaction,
      executeQuery: mocks.executeQuery,
      commitTransaction: mocks.commitTransaction,
      rollbackTransaction: mocks.rollbackTransaction,
      withTransaction: mocks.withTransaction
    })
  }
}));

vi.mock('@/lib/batchfailuretransfer', () => ({
  moveTemporaryBatchToFailedMeasurements: mocks.moveTemporaryBatchToFailedMeasurements
}));

vi.mock('@/lib/db/primitives', () => ({
  getConn: mocks.getConn,
  runQuery: mocks.runQuery
}));

vi.mock('@/ailogger', () => ({
  default: {
    info: mocks.loggerInfo,
    warn: mocks.loggerWarn,
    error: mocks.loggerError
  }
}));

import { SESSION_STAGED_ROW_DELETE_WINDOW_ROWS } from '@/lib/ingestion/temporary-measurements';
import { deriveArcgisCommitBatchID, buildSubBatchID } from '@/lib/uploads/batch-family';
import {
  abandonActiveSession,
  ACTIVE_UPLOAD_SESSION_STATES,
  cleanupOrphanedData,
  createUploadSession,
  runSessionCleanup,
  UploadSessionState
} from './uploadsessiontracker';

const WINDOW_TRANSACTION_ID = 'tx-window';

describe('cleanupOrphanedData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.beginTransaction.mockResolvedValue('tx-cleanup');
    mocks.commitTransaction.mockResolvedValue(undefined);
    mocks.rollbackTransaction.mockResolvedValue(undefined);
    mocks.withTransaction.mockImplementation(async (fn: (tx: { id: string }) => Promise<unknown>) => fn({ id: WINDOW_TRANSACTION_ID }));
  });

  it('keeps the full cleanup flow inside one transaction', async () => {
    mocks.executeQuery
      .mockResolvedValueOnce([{ state: UploadSessionState.ABANDONED }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ FileID: 'file.csv', BatchID: 'batch-1' }])
      .mockResolvedValueOnce({ affectedRows: 1 });
    mocks.moveTemporaryBatchToFailedMeasurements.mockResolvedValue(3);

    const result = await cleanupOrphanedData('forestgeo_testing', {
      sessionId: 'session-1',
      schema: 'forestgeo_testing',
      plotId: 7,
      censusId: 9,
      userId: 'mason',
      state: UploadSessionState.ABANDONED,
      fileId: 'file.csv',
      totalChunks: 1,
      uploadedChunks: 1,
      processedBatches: 0,
      totalBatches: 1,
      lastHeartbeat: new Date(),
      createdAt: new Date(),
      updatedAt: new Date()
    });

    expect(result).toEqual({ temporaryDeleted: 3, failedDeleted: 3, skipped: false });
    expect(mocks.beginTransaction).toHaveBeenCalledTimes(1);
    expect(mocks.moveTemporaryBatchToFailedMeasurements).toHaveBeenCalledWith(
      expect.any(Object),
      'forestgeo_testing',
      'file.csv',
      'batch-1',
      'Upload session session-1 cleaned up after abandonment (pre-migration rows)',
      'interrupted_upload',
      'tx-cleanup'
    );
    expect(mocks.commitTransaction).toHaveBeenCalledWith('tx-cleanup');
    expect(mocks.rollbackTransaction).not.toHaveBeenCalled();
  });

  it('marks a session-owned batch move as interrupted_upload (not just the pre-migration fallback)', async () => {
    mocks.executeQuery
      .mockResolvedValueOnce([{ state: UploadSessionState.ABANDONED }]) // session row locked and re-checked
      .mockResolvedValueOnce([{ FileID: 'file.csv', BatchID: 'batch-2' }]) // session-owned batches (SessionID = ?)
      .mockResolvedValueOnce([]) // no pre-migration (NULL SessionID) rows in this scope
      .mockResolvedValueOnce({ affectedRows: 1 }); // mark session cleaned up
    mocks.moveTemporaryBatchToFailedMeasurements.mockResolvedValue(2);

    const result = await cleanupOrphanedData('forestgeo_testing', {
      sessionId: 'session-2',
      schema: 'forestgeo_testing',
      plotId: 7,
      censusId: 9,
      userId: 'mason',
      state: UploadSessionState.ABANDONED,
      fileId: 'file.csv',
      totalChunks: 1,
      uploadedChunks: 1,
      processedBatches: 0,
      totalBatches: 1,
      lastHeartbeat: new Date(),
      createdAt: new Date(),
      updatedAt: new Date()
    });

    expect(result).toEqual({ temporaryDeleted: 2, failedDeleted: 2, skipped: false });
    expect(mocks.moveTemporaryBatchToFailedMeasurements).toHaveBeenCalledWith(
      expect.any(Object),
      'forestgeo_testing',
      'file.csv',
      'batch-2',
      'Upload session session-2 cleaned up after abandonment',
      'interrupted_upload',
      'tx-cleanup'
    );
  });

  it('rolls back the outer transaction when a batch move fails', async () => {
    mocks.executeQuery
      .mockResolvedValueOnce([{ state: UploadSessionState.ABANDONED }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ FileID: 'file.csv', BatchID: 'batch-1' }]);
    mocks.moveTemporaryBatchToFailedMeasurements.mockRejectedValue(new Error('cleanup failed'));

    await expect(
      cleanupOrphanedData('forestgeo_testing', {
        sessionId: 'session-1',
        schema: 'forestgeo_testing',
        plotId: 7,
        censusId: 9,
        userId: 'mason',
        state: UploadSessionState.ABANDONED,
        fileId: 'file.csv',
        totalChunks: 1,
        uploadedChunks: 1,
        processedBatches: 0,
        totalBatches: 1,
        lastHeartbeat: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      })
    ).rejects.toThrow('cleanup failed');

    expect(mocks.rollbackTransaction).toHaveBeenCalledWith('tx-cleanup');
    expect(mocks.commitTransaction).not.toHaveBeenCalled();
  });

  const SESSION_LOCK_SQL = /^\s*SELECT state FROM\s+\S+\.upload_sessions\s+WHERE session_id = \? FOR UPDATE/;
  const abandonedSession = {
    sessionId: 'sweep-session',
    plotId: 1,
    censusId: 2,
    fileId: 'arcgis.xlsx',
    state: UploadSessionState.ABANDONED
  } as never;

  it.each([
    ['failed (a takeover flipped it)', [{ state: UploadSessionState.FAILED }]],
    ['cleaned_up (another sweep finished it)', [{ state: UploadSessionState.CLEANED_UP }]],
    ['gone', []]
  ])('moves nothing when the locked session is %s (catches: acting on a listing taken outside the transaction)', async (_label, lockedRows) => {
    mocks.executeQuery.mockResolvedValueOnce(lockedRows);
    const result = await cleanupOrphanedData('forestgeo_testing', abandonedSession);
    const statements = mocks.executeQuery.mock.calls.map(([sql]) => String(sql).replace(/\s+/g, ' ').trim());
    console.log(`[AU12] result=${JSON.stringify(result)} statements=${JSON.stringify(statements)}`);
    expect(result).toEqual({ temporaryDeleted: 0, failedDeleted: 0, skipped: true });
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(SESSION_LOCK_SQL);
    expect(mocks.moveTemporaryBatchToFailedMeasurements).not.toHaveBeenCalled();
    expect(mocks.commitTransaction).not.toHaveBeenCalled();
    expect(mocks.rollbackTransaction).toHaveBeenCalledWith('tx-cleanup');
  });

  it('locks the session row before the first temporarymeasurements statement when it is still abandoned', async () => {
    mocks.executeQuery
      .mockResolvedValueOnce([{ state: UploadSessionState.ABANDONED }])
      .mockResolvedValueOnce([{ FileID: 'arcgis.xlsx', BatchID: 'batch-1' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ affectedRows: 1 });
    mocks.moveTemporaryBatchToFailedMeasurements.mockResolvedValue(4);
    const result = await cleanupOrphanedData('forestgeo_testing', abandonedSession);
    const statements = mocks.executeQuery.mock.calls.map(([sql]) => String(sql));
    const lockIndex = statements.findIndex(sql => SESSION_LOCK_SQL.test(sql));
    const firstStagedIndex = statements.findIndex(sql => sql.includes('temporarymeasurements'));
    console.log(`[AU12] lock at ${lockIndex}, first staged-row statement at ${firstStagedIndex}, result=${JSON.stringify(result)}`);
    expect(lockIndex).toBe(0);
    expect(firstStagedIndex).toBeGreaterThan(lockIndex);
    expect(result).toEqual({ temporaryDeleted: 4, failedDeleted: 4, skipped: false });
  });

  describe('ArcGIS staged rows (the import row restages them, so the sweep deletes instead of moving)', () => {
    const IMPORT_SESSION_ID = '6f1c2d3e-4a5b-4c6d-8e7f-901234567890';
    const ARCGIS_ROOT_BATCH = deriveArcgisCommitBatchID(IMPORT_SESSION_ID);
    const CSV_BATCH = 'lq1k2m3n-abc';
    const LAST_WINDOW_ROWS = 3;

    it('deletes every ArcGIS family window by window, each in its own transaction, and moves nothing', async () => {
      mocks.executeQuery
        .mockResolvedValueOnce([{ state: UploadSessionState.ABANDONED }])
        .mockResolvedValueOnce([
          { FileID: 'arcgis.xlsx', BatchID: buildSubBatchID(ARCGIS_ROOT_BATCH, 1) },
          { FileID: 'arcgis.xlsx', BatchID: buildSubBatchID(ARCGIS_ROOT_BATCH, 2) }
        ])
        .mockResolvedValueOnce({ affectedRows: SESSION_STAGED_ROW_DELETE_WINDOW_ROWS })
        .mockResolvedValueOnce({ affectedRows: LAST_WINDOW_ROWS })
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce({ affectedRows: 1 });

      const result = await cleanupOrphanedData('forestgeo_testing', abandonedSession);

      const statements = mocks.executeQuery.mock.calls.map(([sql, params, transactionID]) => ({
        sql: String(sql).replace(/\s+/g, ' ').trim(),
        params,
        transactionID
      }));
      console.log(
        `[M1] result=${JSON.stringify(result)} statements=${JSON.stringify(statements.map(({ sql, transactionID }) => ({ sql: sql.slice(0, 90), transactionID })))}`
      );
      const windowDeletes = statements.filter(({ sql }) => sql.startsWith('DELETE'));
      expect(windowDeletes).toHaveLength(2);
      expect(windowDeletes.every(({ transactionID }) => transactionID === WINDOW_TRANSACTION_ID)).toBe(true);
      expect(windowDeletes[0].params).toEqual(['sweep-session', 'arcgis.xlsx', ARCGIS_ROOT_BATCH, expect.stringContaining(ARCGIS_ROOT_BATCH)]);
      expect(mocks.withTransaction).toHaveBeenCalledTimes(2);
      expect(mocks.moveTemporaryBatchToFailedMeasurements).not.toHaveBeenCalled();
      expect(result).toEqual({ temporaryDeleted: SESSION_STAGED_ROW_DELETE_WINDOW_ROWS + LAST_WINDOW_ROWS, failedDeleted: 0, skipped: false });
    });

    it('runs the deletes only after the session was re-checked as abandoned under its lock', async () => {
      mocks.executeQuery.mockResolvedValueOnce([{ state: UploadSessionState.FAILED }]);
      await cleanupOrphanedData('forestgeo_testing', abandonedSession);
      expect(mocks.withTransaction).not.toHaveBeenCalled();
      expect(mocks.executeQuery).toHaveBeenCalledTimes(1);
    });

    it('moves CSV batches as before while deleting the ArcGIS family in the same session', async () => {
      mocks.executeQuery
        .mockResolvedValueOnce([{ state: UploadSessionState.ABANDONED }])
        .mockResolvedValueOnce([
          { FileID: 'arcgis.xlsx', BatchID: ARCGIS_ROOT_BATCH },
          { FileID: 'upload.csv', BatchID: CSV_BATCH }
        ])
        .mockResolvedValueOnce({ affectedRows: LAST_WINDOW_ROWS })
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce({ affectedRows: 1 });
      mocks.moveTemporaryBatchToFailedMeasurements.mockResolvedValue(2);

      const result = await cleanupOrphanedData('forestgeo_testing', abandonedSession);

      console.log(
        `[M1] mixed result=${JSON.stringify(result)} moves=${JSON.stringify(mocks.moveTemporaryBatchToFailedMeasurements.mock.calls.map(call => call.slice(2, 4)))}`
      );
      expect(mocks.moveTemporaryBatchToFailedMeasurements).toHaveBeenCalledTimes(1);
      expect(mocks.moveTemporaryBatchToFailedMeasurements.mock.calls[0].slice(2, 4)).toEqual(['upload.csv', CSV_BATCH]);
      expect(result).toEqual({ temporaryDeleted: LAST_WINDOW_ROWS + 2, failedDeleted: 2, skipped: false });
    });

    it('rolls back the session lock and leaves the session abandoned when a window delete fails', async () => {
      mocks.executeQuery
        .mockResolvedValueOnce([{ state: UploadSessionState.ABANDONED }])
        .mockResolvedValueOnce([{ FileID: 'arcgis.xlsx', BatchID: ARCGIS_ROOT_BATCH }])
        .mockRejectedValueOnce(new Error('window delete failed'));

      await expect(cleanupOrphanedData('forestgeo_testing', abandonedSession)).rejects.toThrow('window delete failed');

      expect(mocks.rollbackTransaction).toHaveBeenCalledWith('tx-cleanup');
      expect(mocks.commitTransaction).not.toHaveBeenCalled();
    });
  });

  it('formats the session lock through safeFormatQuery: the schema is escaped as an identifier', async () => {
    mocks.executeQuery.mockResolvedValueOnce([{ state: UploadSessionState.FAILED }]);
    await cleanupOrphanedData('forestgeo_testing', abandonedSession);
    const lockStatement = String(mocks.executeQuery.mock.calls[0][0]);
    console.log(`[L3] lock statement=${lockStatement}`);
    expect(lockStatement).toContain('`forestgeo_testing`.upload_sessions');
  });

  it('refuses a schema outside the allow-list before any statement runs', async () => {
    await expect(cleanupOrphanedData('forestgeo_testing; DROP TABLE x', abandonedSession)).rejects.toThrow();
    console.log(`[L3] statements run=${mocks.executeQuery.mock.calls.length}`);
    expect(mocks.executeQuery).not.toHaveBeenCalled();
    expect(mocks.rollbackTransaction).toHaveBeenCalledWith('tx-cleanup');
  });

  it('does not roll back a second time when the rollback of a skipped sweep itself fails (L5)', async () => {
    mocks.executeQuery.mockResolvedValueOnce([{ state: UploadSessionState.FAILED }]);
    mocks.rollbackTransaction.mockRejectedValueOnce(new Error('rollback failed'));
    await expect(cleanupOrphanedData('forestgeo_testing', abandonedSession)).rejects.toThrow('rollback failed');
    console.log(`[L5] rollback calls=${mocks.rollbackTransaction.mock.calls.length}`);
    expect(mocks.rollbackTransaction).toHaveBeenCalledTimes(1);
  });
});

describe('abandonActiveSession', () => {
  const release = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getConn.mockResolvedValue({ release });
    mocks.runQuery.mockResolvedValue({ affectedRows: 1 });
  });

  it('writes abandoned only where the session is still in an active state, so a failed or completed session keeps its state', async () => {
    await abandonActiveSession('forestgeo_testing', 'session-9', 'Session cancelled by user');

    const [, sql, params] = mocks.runQuery.mock.calls[0];
    const normalizedSql = String(sql).replace(/\s+/g, ' ').trim();
    console.log(`[L1] sql=${normalizedSql} params=${JSON.stringify(params)}`);
    expect(normalizedSql).toMatch(/WHERE session_id = \? AND state IN \(/);
    for (const activeState of ACTIVE_UPLOAD_SESSION_STATES) expect(normalizedSql).toContain(`'${activeState}'`);
    for (const settledState of [UploadSessionState.FAILED, UploadSessionState.COMPLETED, UploadSessionState.CLEANED_UP, UploadSessionState.ABANDONED]) {
      expect(normalizedSql).not.toContain(`'${settledState}'`);
    }
    expect(params).toEqual([UploadSessionState.ABANDONED, 'Session cancelled by user', 'session-9']);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('formats the statement through safeFormatQuery: the schema is escaped as an identifier', async () => {
    await abandonActiveSession('forestgeo_testing', 'session-9', 'x');
    const [, sql] = mocks.runQuery.mock.calls[0];
    console.log(`[abandon] statement=${String(sql).replace(/\s+/g, ' ').trim()}`);
    expect(String(sql)).toContain('`forestgeo_testing`.upload_sessions');
  });

  it('refuses a schema outside the allow-list before taking a connection or running a statement', async () => {
    await expect(abandonActiveSession('forestgeo_testing; DROP TABLE x', 'session-9', 'x')).rejects.toThrow();
    console.log(`[abandon] getConn calls=${mocks.getConn.mock.calls.length} runQuery calls=${mocks.runQuery.mock.calls.length}`);
    expect(mocks.getConn).not.toHaveBeenCalled();
    expect(mocks.runQuery).not.toHaveBeenCalled();
  });

  it('reports whether a row was abandoned', async () => {
    mocks.runQuery.mockResolvedValueOnce({ affectedRows: 0 });
    await expect(abandonActiveSession('forestgeo_testing', 'session-9', 'x')).resolves.toBe(false);
    mocks.runQuery.mockResolvedValueOnce({ affectedRows: 1 });
    await expect(abandonActiveSession('forestgeo_testing', 'session-9', 'x')).resolves.toBe(true);
  });
});

describe('runSessionCleanup', () => {
  const release = vi.fn();
  const abandonedRow = (sessionId: string) => ({
    session_id: sessionId,
    schema_name: 'forestgeo_testing',
    plot_id: 1,
    census_id: 2,
    user_id: 'mason',
    state: UploadSessionState.ABANDONED,
    file_id: 'file.csv',
    last_heartbeat: new Date(),
    created_at: new Date(),
    updated_at: new Date()
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getConn.mockResolvedValue({ release });
    mocks.beginTransaction.mockResolvedValue('tx-cleanup');
    mocks.commitTransaction.mockResolvedValue(undefined);
    mocks.rollbackTransaction.mockResolvedValue(undefined);
  });

  it('counts only sessions it actually cleaned: one a takeover failed under the lock is skipped, not cleaned', async () => {
    mocks.runQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([abandonedRow('taken-over'), abandonedRow('really-abandoned')]);
    mocks.executeQuery
      .mockResolvedValueOnce([{ state: UploadSessionState.FAILED }])
      .mockResolvedValueOnce([{ state: UploadSessionState.ABANDONED }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ affectedRows: 1 });

    const summary = await runSessionCleanup('forestgeo_testing');

    console.log(`[N-b] summary=${JSON.stringify(summary)}`);
    expect(summary).toEqual({ staleMarked: 0, cleanedUp: 1, totalTempDeleted: 0 });
  });
});

describe('createUploadSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retries stale scope-lock collisions with the same mode-aware insert payload', async () => {
    const schema = 'forestgeo_uploadsession_retry_test';
    const staleHeartbeat = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const initialConn = { release: vi.fn() };
    const precheckConn = { release: vi.fn() };
    const insertConn = { release: vi.fn() };
    const catchLookupConn = { release: vi.fn() };
    const catchUpdateConn = { release: vi.fn() };

    mocks.getConn
      .mockResolvedValueOnce(initialConn)
      .mockResolvedValueOnce(precheckConn)
      .mockResolvedValueOnce(insertConn)
      .mockResolvedValueOnce(catchLookupConn)
      .mockResolvedValueOnce(catchUpdateConn);

    const duplicateScopeError = Object.assign(new Error('Duplicate entry for key uq_upload_sessions_active_scope'), {
      code: 'ER_DUP_ENTRY',
      sqlMessage: 'Duplicate entry for key uq_upload_sessions_active_scope'
    });

    mocks.runQuery
      // findSessionByIdempotencyKey
      .mockResolvedValueOnce([])
      // abandonStaleSessionsForScope -> findActiveSessionsForPlotCensus
      .mockResolvedValueOnce([])
      // ensureUploadSessionScopeLock -> hasColumn(active_scope_key)
      .mockResolvedValueOnce([{ count: 1 }])
      // ensureUploadSessionScopeLock -> abandonDuplicateActiveScopeSessions
      .mockResolvedValueOnce({ affectedRows: 0 })
      // ensureUploadSessionScopeLock -> hasIndex(uq_upload_sessions_active_scope)
      .mockResolvedValueOnce([{ count: 1 }])
      // initial INSERT hits duplicate-key race
      .mockRejectedValueOnce(duplicateScopeError)
      // catch branch -> findActiveSessionsForPlotCensus
      .mockResolvedValueOnce([
        {
          session_id: 'stale-session-1',
          schema_name: schema,
          plot_id: 7,
          census_id: 9,
          user_id: 'mason',
          state: 'initialized',
          file_id: 'file.csv',
          total_chunks: 3,
          uploaded_chunks: 0,
          processed_batches: 0,
          total_batches: 0,
          last_heartbeat: staleHeartbeat,
          created_at: staleHeartbeat,
          updated_at: staleHeartbeat,
          error_message: null,
          idempotency_key: 'older-idem',
          mode: 'revisions'
        }
      ])
      // catch branch -> updateSessionState(stale-session-1, abandoned)
      .mockResolvedValueOnce({ affectedRows: 1 })
      // catch branch -> retry INSERT succeeds
      .mockResolvedValueOnce({ affectedRows: 1 });

    const created = await createUploadSession(schema, 7, 9, 'mason', 'file.csv', 3, 'idem-1', 'clean_reupload');

    expect(created).toMatchObject({
      schema,
      plotId: 7,
      censusId: 9,
      userId: 'mason',
      fileId: 'file.csv',
      totalChunks: 3,
      idempotencyKey: 'idem-1',
      mode: 'clean_reupload'
    });
    expect(mocks.runQuery.mock.calls.at(-1)?.[2]).toEqual([created.sessionId, schema, 7, 9, 'mason', 'initialized', 'file.csv', 3, 'idem-1', 'clean_reupload']);
  });

  it('starts a new session instead of handing back a completed one with the same idempotency key', async () => {
    // Re-running a finished clean re-upload of unchanged files produces the same idempotency
    // key. The old session already recorded its replacement marker, so reusing it would make
    // the new upload skip the reset and silently append (#472).
    const schema = 'forestgeo_uploadsession_completed_test';
    const completedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const completedSessionID = 'completed-session-1';
    mocks.getConn.mockResolvedValue({ release: vi.fn() });
    mocks.runQuery
      // findSessionByIdempotencyKey -> the earlier, finished upload of the same files
      .mockResolvedValueOnce([
        {
          session_id: completedSessionID,
          schema_name: schema,
          plot_id: 7,
          census_id: 9,
          user_id: 'mason',
          state: UploadSessionState.COMPLETED,
          file_id: 'species.csv',
          total_chunks: 1,
          uploaded_chunks: 1,
          processed_batches: 0,
          total_batches: 0,
          last_heartbeat: completedAt,
          created_at: completedAt,
          updated_at: completedAt,
          error_message: null,
          idempotency_key: 'idem-completed',
          mode: 'clean_reupload'
        }
      ])
      // abandonStaleSessionsForScope -> findActiveSessionsForPlotCensus
      .mockResolvedValueOnce([])
      // ensureUploadSessionScopeLock -> hasColumn, abandonDuplicateActiveScopeSessions, hasIndex
      .mockResolvedValueOnce([{ count: 1 }])
      .mockResolvedValueOnce({ affectedRows: 0 })
      .mockResolvedValueOnce([{ count: 1 }])
      // INSERT the new session
      .mockResolvedValueOnce({ affectedRows: 1 });

    const created = await createUploadSession(schema, 7, 9, 'mason', 'species.csv', 1, 'idem-completed', 'clean_reupload');

    const insertCall = mocks.runQuery.mock.calls.at(-1);
    console.log(`[createUploadSession] returned ${created.sessionId} (${created.state}); last statement: ${String(insertCall?.[1]).replace(/\s+/g, ' ')}`);
    expect(created.sessionId).not.toBe(completedSessionID);
    expect(created.state).toBe(UploadSessionState.INITIALIZED);
    expect(String(insertCall?.[1])).toContain('INSERT INTO');
    expect(insertCall?.[2]).toEqual([created.sessionId, schema, 7, 9, 'mason', 'initialized', 'species.csv', 1, 'idem-completed', 'clean_reupload']);
  });
});
