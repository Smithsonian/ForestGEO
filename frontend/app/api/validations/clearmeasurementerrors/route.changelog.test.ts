// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { HTTPResponses } from '@/config/macros';
import { CLEAR_MEASUREMENT_ERRORS_CODES } from '@/config/errorsexplorer';

const AUTH_POLL_URL = 'https://auth.forestgeo.test/poll';
const TRANSACTION_ID = 'tx-clear-audit';
const REQUEST_BODY = { schema: 'forestgeo_testing', plotID: 1, censusID: 5, measurementID: 42 };
const SIGNED_IN_EMAIL = 'signed-in.editor@forestgeo.test';
const COOKIE_SCOPE = { schema: 'forestgeo_other_site', plotID: '77', censusID: '4', user: 'cookie.user@forestgeo.test' };
const IS_VALIDATED_FAILED = 0;
const CHANGELOG_FLUSH_SETTLE_MS = 20;
const CHANGELOG_INSERT_PATTERN = /INSERT INTO `forestgeo_testing`\.unifiedchangelog/;
const VALIDATION_ERROR_READ_PATTERN = /SELECT me\.ErrorCode/;
const DELETE_PATTERN = /^DELETE mel/;
const ROUTE_CONTEXT = { params: Promise.resolve({}) };

const removedValidationErrors = [
  { ErrorCode: '14', ErrorMessage: 'Measurement date falls outside the census range' },
  { ErrorCode: '7', ErrorMessage: 'DBH is below the species minimum' }
];

const state = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
  statements: [] as Array<{ sql: string; params: unknown[]; transactionID?: string }>,
  failOn: null as RegExp | null,
  readErrors: [] as Array<{ ErrorCode: string; ErrorMessage: string }>
}));

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { email: 'signed-in.editor@forestgeo.test', userStatus: 'global', sites: [] } }))
}));
vi.mock('@/ailogger', () => ({ default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    has: (name: string) => state.cookies.has(name),
    get: (name: string) => (state.cookies.has(name) ? { value: state.cookies.get(name) } : undefined)
  })
}));
vi.mock('@/lib/db/connectionmanager', async () => {
  const { patchConnectionManager, flushTransactionChangelog, discardTransactionChangelog } = await import('@/lib/connectionlogger');
  const manager = {
    executeQuery: vi.fn(async (sql: string, params: unknown[] = [], transactionID?: string) => {
      state.statements.push({ sql, params, transactionID });
      if (state.failOn?.test(sql)) throw new Error('ER_DATA_TOO_LONG secret detail');
      if (/FROM `forestgeo_testing`\.census c/.test(sql)) return [{ PlotCensusNumber: 1 }];
      if (/upload_sessions|validation_runs/.test(sql)) return [];
      if (/FOR UPDATE/.test(sql) && /coremeasurements cm/.test(sql)) return [{ CoreMeasurementID: 42, StemGUID: 7, isValidated: 0 }];
      if (/SELECT me\.ErrorCode/.test(sql)) return state.readErrors;
      if (/^DELETE mel/.test(sql.trim())) return { affectedRows: state.readErrors.length };
      if (/COUNT\(\*\) AS retainedCount/.test(sql)) return [{ retainedCount: 0 }];
      return { affectedRows: 1 };
    }),
    beginTransaction: vi.fn(async () => TRANSACTION_ID),
    acquireApplicationLock: vi.fn(async () => true),
    commitTransaction: vi.fn(async (transactionID: string) => flushTransactionChangelog(transactionID)),
    rollbackTransaction: vi.fn(async (transactionID: string) => discardTransactionChangelog(transactionID)),
    closeConnection: vi.fn(async () => undefined)
  };
  patchConnectionManager(manager);
  return { default: { getInstance: () => manager } };
});

import ConnectionManager from '@/lib/db/connectionmanager';
import { POST } from './route';

function post() {
  return POST(
    new NextRequest('http://localhost/api/validations/clearmeasurementerrors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(REQUEST_BODY)
    }),
    ROUTE_CONTEXT
  );
}

function manager() {
  return ConnectionManager.getInstance() as unknown as Record<'commitTransaction' | 'rollbackTransaction', ReturnType<typeof vi.fn>>;
}

function indexOfStatement(pattern: RegExp): number {
  return state.statements.findIndex(statement => pattern.test(statement.sql.trim()));
}

function logStatements(label: string) {
  console.log(
    `[clear audit] ${label}`,
    JSON.stringify(state.statements.map(statement => ({ sql: statement.sql.trim().slice(0, 70), tx: statement.transactionID })))
  );
}

