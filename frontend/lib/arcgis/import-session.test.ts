import { describe, it, expect, vi } from 'vitest';
import type ConnectionManager from '@/lib/db/connectionmanager';
import { HTTPResponses } from '@/config/macros';
import { UploadMode } from '@/config/uploadmodes';
import { UploadSessionOwnershipError, UploadSessionState } from '@/config/uploadsessiontracker';
import { MAX_MEASUREMENT_FILE_ID_LENGTH } from '@/lib/uploads/file-names';
import { deriveArcgisCommitBatchID, getIngestionBatchSize, MAX_SUB_BATCH_ORDINAL } from '@/lib/uploads/batch-family';
import { ARCGIS_COMMIT_STATEMENT, WRITE_STATEMENT } from '@/tests/setup/arcgis-commit-statement-patterns';
import { CENSUS_REPLACEMENT_STATEMENT } from '@/tests/setup/census-replacement-statement-patterns';
import {
  ARCGIS_COMMIT_CLAIM_KIND,
  ARCGIS_IMPORT_SESSION_STATE,
  ArcgisImportSessionError,
  ArcgisImportSessionInvariantError,
  assertUploadableArcgisSession,
  claimArcgisImportCommitAttempt,
  type ArcgisCommitClaimInput
} from './import-session';

const baseSession = { user_id: 'u1', plot_id: 1, census_id: 2, file_id: 'f.xlsx', state: 'preflight' };
const scope = { userId: 'u1', plotID: 1, censusID: 2, fileName: 'f.xlsx' };

describe('assertUploadableArcgisSession', () => {
  it('passes for a matching preflight session', () => {
    expect(() => assertUploadableArcgisSession(baseSession, scope)).not.toThrow();
  });

  it('rejects a committing session now that the state machine is collapsed', () => {
    try {
      assertUploadableArcgisSession({ ...baseSession, state: 'committing' }, scope);
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ArcgisImportSessionError);
      expect((e as ArcgisImportSessionError).status).toBe(HTTPResponses.CONFLICT);
      expect((e as ArcgisImportSessionError).message).toContain('uploadable');
    }
  });

  it('rejects a missing session with 404 NOT_FOUND', () => {
    try {
      assertUploadableArcgisSession(null, scope);
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ArcgisImportSessionError);
      expect((e as ArcgisImportSessionError).status).toBe(HTTPResponses.NOT_FOUND);
      expect((e as ArcgisImportSessionError).message).toContain('not found');
    }
  });

  it('rejects a foreign user with 403 FORBIDDEN', () => {
    try {
      assertUploadableArcgisSession({ ...baseSession, user_id: 'other' }, scope);
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ArcgisImportSessionError);
      expect((e as ArcgisImportSessionError).status).toBe(HTTPResponses.FORBIDDEN);
      expect((e as ArcgisImportSessionError).message).toContain('belong');
    }
  });

  it('rejects a plot scope mismatch with 409 CONFLICT', () => {
    try {
      assertUploadableArcgisSession({ ...baseSession, plot_id: 99 }, scope);
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ArcgisImportSessionError);
      expect((e as ArcgisImportSessionError).status).toBe(HTTPResponses.CONFLICT);
      expect((e as ArcgisImportSessionError).message).toContain('scope');
    }
  });

  it('rejects a census scope mismatch with 409 CONFLICT', () => {
    try {
      assertUploadableArcgisSession({ ...baseSession, census_id: 99 }, scope);
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ArcgisImportSessionError);
      expect((e as ArcgisImportSessionError).status).toBe(HTTPResponses.CONFLICT);
      expect((e as ArcgisImportSessionError).message).toContain('scope');
    }
  });

  it('rejects a file mismatch with 409 CONFLICT', () => {
    try {
      assertUploadableArcgisSession({ ...baseSession, file_id: 'other.xlsx' }, scope);
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ArcgisImportSessionError);
      expect((e as ArcgisImportSessionError).status).toBe(HTTPResponses.CONFLICT);
      expect((e as ArcgisImportSessionError).message).toContain('file');
    }
  });

  it('rejects a non-uploadable state with 409 CONFLICT', () => {
    try {
      assertUploadableArcgisSession({ ...baseSession, state: 'committed' }, scope);
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ArcgisImportSessionError);
      expect((e as ArcgisImportSessionError).status).toBe(HTTPResponses.CONFLICT);
      expect((e as ArcgisImportSessionError).message).toContain('uploadable');
    }
  });
});

