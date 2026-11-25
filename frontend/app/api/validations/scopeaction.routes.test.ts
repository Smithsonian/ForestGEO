import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { HTTPResponses } from '@/config/macros';
import { INTERNAL_SERVER_ERROR_MESSAGE } from '@/lib/errorhelpers';
import { buildMeasurementScopeLockName, MEASUREMENT_SCOPE_LOCK_TIMEOUT_MS } from '@/config/measurementscopelock';
import { buildMeasurementOverrideEligibleSql } from '@/config/measurementstatefilters';
import { TRANSACTION_COMMIT_OUTCOME_UNKNOWN_CODE, TransactionCommitOutcomeUnknownError } from '@/lib/db/transactionerrors';
import {
  VALIDATION_OVERRIDE_ENDPOINT,
  VALIDATION_RESET_ENDPOINT,
  VALIDATION_SCOPE_ACTION_CODES,
  VALIDATION_SCOPE_BUSY_MESSAGE,
  VALIDATION_SCOPE_SUMMARY_KIND
} from '@/config/validationscopeactions';

const AUTH_POLL_URL = 'https://auth.forestgeo.test/poll';
const ADMIN_EMAIL = 'admin@forestgeo.test';
const TRANSACTION_ID = 'tx-validation-scope';
const SCHEMA = 'forestgeo_testing';
const ESCAPED_SCHEMA = '`forestgeo_testing`';
const OTHER_SCHEMA = 'forestgeo_other';
const PLOT_ID = 3;
const CENSUS_ID = 11;
const BODY = { schema: SCHEMA, plotID: PLOT_ID, censusID: CENSUS_ID };
const ROUTE_CONTEXT = { params: Promise.resolve({}) };
const SCOPE_LOCK_STATEMENT_PREFIX = 'GET_LOCK ';
const SKIP_CHANGELOG_MARKER = '/* skip_changelog */';
const VALIDATION_SOURCE = 'validation';
/** lib/route-authz.ts: fromBody turns an unparseable body into a missing schema before the handler runs. */
const ROUTE_AUTHZ_INVALID_SCHEMA_CODE = 'INVALID_SCHEMA';
const DB_FAILURE_DETAIL = 'ER_LOCK_DEADLOCK secret detail';

const PREVIOUS_COUNTS = { PassedCount: 0, FailedCount: 4, PendingCount: 2 };
const OVERRIDDEN_ERROR_COUNTS = [
  { ErrorCode: '14', ErrorCount: 3 },
  { ErrorCode: '19', ErrorCount: 1 }
];
const DELETED_VALIDATION_ERRORS = 4;
const UPDATED_MEASUREMENTS = 6;
const RESOLVED_VALIDATION_ERRORS = 5;

