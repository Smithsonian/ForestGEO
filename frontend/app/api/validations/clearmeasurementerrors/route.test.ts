import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { HTTPResponses } from '@/config/macros';
import { CLEAR_MEASUREMENT_ERRORS_CODES } from '@/config/errorsexplorer';
import { INGESTION_STAGE_ERROR_CODES } from '@/config/errorsexplorer';
import { buildMeasurementScopeLockName, MEASUREMENT_SCOPE_LOCK_TIMEOUT_MS } from '@/config/measurementscopelock';

const AUTH_POLL_URL = 'https://auth.forestgeo.test/poll';
const EDITOR_EMAIL = 'editor@forestgeo.test';

const TRANSACTION_ID = 'tx-clear';
const SCHEMA = 'forestgeo_testing';
const BODY = { schema: SCHEMA, plotID: 1, censusID: 5, measurementID: 42 };
const DELETED_LOG_ENTRIES = 2;
/** `IsValidated + 0` of the BIT column: 0 marked invalid, 1 passed (NULL is pending). */
const IS_VALIDATED_FAILED = 0;
const IS_VALIDATED_PASSED = 1;
const ROUTE_CONTEXT = { params: Promise.resolve({}) };
const SCOPE_LOCK_STATEMENT_PREFIX = 'GET_LOCK ';
/** lib/route-authz.ts:119: fromBody turns an unparseable body into a missing schema before the handler runs. */
const ROUTE_AUTHZ_INVALID_SCHEMA_CODE = 'INVALID_SCHEMA';

const state = vi.hoisted(() => ({
  session: { user: { email: 'editor@forestgeo.test', userStatus: 'field crew', sites: [{ schemaName: 'forestgeo_testing' }] } } as Record<string, unknown>,
  measurementRow: [{ CoreMeasurementID: 42, StemGUID: 7, isValidated: 0 }] as Array<Record<string, unknown>>,
  deletedLogEntries: 0,
  /** Unresolved validation-source entries with an ingestion-stage code (20, 21) the DELETE leaves in place. */
  retainedIngestionStageEntries: 0,
  censusRow: [{ PlotCensusNumber: 1 }] as Array<Record<string, unknown>>,
  uploadSessions: [] as Array<Record<string, unknown>>,
  scopeLockAcquired: true,
  /** What the authoritative auth endpoint answers for the session's email; null is a 404 (user removed). */
  freshAuthorization: null as { userStatus: string; allowedSites: Array<Record<string, unknown>> } | null,
  failOn: null as RegExp | null,
  statements: [] as Array<{ sql: string; params: unknown[]; transactionID?: string }>
}));

vi.mock('@/auth', () => ({ auth: vi.fn(async () => state.session) }));
vi.mock('@/ailogger', () => ({ default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/db/connectionmanager', () => {
  const manager = {
    executeQuery: vi.fn(async (sql: string, params: unknown[] = [], transactionID?: string) => {
      state.statements.push({ sql, params, transactionID });
      if (state.failOn?.test(sql)) throw new Error('ER_LOCK_DEADLOCK secret detail');
      if (/FROM `forestgeo_testing`\.census c/.test(sql)) return state.censusRow;
      if (/upload_sessions/.test(sql)) return state.uploadSessions;
      if (/validation_runs/.test(sql)) return [];
      if (/FOR UPDATE/.test(sql) && /coremeasurements cm/.test(sql)) return state.measurementRow;
      if (/^DELETE mel/.test(sql.trim())) return { affectedRows: state.deletedLogEntries };
      if (/COUNT\(\*\) AS retainedCount/.test(sql)) return [{ retainedCount: state.retainedIngestionStageEntries }];
      if (/SET IsValidated = NULL/.test(sql)) return { affectedRows: 1 };
      return { affectedRows: 1 };
    }),
    beginTransaction: vi.fn(async () => TRANSACTION_ID),
    // Recorded as a statement so the success case can prove the lock precedes the conflict probe.
    acquireApplicationLock: vi.fn(async (lockName: string, transactionID: string) => {
      state.statements.push({ sql: `GET_LOCK ${lockName}`, params: [], transactionID });
      return state.scopeLockAcquired;
    }),
    commitTransaction: vi.fn(async () => undefined),
    rollbackTransaction: vi.fn(async () => undefined),
    closeConnection: vi.fn(async () => undefined)
  };
  return { default: { getInstance: () => manager } };
});

import ConnectionManager from '@/lib/db/connectionmanager';
import { POST } from './route';

function authorizationEndpointAnswer(): Response {
  if (state.freshAuthorization === null) return new Response(null, { status: HTTPResponses.NOT_FOUND });
  return new Response(JSON.stringify(state.freshAuthorization), { status: HTTPResponses.OK });
}

function post(body: unknown) {
  return POST(
    new NextRequest('http://localhost/api/validations/clearmeasurementerrors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body)
    }),
    ROUTE_CONTEXT
  );
}