const CLAIM_SCHEMA = 'forestgeo_testing';
const IMPORT_SESSION_ID = '6f1c2d3e-4a5b-4c6d-8e7f-901234567890';
const DERIVED_BATCH = deriveArcgisCommitBatchID(IMPORT_SESSION_ID);
const CALLER_BATCH = 'm9x7k2a-8fh3k9d2x5p';
const LEGACY_CLIENT_BATCH = 'lg1k2a-legacyclient0';
const OWNER = 'arcgis-owner@example.com';
const PLOT_ID = 22;
const CENSUS_ID = 6;
const FILE_NAME = 'arcgis.xlsx';
const ROW_COUNT = 10_007;
const CALLER_SESSION = 'upload-session-B';
const PREVIOUS_SESSION = 'upload-session-A';
const ATTEMPT_ID = 'attempt-2';
const TRANSACTION_ID = 'claim-tx';
const ACTIVE_CALLER_SESSION = { state: UploadSessionState.UPLOADING, plot_id: PLOT_ID, census_id: CENSUS_ID, census_replacement_completed_at: null };

function importRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    import_session_id: IMPORT_SESSION_ID,
    user_id: OWNER,
    plot_id: PLOT_ID,
    census_id: CENSUS_ID,
    file_id: FILE_NAME,
    row_count: ROW_COUNT,
    summary_json: '{}',
    warnings_json: '[]',
    state: ARCGIS_IMPORT_SESSION_STATE.PREFLIGHT,
    committed_file_id: null,
    committed_batch_id: null,
    committed_upload_session_id: null,
    committed_row_count: null,
    committed_at: null,
    committed_upload_mode: null,
    commit_attempt_id: null,
    census_replacement_completed_at: null,
    staging_next_row_index: 0,
    ...overrides
  };
}
const committingRow = (overrides: Record<string, unknown> = {}) =>
  importRow({
    state: ARCGIS_IMPORT_SESSION_STATE.COMMITTING,
    committed_batch_id: DERIVED_BATCH,
    committed_upload_mode: UploadMode.CLEAN_REUPLOAD,
    committed_upload_session_id: CALLER_SESSION,
    commit_attempt_id: 'attempt-1',
    staging_next_row_index: 5_000,
    committed_row_count: 5_000,
    ...overrides
  });
const committedRow = (overrides: Record<string, unknown> = {}) =>
  importRow({
    state: ARCGIS_IMPORT_SESSION_STATE.COMMITTED,
    committed_batch_id: DERIVED_BATCH,
    committed_upload_mode: UploadMode.CLEAN_REUPLOAD,
    committed_upload_session_id: CALLER_SESSION,
    committed_row_count: ROW_COUNT,
    ...overrides
  });

interface ClaimScript {
  importRow: Record<string, unknown> | null;
  rowRange?: { firstRowIndex: number | null; lastRowIndex: number | null };
  callerSession?: Record<string, unknown> | null;
  previousSessionState?: string | null;
  otherCommittingImport?: boolean;
  claimAffectedRows?: number;
}

function scriptedClaimConnection(script: ClaimScript) {
  const statements: Array<{ sql: string; params: unknown[]; transactionID?: string }> = [];
  const executeQuery = vi.fn(async (sql: string, params: unknown[] = [], transactionID?: string) => {
    statements.push({ sql, params, transactionID });
    if (ARCGIS_COMMIT_STATEMENT.IMPORT_ROW_CLAIM_LOCK.test(sql)) return script.importRow ? [script.importRow] : [];
    if (ARCGIS_COMMIT_STATEMENT.IMPORT_ROW_RANGE.test(sql)) return [script.rowRange ?? { firstRowIndex: 0, lastRowIndex: ROW_COUNT - 1 }];
    if (ARCGIS_COMMIT_STATEMENT.UPLOAD_SESSION_STATE_LOCK.test(sql))
      return script.previousSessionState === null ? [] : [{ state: script.previousSessionState ?? UploadSessionState.ABANDONED }];
    if (CENSUS_REPLACEMENT_STATEMENT.SESSION_LOCK.test(sql)) return script.callerSession === null ? [] : [script.callerSession ?? ACTIVE_CALLER_SESSION];
    if (ARCGIS_COMMIT_STATEMENT.COMMITTING_IMPORT_PROBE.test(sql)) return script.otherCommittingImport ? [{ import_session_id: 'other-import' }] : [];
    if (ARCGIS_COMMIT_STATEMENT.PREDECESSOR_FAIL.test(sql)) return { affectedRows: 1 };
    if (ARCGIS_COMMIT_STATEMENT.CLAIM_UPDATE.test(sql)) return { affectedRows: script.claimAffectedRows ?? 1 };
    throw new Error(`scripted claim connection: unexpected statement ${sql}`);
  });
  const log = () => statements.map(({ sql, params }) => `${sql.replace(/\s+/g, ' ').slice(0, 110)} ${JSON.stringify(params)}`).join('\n');
  return { manager: { executeQuery } as unknown as ConnectionManager, statements, log };
}