const state = vi.hoisted(() => ({
  session: null as Record<string, unknown> | null,
  censusRow: [] as Array<Record<string, unknown>>,
  pinnedCensus: [] as Array<Record<string, unknown>>,
  uploadSessions: [] as Array<Record<string, unknown>>,
  validationRuns: [] as Array<Record<string, unknown>>,
  previousCounts: {} as Record<string, number>,
  scopeLockAcquired: true,
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
      if (/FROM `forestgeo_testing`\.census WHERE .* FOR SHARE/.test(sql)) return state.pinnedCensus;
      if (/upload_sessions/.test(sql)) return state.uploadSessions;
      if (/validation_runs/.test(sql)) return state.validationRuns;
      if (/AS PassedCount/.test(sql)) return [state.previousCounts];
      if (/GROUP BY me\.ErrorCode/.test(sql)) return OVERRIDDEN_ERROR_COUNTS;
      if (/DELETE mel/.test(sql)) return { affectedRows: DELETED_VALIDATION_ERRORS };
      if (/UPDATE `forestgeo_testing`\.measurement_error_log/.test(sql)) return { affectedRows: RESOLVED_VALIDATION_ERRORS };
      if (/UPDATE `forestgeo_testing`\.coremeasurements/.test(sql)) return { affectedRows: UPDATED_MEASUREMENTS };
      if (/unifiedchangelog/.test(sql)) return { affectedRows: 1 };
      return [];
    }),
    beginTransaction: vi.fn(async () => 'tx-validation-scope'),
    // Recorded as a statement so the order checks can prove the lock precedes the busy probe.
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
import { POST as overridePOST } from './override/route';
import { POST as resetPOST } from './reset/route';

type RoutePOST = typeof overridePOST;

const ROUTES: ReadonlyArray<{ name: string; endpoint: string; post: RoutePOST }> = [
  { name: 'override', endpoint: VALIDATION_OVERRIDE_ENDPOINT, post: overridePOST },
  { name: 'reset', endpoint: VALIDATION_RESET_ENDPOINT, post: resetPOST }
];

function manager() {
  return ConnectionManager.getInstance() as unknown as Record<
    'beginTransaction' | 'acquireApplicationLock' | 'commitTransaction' | 'rollbackTransaction' | 'executeQuery',
    ReturnType<typeof vi.fn>
  >;
}

function authorizationEndpointAnswer(): Response {
  if (state.freshAuthorization === null) return new Response(null, { status: HTTPResponses.NOT_FOUND });
  return new Response(JSON.stringify(state.freshAuthorization), { status: HTTPResponses.OK });
}

function send(post: RoutePOST, endpoint: string, body: unknown) {
  return post(
    new NextRequest(`http://localhost${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body)
    }),
    ROUTE_CONTEXT
  );
}

function writeStatements() {
  return state.statements.filter(statement => /^(\/\* skip_changelog \*\/\s*)?(DELETE|UPDATE|INSERT)/.test(statement.sql.trim()));
}

function statementSummary() {
  return state.statements.map(statement => statement.sql.replace(/\s+/g, ' ').slice(0, 70));
}

function indexOf(pattern: RegExp): number {
  return state.statements.findIndex(statement => pattern.test(statement.sql));
}

beforeEach(() => {
  state.session = { user: { email: ADMIN_EMAIL, userStatus: 'global', sites: [] } };
  state.censusRow = [{ PlotCensusNumber: 1 }];
  state.pinnedCensus = [{ CensusID: CENSUS_ID }];
  state.uploadSessions = [];
  state.validationRuns = [];
  state.previousCounts = { ...PREVIOUS_COUNTS };
  state.scopeLockAcquired = true;
  state.freshAuthorization = { userStatus: 'global', allowedSites: [] };
  state.failOn = null;
  state.statements = [];
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

describe.each(ROUTES)('POST $endpoint (shared census-scope guard)', ({ name, endpoint, post }) => {
  it('denies a schema outside the caller site scope with 403 and runs no SQL at all', async () => {
    state.session = { user: { email: 'crew@forestgeo.test', userStatus: 'field crew', sites: [{ schemaName: OTHER_SCHEMA }] } };
    const response = await send(post, endpoint, BODY);
    console.log(`[${name} out-of-scope]`, response.status, JSON.stringify(statementSummary()));
    expect(response.status).toBe(HTTPResponses.FORBIDDEN);
    expect(state.statements, 'withRouteAuthz refuses before the handler or the quarantine lookup').toEqual([]);
    expect(manager().beginTransaction).not.toHaveBeenCalled();
  });

  it('refuses a site member who is not an admin with 403 ADMIN_REQUIRED, as /api/query refused their write SQL', async () => {
    state.session = { user: { email: 'lead@forestgeo.test', userStatus: 'lead technician', sites: [{ schemaName: SCHEMA }] } };
    const response = await send(post, endpoint, BODY);
    const body = await response.json();
    console.log(`[${name} non-admin]`, response.status, JSON.stringify(body), JSON.stringify(statementSummary()));
    expect(response.status).toBe(HTTPResponses.FORBIDDEN);
    expect(body.code).toBe(VALIDATION_SCOPE_ACTION_CODES.adminRequired);
    expect(manager().beginTransaction).not.toHaveBeenCalled();
    expect(writeStatements()).toEqual([]);
  });

  it.each([
    ['a missing censusID', { schema: SCHEMA, plotID: PLOT_ID }],
    ['a string plotID', { ...BODY, plotID: String(PLOT_ID) }],
    ['a zero censusID', { ...BODY, censusID: 0 }],
    ['a fractional plotID', { ...BODY, plotID: 1.5 }],
    ['an unexpected field (client SQL is not accepted)', { ...BODY, query: 'UPDATE coremeasurements SET IsValidated = TRUE' }]
  ])('answers %s with 400 before opening a transaction', async (_label, body) => {
    const response = await send(post, endpoint, body);
    const responseBody = await response.json();
    console.log(`[${name} 400]`, _label, response.status, JSON.stringify(responseBody));
    expect(response.status).toBe(HTTPResponses.BAD_REQUEST);
    expect(responseBody.code).toBe(VALIDATION_SCOPE_ACTION_CODES.invalidRequest);
    expect(manager().beginTransaction).not.toHaveBeenCalled();
  });

  it("answers a malformed JSON body with the authz wrapper's 400 INVALID_SCHEMA", async () => {
    const response = await send(post, endpoint, '{"schema":');
    const body = await response.json();
    expect(response.status).toBe(HTTPResponses.BAD_REQUEST);
    expect(body.code).toBe(ROUTE_AUTHZ_INVALID_SCHEMA_CODE);
    expect(manager().beginTransaction).not.toHaveBeenCalled();
  });

  it('answers a census that is not a census of the plot with 403 before opening a transaction', async () => {
    state.censusRow = [];
    const response = await send(post, endpoint, BODY);
    expect(response.status).toBe(HTTPResponses.FORBIDDEN);
    expect((await response.json()).code).toBe(VALIDATION_SCOPE_ACTION_CODES.scopeForbidden);
    expect(manager().beginTransaction).not.toHaveBeenCalled();
  });

  it('answers 403 and rolls back when the census stops being an active census of the plot before the lock is held', async () => {
    state.pinnedCensus = [];
    const response = await send(post, endpoint, BODY);
    console.log(`[${name} census gone]`, response.status, JSON.stringify(statementSummary()));
    expect(response.status).toBe(HTTPResponses.FORBIDDEN);
    expect(writeStatements()).toEqual([]);
    expect(manager().rollbackTransaction).toHaveBeenCalledWith(TRANSACTION_ID);
  });

  it('answers a held measurement-scope lock with 423 before probing or writing, and rolls back', async () => {
    state.scopeLockAcquired = false;
    const response = await send(post, endpoint, BODY);
    const body = await response.json();
    console.log(`[${name} lock held]`, response.status, JSON.stringify(body), JSON.stringify(statementSummary()));
    expect(response.status).toBe(HTTPResponses.LOCKED);
    expect(body).toEqual({ error: VALIDATION_SCOPE_BUSY_MESSAGE, code: VALIDATION_SCOPE_ACTION_CODES.scopeBusy });
    expect(indexOf(/upload_sessions|validation_runs/), 'no busy probe without the lock').toBe(-1);
    expect(writeStatements()).toEqual([]);
    expect(manager().rollbackTransaction).toHaveBeenCalledWith(TRANSACTION_ID);
    expect(manager().commitTransaction).not.toHaveBeenCalled();
  });

  it.each([
    ['an active upload session', () => (state.uploadSessions = [{ session_id: 'upload-1' }])],
    ['a running validation run', () => (state.validationRuns = [{ RunID: 9, StartedAt: new Date().toISOString() }])]
  ])('answers %s with 423, writes nothing and rolls back', async (_label, makeBusy) => {
    makeBusy();
    const response = await send(post, endpoint, BODY);
    const body = await response.json();
    console.log(`[${name} busy]`, _label, response.status, JSON.stringify(body), JSON.stringify(statementSummary()));
    expect(response.status).toBe(HTTPResponses.LOCKED);
    expect(body.code).toBe(VALIDATION_SCOPE_ACTION_CODES.scopeBusy);
    expect(writeStatements()).toEqual([]);
    expect(manager().rollbackTransaction).toHaveBeenCalledWith(TRANSACTION_ID);
    expect(manager().commitTransaction).not.toHaveBeenCalled();
  });

  it.each([
    ['demoted since sign-in', { userStatus: 'lead technician', allowedSites: [{ schemaName: SCHEMA }] }],
    ['removed from the user list since sign-in', null]
  ])('answers an admin %s with 401 and writes nothing', async (_label, fresh) => {
    state.freshAuthorization = fresh;
    const response = await send(post, endpoint, BODY);
    const body = await response.json();
    console.log(`[${name} fresh authorization]`, _label, response.status, JSON.stringify(body));
    expect(response.status).toBe(HTTPResponses.UNAUTHORIZED);
    expect(body.code).toBe(VALIDATION_SCOPE_ACTION_CODES.sessionExpired);
    expect(writeStatements()).toEqual([]);
    expect(manager().rollbackTransaction).toHaveBeenCalledWith(TRANSACTION_ID);
  });

  it('answers a database failure mid-write with the generic 500, keeps the driver text out of the body, and rolls back', async () => {
    state.failOn = /UPDATE `forestgeo_testing`\.coremeasurements/;
    const response = await send(post, endpoint, BODY);
    const body = await response.json();
    console.log(`[${name} db failure]`, response.status, JSON.stringify(body));
    expect(response.status).toBe(HTTPResponses.INTERNAL_SERVER_ERROR);
    expect(body).toEqual({ error: INTERNAL_SERVER_ERROR_MESSAGE, code: VALIDATION_SCOPE_ACTION_CODES.failed });
    expect(JSON.stringify(body)).not.toContain(DB_FAILURE_DETAIL);
    expect(manager().rollbackTransaction).toHaveBeenCalledWith(TRANSACTION_ID);
    expect(manager().commitTransaction).not.toHaveBeenCalled();
  });

  it('answers a COMMIT whose outcome is unknown with its own code and never rolls back after COMMIT was sent', async () => {
    manager().commitTransaction.mockRejectedValueOnce(new TransactionCommitOutcomeUnknownError(TRANSACTION_ID, 'connection_lost', 30_000));
    const response = await send(post, endpoint, BODY);
    const body = await response.json();
    console.log(`[${name} commit unknown]`, response.status, JSON.stringify(body));
    expect(response.status).toBe(HTTPResponses.INTERNAL_SERVER_ERROR);
    expect(body.code).toBe(TRANSACTION_COMMIT_OUTCOME_UNKNOWN_CODE);
    expect(manager().rollbackTransaction).not.toHaveBeenCalled();
  });

  it('holds the scope lock before the busy probe and runs every write after it, in the one transaction', async () => {
    const response = await send(post, endpoint, BODY);
    console.log(`[${name} order]`, response.status, JSON.stringify(statementSummary()));
    expect(response.status).toBe(HTTPResponses.OK);
    expect(manager().acquireApplicationLock).toHaveBeenCalledWith(
      buildMeasurementScopeLockName(SCHEMA, PLOT_ID, CENSUS_ID),
      TRANSACTION_ID,
      MEASUREMENT_SCOPE_LOCK_TIMEOUT_MS
    );
    const lockIndex = indexOf(new RegExp(`^${SCOPE_LOCK_STATEMENT_PREFIX}`));
    const pinIndex = indexOf(/FOR SHARE/);
    const uploadProbeIndex = indexOf(/upload_sessions/);
    const runProbeIndex = indexOf(/validation_runs/);
    const firstWriteIndex = state.statements.indexOf(writeStatements()[0]);
    expect([lockIndex, pinIndex, uploadProbeIndex, runProbeIndex, firstWriteIndex].every(index => index >= 0)).toBe(true);
    expect(lockIndex < pinIndex && pinIndex < uploadProbeIndex && uploadProbeIndex < runProbeIndex && runProbeIndex < firstWriteIndex).toBe(true);
    expect(vi.mocked(fetch), 'the authority is asked before the first write').toHaveBeenCalledWith(
      `${AUTH_POLL_URL}?email=${encodeURIComponent(ADMIN_EMAIL)}`,
      expect.objectContaining({ method: 'GET' })
    );
    for (const statement of state.statements.slice(lockIndex)) expect(statement.transactionID, statement.sql.slice(0, 60)).toBe(TRANSACTION_ID);
    expect(manager().commitTransaction).toHaveBeenCalledTimes(1);
    expect(manager().rollbackTransaction).not.toHaveBeenCalled();
  });

  it('marks every data write skip_changelog and records exactly one census summary row attributed to the session user', async () => {
    await send(post, endpoint, BODY);
    const writes = writeStatements();
    const dataWrites = writes.filter(statement => !/unifiedchangelog/.test(statement.sql));
    const changelogWrites = writes.filter(statement => /unifiedchangelog/.test(statement.sql));
    console.log(`[${name} changelog]`, JSON.stringify(changelogWrites.map(statement => statement.params)));
    expect(dataWrites.length).toBeGreaterThan(0);
    for (const write of dataWrites) expect(write.sql.trimStart().startsWith(SKIP_CHANGELOG_MARKER), write.sql.slice(0, 60)).toBe(true);
    expect(changelogWrites).toHaveLength(1);
    const [tableName, recordID, operation, , , changedBy, plotID, censusID] = changelogWrites[0].params;
    expect({ tableName, recordID, operation, changedBy, plotID, censusID }).toEqual({
      tableName: 'coremeasurements',
      recordID: `census:${CENSUS_ID}`,
      operation: 'UPDATE',
      changedBy: ADMIN_EMAIL,
      plotID: PLOT_ID,
      censusID: CENSUS_ID
    });
  });

  it('writes nothing and records nothing for a census with no row in scope', async () => {
    state.previousCounts = { PassedCount: 0, FailedCount: 0, PendingCount: 0 };
    const response = await send(post, endpoint, BODY);
    console.log(`[${name} empty]`, response.status, JSON.stringify(statementSummary()));
    expect(response.status).toBe(HTTPResponses.OK);
    expect(writeStatements()).toEqual([]);
  });
});

describe('POST /api/validations/override', () => {
  it('deletes and updates only rows matching the shared override predicate, scoped by census then plot, and reports both counts', async () => {
    const response = await send(overridePOST, VALIDATION_OVERRIDE_ENDPOINT, BODY);
    const body = await response.json();
    const eligible = buildMeasurementOverrideEligibleSql(ESCAPED_SCHEMA, 'cm');
    const deleteStatement = state.statements.find(statement => /DELETE mel/.test(statement.sql));
    const updateStatement = state.statements.find(statement => /UPDATE `forestgeo_testing`\.coremeasurements/.test(statement.sql));
    console.log('[override success]', response.status, JSON.stringify(body), deleteStatement?.params, updateStatement?.params);
    expect(response.status).toBe(HTTPResponses.OK);
    expect(body).toEqual({ overriddenMeasurementCount: UPDATED_MEASUREMENTS, removedValidationErrorCount: DELETED_VALIDATION_ERRORS });
    expect(deleteStatement?.sql).toContain(eligible);
    expect(deleteStatement?.sql).toContain('me.ErrorSource = ?');
    expect(deleteStatement?.params).toEqual([CENSUS_ID, PLOT_ID, VALIDATION_SOURCE]);
    expect(updateStatement?.sql).toContain(eligible);
    expect(updateStatement?.sql).toContain('SET cm.IsValidated = TRUE');
    expect(updateStatement?.params).toEqual([CENSUS_ID, PLOT_ID]);
    expect(indexOf(/DELETE mel/) < indexOf(/UPDATE `forestgeo_testing`\.coremeasurements/), 'logs are deleted while the rows still match').toBe(true);
  });

  it('records the previous IsValidated split and the deleted error codes in the summary row', async () => {
    await send(overridePOST, VALIDATION_OVERRIDE_ENDPOINT, BODY);
    const changelog = state.statements.find(statement => /unifiedchangelog/.test(statement.sql));
    const [oldRowState, newRowState] = [JSON.parse(String(changelog?.params[3])), JSON.parse(String(changelog?.params[4]))];
    console.log('[override summary]', JSON.stringify({ oldRowState, newRowState }));
    expect(oldRowState).toEqual({
      summaryKind: VALIDATION_SCOPE_SUMMARY_KIND.override,
      MeasurementCount: PREVIOUS_COUNTS.FailedCount + PREVIOUS_COUNTS.PendingCount,
      IsValidated: { failed: PREVIOUS_COUNTS.FailedCount, pending: PREVIOUS_COUNTS.PendingCount },
      ValidationErrors: OVERRIDDEN_ERROR_COUNTS.map(row => ({ ErrorCode: row.ErrorCode, Count: row.ErrorCount }))
    });
    expect(newRowState).toEqual({
      summaryKind: VALIDATION_SCOPE_SUMMARY_KIND.override,
      MeasurementCount: UPDATED_MEASUREMENTS,
      IsValidated: { passed: UPDATED_MEASUREMENTS },
      ValidationErrors: []
    });
  });
});

describe('POST /api/validations/reset', () => {
  it('resolves (not deletes) unresolved validation-source entries, then sends every census row to pending, and reports both counts', async () => {
    const response = await send(resetPOST, VALIDATION_RESET_ENDPOINT, BODY);
    const body = await response.json();
    const resolveStatement = state.statements.find(statement => /UPDATE `forestgeo_testing`\.measurement_error_log/.test(statement.sql));
    const pendingStatement = state.statements.find(statement => /UPDATE `forestgeo_testing`\.coremeasurements/.test(statement.sql));
    console.log('[reset success]', response.status, JSON.stringify(body), resolveStatement?.params, pendingStatement?.params);
    expect(response.status).toBe(HTTPResponses.OK);
    expect(body).toEqual({ resetMeasurementCount: UPDATED_MEASUREMENTS, resolvedValidationErrorCount: RESOLVED_VALIDATION_ERRORS });
    expect(indexOf(/DELETE/), 'reset keeps the history').toBe(-1);
    expect(resolveStatement?.sql).toContain('SET mel.IsResolved = TRUE');
    expect(resolveStatement?.sql).toContain('mel.ResolvedAt = NOW()');
    expect(resolveStatement?.sql).toContain('mel.IsResolved = FALSE');
    expect(resolveStatement?.params).toEqual([CENSUS_ID, PLOT_ID, VALIDATION_SOURCE]);
    expect(pendingStatement?.sql).toContain('SET cm.IsValidated = NULL');
    expect(pendingStatement?.params).toEqual([CENSUS_ID, PLOT_ID]);
  });

  it('records the previous IsValidated split and the resolved error count in the summary row', async () => {
    await send(resetPOST, VALIDATION_RESET_ENDPOINT, BODY);
    const changelog = state.statements.find(statement => /unifiedchangelog/.test(statement.sql));
    const [oldRowState, newRowState] = [JSON.parse(String(changelog?.params[3])), JSON.parse(String(changelog?.params[4]))];
    console.log('[reset summary]', JSON.stringify({ oldRowState, newRowState }));
    expect(oldRowState).toEqual({
      summaryKind: VALIDATION_SCOPE_SUMMARY_KIND.reset,
      MeasurementCount: PREVIOUS_COUNTS.PassedCount + PREVIOUS_COUNTS.FailedCount + PREVIOUS_COUNTS.PendingCount,
      IsValidated: { passed: PREVIOUS_COUNTS.PassedCount, failed: PREVIOUS_COUNTS.FailedCount, pending: PREVIOUS_COUNTS.PendingCount },
      UnresolvedValidationErrorCount: RESOLVED_VALIDATION_ERRORS
    });
    expect(newRowState).toEqual({
      summaryKind: VALIDATION_SCOPE_SUMMARY_KIND.reset,
      MeasurementCount: UPDATED_MEASUREMENTS,
      IsValidated: { pending: UPDATED_MEASUREMENTS },
      UnresolvedValidationErrorCount: 0
    });
  });
});