function manager() {
  return ConnectionManager.getInstance() as unknown as Record<
    'beginTransaction' | 'acquireApplicationLock' | 'commitTransaction' | 'rollbackTransaction' | 'executeQuery',
    ReturnType<typeof vi.fn>
  >;
}

describe('POST /api/validations/clearmeasurementerrors', () => {
  beforeEach(() => {
    state.statements = [];
    state.failOn = null;
    state.measurementRow = [{ CoreMeasurementID: 42, StemGUID: 7, isValidated: 0 }];
    state.deletedLogEntries = DELETED_LOG_ENTRIES;
    state.retainedIngestionStageEntries = 0;
    state.censusRow = [{ PlotCensusNumber: 1 }];
    state.uploadSessions = [];
    state.scopeLockAcquired = true;
    state.session = { user: { email: EDITOR_EMAIL, userStatus: 'field crew', sites: [{ schemaName: SCHEMA }] } };
    state.freshAuthorization = { userStatus: 'field crew', allowedSites: [{ schemaName: SCHEMA }] };
    vi.stubEnv('AUTH_FUNCTIONS_POLL_URL', AUTH_POLL_URL);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => authorizationEndpointAnswer())
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  describe('fresh authorization (stage 6 finding 4)', () => {
    const noWriteIssued = () => ({
      wrote: state.statements.some(statement => /^(DELETE|UPDATE|INSERT)/.test(statement.sql.trim())),
      committed: manager().commitTransaction.mock.calls.length > 0
    });

    it.each([
      ['demoted to pending since sign-in', { userStatus: 'pending', allowedSites: [{ schemaName: SCHEMA }] }],
      ['demoted to another role since sign-in', { userStatus: 'lead technician', allowedSites: [{ schemaName: SCHEMA }] }],
      ['removed from the site since sign-in', { userStatus: 'field crew', allowedSites: [{ schemaName: 'forestgeo_other' }] }],
      ['removed from the user list since sign-in', null]
    ])('answers a user %s with 401 and changes nothing', async (_label, fresh) => {
      state.freshAuthorization = fresh;
      const response = await post(BODY);
      const body = await response.json();
      console.log('[view-errors clear fresh authorization]', _label, response.status, JSON.stringify(body), JSON.stringify(noWriteIssued()));
      expect(response.status).toBe(HTTPResponses.UNAUTHORIZED);
      expect(body.code).toBe(CLEAR_MEASUREMENT_ERRORS_CODES.sessionExpired);
      expect(noWriteIssued()).toEqual({ wrote: false, committed: false });
      expect(manager().rollbackTransaction).toHaveBeenCalledWith(TRANSACTION_ID);
    });

    it('answers with 401 and changes nothing when the authorization endpoint is not configured', async () => {
      vi.stubEnv('AUTH_FUNCTIONS_POLL_URL', '');
      const response = await post(BODY);
      expect(response.status).toBe(HTTPResponses.UNAUTHORIZED);
      expect(noWriteIssued().wrote).toBe(false);
    });

    it('asks the authorization endpoint for the session email before the first write', async () => {
      const response = await post(BODY);
      expect(response.status).toBe(HTTPResponses.OK);
      expect(vi.mocked(fetch)).toHaveBeenCalledWith(`${AUTH_POLL_URL}?email=${encodeURIComponent(EDITOR_EMAIL)}`, expect.objectContaining({ method: 'GET' }));
    });
  });

  it('clears, rebuilds both views on the same transaction, commits once and reports the count', async () => {
    const response = await post(BODY);
    const body = await response.json();
    const inTransaction = state.statements
      .filter(statement => statement.transactionID === TRANSACTION_ID)
      .map(statement => statement.sql.trim().split(/\s+/).slice(0, 3).join(' '));
    console.log('[view-errors clear route]', response.status, JSON.stringify(body), JSON.stringify(inTransaction));
    expect(response.status).toBe(HTTPResponses.OK);
    expect(body).toEqual({ clearedErrorCount: DELETED_LOG_ENTRIES });
    const lockIndex = state.statements.findIndex(statement => /FOR UPDATE/.test(statement.sql) && /coremeasurements cm/.test(statement.sql));
    const deleteIndex = state.statements.findIndex(statement => /^DELETE mel/.test(statement.sql.trim()));
    const resetIndex = state.statements.findIndex(statement => /SET IsValidated = NULL/.test(statement.sql));
    const summaryRebuildIndex = state.statements.findIndex(statement => /INSERT IGNORE INTO `forestgeo_testing`\.measurementssummary/.test(statement.sql));
    const fullTableRebuildIndex = state.statements.findIndex(statement => /INSERT IGNORE INTO `forestgeo_testing`\.viewfulltable/.test(statement.sql));
    const scopeLockIndex = state.statements.findIndex(statement => statement.sql.startsWith(SCOPE_LOCK_STATEMENT_PREFIX));
    const conflictProbeIndex = state.statements.findIndex(statement => /upload_sessions/.test(statement.sql));
    expect(
      [scopeLockIndex, conflictProbeIndex, lockIndex, deleteIndex, resetIndex, summaryRebuildIndex, fullTableRebuildIndex].every(index => index >= 0)
    ).toBe(true);
    expect(scopeLockIndex < conflictProbeIndex, 'the scope lock is taken before the conflict probe (P2-1)').toBe(true);
    expect(
      conflictProbeIndex < lockIndex &&
        lockIndex < deleteIndex &&
        deleteIndex < resetIndex &&
        resetIndex < summaryRebuildIndex &&
        summaryRebuildIndex < fullTableRebuildIndex
    ).toBe(true);
    expect(manager().acquireApplicationLock).toHaveBeenCalledWith(
      buildMeasurementScopeLockName(SCHEMA, BODY.plotID, BODY.censusID),
      TRANSACTION_ID,
      MEASUREMENT_SCOPE_LOCK_TIMEOUT_MS
    );
    for (const index of [lockIndex, deleteIndex, resetIndex, summaryRebuildIndex, fullTableRebuildIndex]) {
      expect(state.statements[index].transactionID, state.statements[index].sql.slice(0, 60)).toBe(TRANSACTION_ID);
    }
    expect(state.statements[deleteIndex].params).toEqual([42, 'validation', ...INGESTION_STAGE_ERROR_CODES]);
    expect(manager().commitTransaction).toHaveBeenCalledTimes(1);
    expect(manager().rollbackTransaction).not.toHaveBeenCalled();
  });

  it.each([
    ['a missing measurementID', { ...BODY, measurementID: undefined }],
    ['a fractional measurementID', { ...BODY, measurementID: 4.5 }],
    ['a string plotID', { ...BODY, plotID: '1' }],
    ['an extra key', { ...BODY, surprise: true }]
  ])('answers %s with 400 and no SQL beyond the cached schema-quarantine lookup', async (_label, body) => {
    const response = await post(body);
    expect(response.status).toBe(HTTPResponses.BAD_REQUEST);
    expect((await response.json()).code).toBe(CLEAR_MEASUREMENT_ERRORS_CODES.invalidRequest);
    expect(state.statements.filter(statement => !/schema_gate|QuarantinedAt/.test(statement.sql))).toHaveLength(0);
  });

  it("answers a malformed JSON body with the authz wrapper's 400 INVALID_SCHEMA before the handler runs", async () => {
    const response = await post('{"schema":');
    const body = await response.json();
    console.log('[view-errors clear malformed json]', response.status, JSON.stringify(body));
    expect(response.status).toBe(HTTPResponses.BAD_REQUEST);
    expect(body.code).toBe(ROUTE_AUTHZ_INVALID_SCHEMA_CODE);
    expect(manager().beginTransaction).not.toHaveBeenCalled();
  });

  it('answers a held measurement-scope lock with 423 before probing or deleting, and rolls back (P2-1)', async () => {
    state.scopeLockAcquired = false;
    const response = await post(BODY);
    const body = await response.json();
    console.log(
      '[view-errors clear scope lock]',
      response.status,
      JSON.stringify(body),
      JSON.stringify(state.statements.map(statement => statement.sql.slice(0, 40)))
    );
    expect(response.status).toBe(HTTPResponses.LOCKED);
    expect(body.code).toBe(CLEAR_MEASUREMENT_ERRORS_CODES.scopeBusy);
    expect(
      state.statements.some(statement => /upload_sessions|validation_runs/.test(statement.sql)),
      'no conflict probe without the lock'
    ).toBe(false);
    expect(
      state.statements.some(statement => /^DELETE mel/.test(statement.sql.trim())),
      'nothing deleted'
    ).toBe(false);
    expect(manager().rollbackTransaction).toHaveBeenCalledWith(TRANSACTION_ID);
    expect(manager().commitTransaction).not.toHaveBeenCalled();
  });

  it('answers a pending user with 403 and no SQL beyond the cached schema-quarantine lookup', async () => {
    state.session = { user: { email: 'pending@forestgeo.test', userStatus: 'pending', sites: [{ schemaName: SCHEMA }] } };
    const response = await post(BODY);
    expect(response.status).toBe(HTTPResponses.FORBIDDEN);
    expect((await response.json()).code).toBe(CLEAR_MEASUREMENT_ERRORS_CODES.pendingUser);
    expect(manager().beginTransaction).not.toHaveBeenCalled();
  });

  it('answers a plot/census outside the scope with 403', async () => {
    state.censusRow = [];
    const response = await post(BODY);
    expect(response.status).toBe(HTTPResponses.FORBIDDEN);
    expect((await response.json()).code).toBe(CLEAR_MEASUREMENT_ERRORS_CODES.scopeForbidden);
  });

  it('answers an active upload session with 423 and rolls back', async () => {
    state.uploadSessions = [{ session_id: 'upload-1' }];
    const response = await post(BODY);
    expect(response.status).toBe(HTTPResponses.LOCKED);
    expect((await response.json()).code).toBe(CLEAR_MEASUREMENT_ERRORS_CODES.scopeBusy);
    expect(manager().rollbackTransaction).toHaveBeenCalledWith(TRANSACTION_ID);
  });

  it('refuses a failed row (StemGUID NULL) with 409, deletes nothing and rolls back', async () => {
    state.measurementRow = [{ CoreMeasurementID: 42, StemGUID: null }];
    const response = await post(BODY);
    expect(response.status).toBe(HTTPResponses.CONFLICT);
    expect((await response.json()).code).toBe(CLEAR_MEASUREMENT_ERRORS_CODES.failedRow);
    expect(state.statements.some(statement => /^DELETE mel/.test(statement.sql.trim()))).toBe(false);
    expect(manager().rollbackTransaction).toHaveBeenCalledWith(TRANSACTION_ID);
    expect(manager().commitTransaction).not.toHaveBeenCalled();
  });

  it.each([
    ['a row that passed validation (IsValidated 1)', IS_VALIDATED_PASSED],
    ['a row already pending (IsValidated NULL)', null]
  ])('answers %s with nothing logged with 409 NOTHING_TO_CLEAR, sends no UPDATE and rolls back (r3, R2)', async (_label, isValidated) => {
    state.measurementRow = [{ CoreMeasurementID: 42, StemGUID: 7, isValidated }];
    state.deletedLogEntries = 0;
    const response = await post(BODY);
    const body = await response.json();
    const rowLock = state.statements.find(statement => /FOR UPDATE/.test(statement.sql) && /coremeasurements cm/.test(statement.sql));
    console.log(
      '[view-errors clear nothing to clear]',
      response.status,
      JSON.stringify(body),
      JSON.stringify(state.statements.map(statement => statement.sql.trim().slice(0, 40)))
    );
    expect(rowLock?.sql, 'the row lock reads IsValidated as a number (BIT)').toContain('IsValidated + 0');
    expect(response.status).toBe(HTTPResponses.CONFLICT);
    expect(body.code).toBe(CLEAR_MEASUREMENT_ERRORS_CODES.nothingToClear);
    expect(
      state.statements.some(statement => /SET IsValidated = NULL/.test(statement.sql)),
      'a passed or pending row is never reset'
    ).toBe(false);
    expect(
      state.statements.some(statement => /INSERT IGNORE INTO/.test(statement.sql)),
      'no view rebuild'
    ).toBe(false);
    expect(manager().rollbackTransaction).toHaveBeenCalledWith(TRANSACTION_ID);
    expect(manager().commitTransaction).not.toHaveBeenCalled();
  });

  describe('ingestion-stage flags that no validation run can recreate (stage 6 finding 3)', () => {
    const deleteStatement = () => state.statements.find(statement => /^DELETE mel/.test(statement.sql.trim()));
    const resetIssued = () => state.statements.some(statement => /SET IsValidated = NULL/.test(statement.sql));

    it('never deletes an entry carrying code 20 or 21: the DELETE excludes them by code', async () => {
      await post(BODY);
      const statement = deleteStatement();
      console.log('[view-errors clear keeps ingestion stage]', statement?.sql.replace(/\s+/g, ' '), JSON.stringify(statement?.params));
      expect(statement?.sql).toMatch(/me\.ErrorCode NOT IN \(\?, \?\)/);
      expect(statement?.params).toEqual([BODY.measurementID, 'validation', '20', '21']);
    });

    it('clears the other validation errors of a row that also carries code 20, and reports only what it deleted', async () => {
      state.measurementRow = [{ CoreMeasurementID: 42, StemGUID: 7, isValidated: IS_VALIDATED_FAILED }];
      state.deletedLogEntries = 1;
      state.retainedIngestionStageEntries = 1;
      const response = await post(BODY);
      const body = await response.json();
      console.log('[view-errors clear mixed with code 20]', response.status, JSON.stringify(body));
      expect(response.status).toBe(HTTPResponses.OK);
      expect(body).toEqual({ clearedErrorCount: 1 });
      expect(resetIssued(), 'the row goes back to pending so the next run re-checks the cleared rules').toBe(true);
      expect(manager().commitTransaction).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['marked invalid (IsValidated FALSE)', IS_VALIDATED_FAILED],
      ['pending (IsValidated NULL)', null]
    ])('answers a row %s whose only unresolved validation errors are codes 20/21 with 409 NOTHING_TO_CLEAR and resets nothing', async (_label, isValidated) => {
      state.measurementRow = [{ CoreMeasurementID: 42, StemGUID: 7, isValidated }];
      state.deletedLogEntries = 0;
      state.retainedIngestionStageEntries = 1;
      const response = await post(BODY);
      const body = await response.json();
      console.log('[view-errors clear only code 20]', _label, response.status, JSON.stringify(body));
      expect(response.status).toBe(HTTPResponses.CONFLICT);
      expect(body.code).toBe(CLEAR_MEASUREMENT_ERRORS_CODES.nothingToClear);
      expect(resetIssued(), 'IsValidated is not reset: no run could re-flag the row').toBe(false);
      expect(
        state.statements.some(statement => /INSERT IGNORE INTO/.test(statement.sql)),
        'no view rebuild'
      ).toBe(false);
      expect(manager().rollbackTransaction).toHaveBeenCalledWith(TRANSACTION_ID);
      expect(manager().commitTransaction).not.toHaveBeenCalled();
    });

    it('still clears a true fallback row: marked invalid, nothing deleted and no code 20/21 entry kept', async () => {
      state.measurementRow = [{ CoreMeasurementID: 42, StemGUID: 7, isValidated: IS_VALIDATED_FAILED }];
      state.deletedLogEntries = 0;
      state.retainedIngestionStageEntries = 0;
      const response = await post(BODY);
      expect(response.status).toBe(HTTPResponses.OK);
      expect(await response.json()).toEqual({ clearedErrorCount: 0 });
      expect(resetIssued()).toBe(true);
    });
  });

  it('still clears a fallback row (IsValidated FALSE, nothing logged) and reports 0 (r3, R2)', async () => {
    state.measurementRow = [{ CoreMeasurementID: 42, StemGUID: 7, isValidated: IS_VALIDATED_FAILED }];
    state.deletedLogEntries = 0;
    const response = await post(BODY);
    const body = await response.json();
    console.log('[view-errors clear fallback]', response.status, JSON.stringify(body));
    expect(response.status).toBe(HTTPResponses.OK);
    expect(body).toEqual({ clearedErrorCount: 0 });
    expect(
      state.statements.some(statement => /SET IsValidated = NULL/.test(statement.sql)),
      'the fallback row goes back to pending'
    ).toBe(true);
    expect(manager().commitTransaction).toHaveBeenCalledTimes(1);
  });

  it('answers a row outside the plot/census with 404 and rolls back', async () => {
    state.measurementRow = [];
    const response = await post(BODY);
    expect(response.status).toBe(HTTPResponses.NOT_FOUND);
    expect((await response.json()).code).toBe(CLEAR_MEASUREMENT_ERRORS_CODES.notInScope);
    expect(manager().rollbackTransaction).toHaveBeenCalledWith(TRANSACTION_ID);
  });

  it('answers a database failure with the fixed 500, rolls back, and keeps the exception text out of the body', async () => {
    state.failOn = /SET IsValidated = NULL/;
    const response = await post(BODY);
    const text = await response.text();
    expect(response.status).toBe(HTTPResponses.INTERNAL_SERVER_ERROR);
    expect(JSON.parse(text).code).toBe(CLEAR_MEASUREMENT_ERRORS_CODES.failed);
    expect(text).not.toContain('secret detail');
    expect(manager().rollbackTransaction).toHaveBeenCalledWith(TRANSACTION_ID);
    expect(manager().commitTransaction).not.toHaveBeenCalled();
  });
});