function claimInput(overrides: Partial<ArcgisCommitClaimInput> = {}): ArcgisCommitClaimInput {
  return {
    schema: CLAIM_SCHEMA,
    importSessionId: IMPORT_SESSION_ID,
    plotID: PLOT_ID,
    censusID: CENSUS_ID,
    userId: OWNER,
    fileName: FILE_NAME,
    requestBatchID: CALLER_BATCH,
    uploadMode: UploadMode.CLEAN_REUPLOAD,
    uploadSessionID: CALLER_SESSION,
    attemptID: ATTEMPT_ID,
    ...overrides
  };
}

const OVERFLOW_ROW_COUNT = getIngestionBatchSize() * MAX_SUB_BATCH_ORDINAL + 1;

describe('claimArcgisImportCommitAttempt rejections write nothing (AU2, AC 14)', () => {
  it.each([
    ['a missing import session', { importRow: null }, {}, ArcgisImportSessionError, HTTPResponses.NOT_FOUND],
    ['a foreign user', { importRow: importRow({ user_id: 'someone-else' }) }, {}, ArcgisImportSessionError, HTTPResponses.FORBIDDEN],
    ['another census', { importRow: importRow({ census_id: CENSUS_ID + 1 }) }, {}, ArcgisImportSessionError, HTTPResponses.CONFLICT],
    ['another file', { importRow: importRow({ file_id: 'other.xlsx' }) }, {}, ArcgisImportSessionError, HTTPResponses.CONFLICT],
    ['zero rows', { importRow: importRow({ row_count: 0 }) }, {}, ArcgisImportSessionError, HTTPResponses.UNPROCESSABLE_ENTITY],
    [
      'incomplete import rows',
      { importRow: importRow(), rowRange: { firstRowIndex: 0, lastRowIndex: ROW_COUNT - 2 } },
      {},
      ArcgisImportSessionError,
      HTTPResponses.UNPROCESSABLE_ENTITY
    ],
    [
      'a file id too long for staging (fresh)',
      { importRow: importRow({ file_id: 'x'.repeat(MAX_MEASUREMENT_FILE_ID_LENGTH + 1) }) },
      { fileName: 'x'.repeat(MAX_MEASUREMENT_FILE_ID_LENGTH + 1) },
      ArcgisImportSessionError,
      HTTPResponses.INVALID_REQUEST
    ],
    [
      'a sub-batch overflow (fresh)',
      { importRow: importRow({ row_count: OVERFLOW_ROW_COUNT }), rowRange: { firstRowIndex: 0, lastRowIndex: OVERFLOW_ROW_COUNT - 1 } },
      {},
      ArcgisImportSessionError,
      HTTPResponses.INVALID_REQUEST
    ],
    [
      'committing under a batch that is not the derived one',
      { importRow: committingRow({ committed_batch_id: 'arc000000000000000000000other' }) },
      {},
      ArcgisImportSessionInvariantError,
      undefined
    ],
    [
      'committing as CLEAN, retried as REVISIONS',
      { importRow: committingRow() },
      { uploadMode: UploadMode.REVISIONS },
      ArcgisImportSessionError,
      HTTPResponses.CONFLICT
    ],
    [
      'committing as REVISIONS, retried as CLEAN',
      { importRow: committingRow({ committed_upload_mode: UploadMode.REVISIONS }) },
      {},
      ArcgisImportSessionError,
      HTTPResponses.CONFLICT
    ],
    [
      'committed as CLEAN, replayed as REVISIONS',
      { importRow: committedRow() },
      { uploadMode: UploadMode.REVISIONS },
      ArcgisImportSessionError,
      HTTPResponses.CONFLICT
    ],
    [
      'committed as REVISIONS, replayed as CLEAN',
      { importRow: committedRow({ committed_upload_mode: UploadMode.REVISIONS }) },
      {},
      ArcgisImportSessionError,
      HTTPResponses.CONFLICT
    ],
    [
      'a legacy committed row replayed with another batch',
      { importRow: committedRow({ committed_upload_mode: null, committed_batch_id: LEGACY_CLIENT_BATCH }) },
      {},
      ArcgisImportSessionError,
      HTTPResponses.CONFLICT
    ],
    [
      'another import committing under the same upload session',
      { importRow: importRow(), otherCommittingImport: true },
      {},
      ArcgisImportSessionError,
      HTTPResponses.CONFLICT
    ],
    [
      'an inactive caller upload session',
      { importRow: importRow(), callerSession: { ...ACTIVE_CALLER_SESSION, state: UploadSessionState.FAILED } },
      {},
      UploadSessionOwnershipError,
      undefined
    ]
  ])('%s', async (label, script, inputOverrides, errorClass, status) => {
    const { manager, statements, log } = scriptedClaimConnection(script as ClaimScript);
    let thrown: unknown;
    try {
      await claimArcgisImportCommitAttempt(manager, claimInput(inputOverrides), TRANSACTION_ID);
    } catch (error) {
      thrown = error;
    }
    console.log(
      `[AU2] ${label}: threw ${thrown instanceof Error ? `${thrown.name}(${(thrown as { status?: number }).status ?? '-'}): ${thrown.message}` : String(thrown)}\n${log()}`
    );
    expect(thrown).toBeInstanceOf(errorClass);
    if (status !== undefined) expect((thrown as ArcgisImportSessionError).status).toBe(status);
    expect(
      statements.filter(({ sql }) => WRITE_STATEMENT.test(sql)),
      'a rejected claim must not write'
    ).toEqual([]);
  });
});