describe('POST /api/validations/clearmeasurementerrors records who cleared the row', () => {
  beforeEach(() => {
    state.statements = [];
    state.failOn = null;
    state.readErrors = removedValidationErrors;
    state.cookies = new Map(Object.entries(COOKIE_SCOPE));
    manager().commitTransaction.mockClear();
    manager().rollbackTransaction.mockClear();
    vi.stubEnv('AUTH_FUNCTIONS_POLL_URL', AUTH_POLL_URL);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ userStatus: 'global', allowedSites: [] }), { status: HTTPResponses.OK }))
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('inserts one unifiedchangelog row on the clear transaction after the delete, scoped by the request and attributed to the signed-in user, though the cookies name another site, plot, census and user', async () => {
    const response = await post();
    await new Promise(resolve => setTimeout(resolve, CHANGELOG_FLUSH_SETTLE_MS));
    logStatements('success');

    expect(response.status).toBe(HTTPResponses.OK);
    const changelogInserts = state.statements.filter(statement => CHANGELOG_INSERT_PATTERN.test(statement.sql));
    expect(changelogInserts, 'exactly one audit row: the cookie-scoped logger added none').toHaveLength(1);
    const [audit] = changelogInserts;
    expect(audit.transactionID, 'the audit row shares the clear transaction').toBe(TRANSACTION_ID);
    expect(indexOfStatement(CHANGELOG_INSERT_PATTERN), 'written after the DELETE').toBeGreaterThan(indexOfStatement(DELETE_PATTERN));
    expect(indexOfStatement(VALIDATION_ERROR_READ_PATTERN), 'the removed errors are read before the DELETE').toBeLessThan(indexOfStatement(DELETE_PATTERN));
    expect(manager().commitTransaction).toHaveBeenCalledWith(TRANSACTION_ID);

    const [tableName, recordID, operation, oldRowState, newRowState, changedBy, plotID, censusID] = audit.params;
    expect({ tableName, recordID, operation, changedBy, plotID, censusID }).toEqual({
      tableName: 'coremeasurements',
      recordID: String(REQUEST_BODY.measurementID),
      operation: 'UPDATE',
      changedBy: SIGNED_IN_EMAIL,
      plotID: REQUEST_BODY.plotID,
      censusID: REQUEST_BODY.censusID
    });
    expect(JSON.parse(String(oldRowState))).toEqual({ IsValidated: IS_VALIDATED_FAILED, ValidationErrors: removedValidationErrors });
    expect(JSON.parse(String(newRowState))).toEqual({ IsValidated: null });
    expect(
      state.statements.filter(statement => statement.sql.includes(COOKIE_SCOPE.schema)),
      'nothing is read or written against the cookie schema'
    ).toEqual([]);
  });

  it('writes the audit row before the views are rebuilt and the commit, so a failed audit stops both', async () => {
    await post();
    const auditIndex = indexOfStatement(CHANGELOG_INSERT_PATTERN);
    const rebuildIndex = indexOfStatement(/^INSERT IGNORE INTO `forestgeo_testing`\.measurementssummary/);
    logStatements('ordering');
    expect(auditIndex).toBeGreaterThanOrEqual(0);
    expect(rebuildIndex).toBeGreaterThanOrEqual(0);
    expect(auditIndex).toBeLessThan(rebuildIndex);
  });

  it('records an empty error list for a fallback row that had no logged error', async () => {
    state.readErrors = [];
    await post();
    const audit = state.statements.find(statement => CHANGELOG_INSERT_PATTERN.test(statement.sql));
    expect(JSON.parse(String(audit?.params[3]))).toEqual({ IsValidated: IS_VALIDATED_FAILED, ValidationErrors: [] });
  });

  it('rolls everything back, commits nothing and answers the fixed 500 when the audit insert fails', async () => {
    state.failOn = CHANGELOG_INSERT_PATTERN;
    const response = await post();
    const text = await response.text();
    await new Promise(resolve => setTimeout(resolve, CHANGELOG_FLUSH_SETTLE_MS));
    logStatements('audit insert fails');

    expect(response.status).toBe(HTTPResponses.INTERNAL_SERVER_ERROR);
    expect(JSON.parse(text).code).toBe(CLEAR_MEASUREMENT_ERRORS_CODES.failed);
    expect(text, 'the database text stays out of the body').not.toContain('secret detail');
    expect(manager().rollbackTransaction).toHaveBeenCalledWith(TRANSACTION_ID);
    expect(manager().commitTransaction).not.toHaveBeenCalled();
    expect(indexOfStatement(/^INSERT IGNORE INTO `forestgeo_testing`\.measurementssummary/), 'no view rebuild after a failed audit').toBe(-1);
  });
});