describe('claimArcgisImportCommitAttempt batch and replay rules (AU2, N1, D28, AC 15, AC 20)', () => {
  it.each([[CALLER_BATCH], [null]])('a fresh claim writes the derived batch whatever the caller sends (%s)', async requestBatchID => {
    const { manager, statements, log } = scriptedClaimConnection({ importRow: importRow() });
    const claim = await claimArcgisImportCommitAttempt(manager, claimInput({ requestBatchID }), TRANSACTION_ID);
    const cas = statements.find(({ sql }) => ARCGIS_COMMIT_STATEMENT.CLAIM_UPDATE.test(sql));
    console.log(`[AU2] fresh claim=${JSON.stringify(claim)}\n${log()}`);
    expect(claim).toEqual({
      kind: ARCGIS_COMMIT_CLAIM_KIND.CLAIMED,
      batchID: DERIVED_BATCH,
      previousUploadSessionID: null,
      fileName: FILE_NAME,
      rowCount: ROW_COUNT
    });
    expect(cas?.params).toEqual([
      ARCGIS_IMPORT_SESSION_STATE.COMMITTING,
      DERIVED_BATCH,
      UploadMode.CLEAN_REUPLOAD,
      CALLER_SESSION,
      ATTEMPT_ID,
      IMPORT_SESSION_ID,
      ARCGIS_IMPORT_SESSION_STATE.PREFLIGHT,
      ARCGIS_IMPORT_SESSION_STATE.COMMITTING,
      DERIVED_BATCH,
      UploadMode.CLEAN_REUPLOAD
    ]);
    expect(cas?.params).not.toContain(CALLER_BATCH);
    expect(cas?.transactionID).toBe(TRANSACTION_ID);
  });

  it.each([[CALLER_BATCH], [DERIVED_BATCH], [null]])(
    'a committed row recorded by this change replays with its stored batch, writing nothing (caller sent %s)',
    async requestBatchID => {
      const { manager, statements } = scriptedClaimConnection({ importRow: committedRow() });
      const claim = await claimArcgisImportCommitAttempt(manager, claimInput({ requestBatchID }), TRANSACTION_ID);
      expect(claim).toEqual({
        kind: ARCGIS_COMMIT_CLAIM_KIND.ALREADY_COMMITTED,
        batchID: DERIVED_BATCH,
        previousUploadSessionID: null,
        fileName: FILE_NAME,
        rowCount: ROW_COUNT
      });
      expect(statements.filter(({ sql }) => WRITE_STATEMENT.test(sql))).toEqual([]);
    }
  );

  it('a legacy committed row (NULL mode) replays only with its stored client batch', async () => {
    const { manager, statements } = scriptedClaimConnection({
      importRow: committedRow({ committed_upload_mode: null, committed_batch_id: LEGACY_CLIENT_BATCH })
    });
    const claim = await claimArcgisImportCommitAttempt(manager, claimInput({ requestBatchID: LEGACY_CLIENT_BATCH }), TRANSACTION_ID);
    expect(claim.kind).toBe(ARCGIS_COMMIT_CLAIM_KIND.ALREADY_COMMITTED);
    expect(claim.batchID).toBe(LEGACY_CLIENT_BATCH);
    expect(statements.filter(({ sql }) => WRITE_STATEMENT.test(sql))).toEqual([]);
  });
});

describe('claimArcgisImportCommitAttempt kinds (AU3)', () => {
  it('a same-session retry restarts: new attempt id, progress reset, no upload_sessions write', async () => {
    const { manager, statements, log } = scriptedClaimConnection({ importRow: committingRow() });
    const claim = await claimArcgisImportCommitAttempt(manager, claimInput(), TRANSACTION_ID);
    console.log(`[AU3] restart=${JSON.stringify(claim)}\n${log()}`);
    expect(claim.kind).toBe(ARCGIS_COMMIT_CLAIM_KIND.RESTARTED);
    const cas = statements.find(({ sql }) => ARCGIS_COMMIT_STATEMENT.CLAIM_UPDATE.test(sql))!;
    expect(cas.sql.replace(/\s+/g, ' ')).toContain(
      'committed_row_count = 0, committed_at = NULL, staging_next_row_index = 0, census_replacement_completed_at = NULL'
    );
    expect(cas.params).toContain(ATTEMPT_ID);
    expect(statements.some(({ sql }) => ARCGIS_COMMIT_STATEMENT.UPLOAD_SESSION_STATE_LOCK.test(sql))).toBe(false);
    expect(statements.some(({ sql }) => ARCGIS_COMMIT_STATEMENT.PREDECESSOR_FAIL.test(sql))).toBe(false);
  });

  it('a takeover from an abandoned session locks in order and flips it to failed before the CAS', async () => {
    const { manager, statements, log } = scriptedClaimConnection({
      importRow: committingRow({ committed_upload_session_id: PREVIOUS_SESSION }),
      previousSessionState: UploadSessionState.ABANDONED
    });
    const claim = await claimArcgisImportCommitAttempt(manager, claimInput(), TRANSACTION_ID);
    console.log(`[AU3] takeover=${JSON.stringify(claim)}\n${log()}`);
    expect(claim).toMatchObject({ kind: ARCGIS_COMMIT_CLAIM_KIND.TAKEN_OVER, previousUploadSessionID: PREVIOUS_SESSION, batchID: DERIVED_BATCH });
    const order = statements.map(({ sql }) =>
      ARCGIS_COMMIT_STATEMENT.IMPORT_ROW_CLAIM_LOCK.test(sql)
        ? 'import-lock'
        : ARCGIS_COMMIT_STATEMENT.IMPORT_ROW_RANGE.test(sql)
          ? 'range'
          : ARCGIS_COMMIT_STATEMENT.UPLOAD_SESSION_STATE_LOCK.test(sql)
            ? 'previous-lock'
            : CENSUS_REPLACEMENT_STATEMENT.SESSION_LOCK.test(sql)
              ? 'caller-lock'
              : ARCGIS_COMMIT_STATEMENT.COMMITTING_IMPORT_PROBE.test(sql)
                ? 'probe'
                : ARCGIS_COMMIT_STATEMENT.PREDECESSOR_FAIL.test(sql)
                  ? 'flip-previous'
                  : ARCGIS_COMMIT_STATEMENT.CLAIM_UPDATE.test(sql)
                    ? 'cas'
                    : 'other'
    );
    expect(order).toEqual(['import-lock', 'range', 'previous-lock', 'caller-lock', 'probe', 'flip-previous', 'cas']);
    const flip = statements.find(({ sql }) => ARCGIS_COMMIT_STATEMENT.PREDECESSOR_FAIL.test(sql))!;
    expect(flip.params[0]).toBe(UploadSessionState.FAILED);
    expect(flip.params[2]).toBe(PREVIOUS_SESSION);
    expect(flip.params[3]).toBe(UploadSessionState.ABANDONED);
  });

  it('a takeover from a failed session writes no upload_sessions row', async () => {
    const { manager, statements } = scriptedClaimConnection({
      importRow: committingRow({ committed_upload_session_id: PREVIOUS_SESSION }),
      previousSessionState: UploadSessionState.FAILED
    });
    const claim = await claimArcgisImportCommitAttempt(manager, claimInput(), TRANSACTION_ID);
    expect(claim.kind).toBe(ARCGIS_COMMIT_CLAIM_KIND.TAKEN_OVER);
    expect(statements.some(({ sql }) => ARCGIS_COMMIT_STATEMENT.PREDECESSOR_FAIL.test(sql))).toBe(false);
  });

  it('a CAS that matches no row is a 409', async () => {
    const { manager } = scriptedClaimConnection({ importRow: importRow(), claimAffectedRows: 0 });
    await expect(claimArcgisImportCommitAttempt(manager, claimInput(), TRANSACTION_ID)).rejects.toMatchObject({ status: HTTPResponses.CONFLICT });
  });
});
