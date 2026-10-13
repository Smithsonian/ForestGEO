import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HTTPResponses } from '@/config/macros';
import {
  BULK_INGESTION_CALL_TEMPLATE,
  CALLER_OWNS_TRANSACTION_SQL,
  CLEAR_CALLER_TRANSACTION_SQL,
  FLAG_CLEAR_FAILED_REASON
} from '@/lib/ingestion/bulk-ingestion-call';
import { POST } from './route';
// Real (unmocked) error classes: route.ts imports these directly from
// tree-species-correction-writer.ts, which this file never mocks. Using the
// genuine classes (not stand-ins) is what makes the route's `instanceof`
// branches actually exercised here.
import { SpeciesCorrectionTransactionMismatchError, SpeciesCorrectionWriteConflictError } from '@/config/editplan/tree-species-correction-writer';
import { SpeciesCorrectionGroupMemberContextError } from '@/config/editplan/writers/measurementssummary';

const REVISION_TRANSACTION_ID = 'tx-1';
const MATCHED_PLAN_HASH = 'plan-hash-matched';
const DRIFTED_PLAN_HASH = 'plan-hash-drifted';

const mocks = vi.hoisted(() => {
  class MockPendingUserEditForbiddenError extends Error {}
  class MockRoleForbiddenFieldError extends Error {
    fields: string[];
    role: string;
    constructor(fields: string[], role = 'field crew') {
      super(`role ${role} cannot edit fields: ${fields.join(',')}`);
      this.fields = fields;
      this.role = role;
    }
  }

  class MockBulkPlanUnapplicableError extends Error {
    blockingErrors: unknown[];
    constructor(blockingErrors: unknown[]) {
      super(`Bulk edit plan has ${blockingErrors.length} blocking error(s)`);
      this.name = 'BulkPlanUnapplicableError';
      this.blockingErrors = blockingErrors;
    }
  }

  class MockMeasurementResolutionError extends Error {
    subject: string;
    reason: string;
    constructor(subject: string, reason: string, message: string) {
      super(message);
      this.name = 'MeasurementResolutionError';
      this.subject = subject;
      this.reason = reason;
    }
  }
  const assertAuthorizationFresh = vi.fn(async () => undefined);
  return {
    auth: vi.fn(),
    isValidSchema: vi.fn(() => true),
    safeFormatQuery: vi.fn((_schema: string, query: string) => query),
    loggerInfo: vi.fn(),
    loggerWarn: vi.fn(),
    loggerError: vi.fn(),
    ensureUploadSessionsTable: vi.fn(),
    withTransaction: vi.fn(async (fn: (tx: { query: (sql: string, params?: unknown[]) => Promise<unknown>; id: string }) => Promise<unknown>) =>
      fn({ query: (sql: string, params?: unknown[]) => mocks.executeQuery(sql, params), id: 'tx-1' })
    ),
    acquireApplicationLock: vi.fn(async () => true),
    executeQuery: vi.fn<(...args: any[]) => Promise<any>>(async () => []),
    closeConnection: vi.fn(async () => undefined),
    discardTransaction: vi.fn(),
    buildMeasurementScopeLockName: vi.fn((schema: string, plotID: number, censusID: number) => `measurement-scope:${schema}:${plotID}:${censusID}`),
    refreshMeasurementViewsForScope: vi.fn(async () => undefined),
    assertCanEditMeasurementScope: vi.fn(async () => undefined),
    writeEditOperation: vi.fn(async () => 1),
    ensureEditOperationsTable: vi.fn(async () => undefined),
    MockScopeAccessError: class MockScopeAccessError extends Error {},
    MockScopeBusyError: class MockScopeBusyError extends Error {},
    MockScopeLockHeldError: class MockScopeLockHeldError extends Error {},
    MockPendingUserEditForbiddenError,
    MockSessionExpiredError: class MockSessionExpiredError extends Error {},
    MockRoleForbiddenFieldError,
    assertAuthorizationFresh,
    assertSessionMayEdit: vi.fn((session: any) => {
      if (session?.user?.userStatus === 'pending') throw new MockPendingUserEditForbiddenError();
    }),
    createFreshAuthorizationCheck: vi.fn(() => assertAuthorizationFresh),
    applyEditInTransaction: vi.fn(async () => ({
      updatedIDs: { CoreMeasurementID: 0 },
      applyErrors: [],
      editOperationID: null,
      validationPending: true
    })),
    analyzeBulk: vi.fn(async () => ({
      dataType: 'measurementssummary',
      rowCount: 0,
      rowPlans: [],
      aggregateEffects: [],
      maxSeverity: 'info',
      planHash: 'hash-not-mocked',
      generatedAt: '2026-04-21T00:00:00Z',
      duplicateDeletions: []
    })),
    assertBulkPlanCanApply: vi.fn(),
    MockBulkPlanUnapplicableError,
    MockMeasurementResolutionError,
    // #427 bulk species-correction prepare/apply: mocked here (not the route's
    // real group-partition/membership logic, which lives in route.ts itself
    // and is exercised directly) so these tests control exactly what each
    // group's prepare/apply phase returns or throws, without re-implementing
    // prepareTreeSpeciesCorrection's real locked-replan machinery.
    prepareBulkSpeciesCorrections: vi.fn<(...args: any[]) => Promise<any>>(),
    applyPreparedBulkSpeciesCorrections: vi.fn<(...args: any[]) => Promise<any>>()
  };
});

vi.mock('@/auth', () => ({
  auth: mocks.auth
}));

vi.mock('@/lib/db/sqlsecurity', () => ({
  isValidSchema: mocks.isValidSchema,
  safeFormatQuery: mocks.safeFormatQuery
}));

vi.mock('@/config/uploadsessiontracker', () => ({
  ACTIVE_UPLOAD_SESSION_STATES: ['initialized', 'uploading', 'uploaded', 'processing', 'collapsing'],
  ensureUploadSessionsTable: mocks.ensureUploadSessionsTable,
  SESSION_TIMEOUTS: {
    HEARTBEAT_TIMEOUT: 30_000
  }
}));

vi.mock('@/config/measurementscopelock', () => ({
  buildMeasurementScopeLockName: mocks.buildMeasurementScopeLockName,
  MEASUREMENT_SCOPE_LOCK_TIMEOUT_MS: 0
}));

vi.mock('@/config/utils', () => ({
  generateShortBatchID: vi.fn(() => 'batch-1')
}));

vi.mock('@/lib/db/connectionmanager', () => ({
  default: {
    getInstance: () => ({
      withTransaction: mocks.withTransaction,
      acquireApplicationLock: mocks.acquireApplicationLock,
      executeQuery: mocks.executeQuery,
      closeConnection: mocks.closeConnection,
      discardTransaction: mocks.discardTransaction
    })
  }
}));

vi.mock('@/lib/measurementviewrefresh', () => ({
  refreshMeasurementViewsForScope: mocks.refreshMeasurementViewsForScope
}));

vi.mock('@/config/editplan/apply', () => ({
  applyEditInTransaction: mocks.applyEditInTransaction,
  ScopeLockHeldError: mocks.MockScopeLockHeldError,
  SessionExpiredError: mocks.MockSessionExpiredError
}));

vi.mock('@/config/editplan/bulkanalyzer', async importOriginal => {
  const actual = await importOriginal<typeof import('@/config/editplan/bulkanalyzer')>();
  return {
    ...actual,
    analyzeBulk: mocks.analyzeBulk,
    assertBulkPlanCanApply: mocks.assertBulkPlanCanApply,
    BulkPlanUnapplicableError: mocks.MockBulkPlanUnapplicableError
  };
});

vi.mock('@/config/editplan/writers/resolvers-mutating', () => ({
  MeasurementResolutionError: mocks.MockMeasurementResolutionError
}));

// Only prepareBulkSpeciesCorrections/applyPreparedBulkSpeciesCorrections are
// mocked here. Every error class is re-exported from the real module via
// importOriginal, so the route's own `instanceof` classification (BulkSpecies-
// CorrectionInputError / ...UnresolvedMeasurementError / ...ApplyScopeMismatchError)
// keeps working against instances these tests construct directly.
vi.mock('@/config/editplan/bulk-species-correction-writer', async importOriginal => {
  const actual = await importOriginal<typeof import('@/config/editplan/bulk-species-correction-writer')>();
  return {
    ...actual,
    prepareBulkSpeciesCorrections: mocks.prepareBulkSpeciesCorrections,
    applyPreparedBulkSpeciesCorrections: mocks.applyPreparedBulkSpeciesCorrections
  };
});

vi.mock('@/config/editplan/analyzer', () => ({
  RoleForbiddenFieldError: mocks.MockRoleForbiddenFieldError
}));

vi.mock('@/config/editplan/authorization', () => ({
  assertSessionMayEdit: mocks.assertSessionMayEdit,
  createFreshAuthorizationCheck: mocks.createFreshAuthorizationCheck,
  PendingUserEditForbiddenError: mocks.MockPendingUserEditForbiddenError
}));

vi.mock('@/config/editplan/scopeguard', () => ({
  assertCanEditMeasurementScope: mocks.assertCanEditMeasurementScope,
  ScopeAccessError: mocks.MockScopeAccessError,
  ScopeBusyError: mocks.MockScopeBusyError
}));

vi.mock('@/config/editoperations', () => ({
  writeEditOperation: mocks.writeEditOperation,
  ensureEditOperationsTable: mocks.ensureEditOperationsTable
}));

vi.mock('@/ailogger', () => ({
  default: {
    info: mocks.loggerInfo,
    warn: mocks.loggerWarn,
    error: mocks.loggerError
  }
}));

function buildRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/revisionupload/apply', {
    method: 'POST',
    body: JSON.stringify(body)
  }) as any;
}

function buildValidBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    matchedRows: [],
    newRows: [],
    confirmNewRows: false,
    schema: 'forestgeo_testing',
    plotID: 1,
    censusID: 2,
    bulkPlanHash: MATCHED_PLAN_HASH,
    ...overrides
  };
}

/**
 * Mock DB row in the ExistingMeasurementRow shape that loadMeasurementsByCoreID
 * returns. Defaults to a fully resolvable row in plot 1, with field values
 * unlikely to collide with the CSV values used in the tests so that
 * computeDiff actually surfaces the asserted edits. Override per-test to
 * exercise no-op (csvValue equals dbValue) and active-state cases.
 */
function buildDbRow(coreMeasurementID: number, overrides: Record<string, unknown> = {}) {
  return {
    CoreMeasurementID: coreMeasurementID,
    StemGUID: coreMeasurementID,
    IsActive: 1,
    MeasuredDBH: 1.0,
    MeasuredHOM: 0.5,
    MeasurementDate: '2025-01-01',
    RawCodes: null,
    Description: null,
    RawTreeTag: 'T',
    RawStemTag: 'S',
    StemIsActive: 1,
    TreeIsActive: 1,
    QuadratIsActive: 1,
    PlotID: 1,
    TreeTag: 'T',
    StemTag: 'S',
    SpeciesCode: 'AAA',
    QuadratName: 'Q',
    LocalX: 0,
    LocalY: 0,
    StemPlotX: null,
    StemPlotY: null,
    ...overrides
  };
}

function buildFreshPlan(planHash: string, overrides: Record<string, unknown> = {}) {
  return {
    dataType: 'measurementssummary',
    rowCount: 1,
    rowPlans: [],
    aggregateEffects: [],
    maxSeverity: 'info',
    planHash,
    generatedAt: '2026-04-21T00:00:00Z',
    duplicateDeletions: [],
    ...overrides
  };
}

// --- #427 bulk species-correction fixtures -------------------------------
// The route indexes a group member's rowPlan by `rowPlan.rowIndex` (a Map,
// not array position) and requires `rowPlan.plan` to be truthy before it
// will build that member's BulkSpeciesCorrectionMemberInput. Since
// prepareBulkSpeciesCorrections/applyPreparedBulkSpeciesCorrections are
// mocked below, these EditPlan stubs only need to be real enough to satisfy
// that truthiness/targetID check — their field-level content is irrelevant
// because no real writer ever reads it in these tests.
function buildGroupMemberPlan(targetID: number): Record<string, unknown> {
  return {
    dataType: 'measurementssummary',
    targetID,
    fieldChanges: [{ field: 'SpeciesCode', from: 'AAA', to: 'BBB' }],
    effects: [],
    maxSeverity: 'info',
    planHash: `member-plan-${targetID}`,
    generatedAt: '2026-04-21T00:00:00Z'
  };
}

// For a group member whose own diff is empty (rowPlan status 'unchanged'):
// no fieldChanges and no `speciesCorrection`, matching what the real
// analyzer actually produces for a zero-change row.
function buildUnchangedGroupMemberPlan(targetID: number): Record<string, unknown> {
  return {
    dataType: 'measurementssummary',
    targetID,
    fieldChanges: [],
    effects: [],
    maxSeverity: 'info',
    planHash: `member-plan-unchanged-${targetID}`,
    generatedAt: '2026-04-21T00:00:00Z'
  };
}

const SPECIES_GROUP_TREE_ID = 909;
const SPECIES_GROUP_CENSUS_ID = 2;

function buildSpeciesCorrectionGroup(members: Array<{ rowIndex: number; coreMeasurementID: number; requestedCorrection: boolean }>): Record<string, unknown> {
  return {
    version: 1,
    treeID: SPECIES_GROUP_TREE_ID,
    censusID: SPECIES_GROUP_CENSUS_ID,
    correction: {
      version: 1,
      targetTreeID: SPECIES_GROUP_TREE_ID,
      treeTag: 'T',
      plotID: 1,
      censusID: SPECIES_GROUP_CENSUS_ID,
      oldSpeciesID: 1,
      oldSpeciesCode: 'AAA',
      newSpeciesID: 2,
      newSpeciesCode: 'BBB',
      activeStemCount: 1,
      inactiveStemCount: 0,
      activeMeasurementCount: members.length,
      inactiveMeasurementCount: 0,
      stems: [],
      measurements: []
    },
    members,
    affectedCoreMeasurementIDs: members.map(m => m.coreMeasurementID),
    affectedStemGUIDs: []
  };
}

// Mirrors the two FIXED, unexported `code` constants route.ts attaches to
// every #427 species-correction error response (F34) — redefined here
// because the route does not export them, exactly like this file already
// redefines the route's literal response shapes elsewhere (e.g. 'role
// forbidden field').
const SPECIES_CORRECTION_CONFLICT_CODE = 'species-correction-conflict';
const SPECIES_CORRECTION_SERVER_FAILURE_CODE = 'species-correction-server-failure';

// Sentinel "obviously sensitive" substrings embedded in mocked errors below,
// to prove the response body never contains raw internals (F34).
const SENSITIVE_SQL_FRAGMENT = 'UPDATE forestgeo_testing.trees SET SpeciesID';
const SENSITIVE_REASON_TOKEN = 'ER_DUP_ENTRY-1062-unique-constraint';
const SENSITIVE_CORE_MEASUREMENT_ID = 918273;
const SENSITIVE_TRANSACTION_ID_PREPARED = 'txn-secret-prepared-55512';
const SENSITIVE_TRANSACTION_ID_APPLY = 'txn-secret-apply-99981';

describe('POST /api/revisionupload/apply', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.auth.mockResolvedValue({ user: { name: 'Mason', email: 'mason@example.com', userStatus: 'global', sites: [] } });
    mocks.isValidSchema.mockReturnValue(true);
    mocks.ensureUploadSessionsTable.mockResolvedValue(undefined);
    mocks.withTransaction.mockImplementation(
      async (fn: (tx: { query: (sql: string, params?: unknown[]) => Promise<unknown>; id: string }) => Promise<unknown>) =>
        fn({ query: (sql: string, params?: unknown[]) => mocks.executeQuery(sql, params), id: 'tx-1' })
    );
    mocks.acquireApplicationLock.mockResolvedValue(true);
    mocks.executeQuery.mockResolvedValue([]);
    mocks.closeConnection.mockResolvedValue(undefined);
    mocks.refreshMeasurementViewsForScope.mockResolvedValue(undefined);
    mocks.assertCanEditMeasurementScope.mockResolvedValue(undefined);
    mocks.writeEditOperation.mockResolvedValue(1);
    mocks.assertSessionMayEdit.mockImplementation((session: any) => {
      if (session?.user?.userStatus === 'pending') throw new mocks.MockPendingUserEditForbiddenError();
    });
    mocks.createFreshAuthorizationCheck.mockReturnValue(mocks.assertAuthorizationFresh);
    mocks.assertAuthorizationFresh.mockResolvedValue(undefined);
    mocks.assertBulkPlanCanApply.mockReturnValue(undefined);
    mocks.analyzeBulk.mockResolvedValue(buildFreshPlan(MATCHED_PLAN_HASH));
    mocks.applyEditInTransaction.mockResolvedValue({
      updatedIDs: { CoreMeasurementID: 0 },
      applyErrors: [],
      editOperationID: null,
      validationPending: true
    });
    // Harmless no-op defaults: every existing (pre-#427) test keeps
    // speciesCorrectionGroups empty on its fresh plan, so the route's
    // `speciesCorrectionGroups.length > 0` guard never calls either of these
    // — only the #427 tests below override them.
    mocks.prepareBulkSpeciesCorrections.mockResolvedValue({
      transactionID: 'tx-1',
      schema: 'forestgeo_testing',
      plotID: 1,
      censusID: 2,
      groups: []
    });
    mocks.applyPreparedBulkSpeciesCorrections.mockResolvedValue({
      correctedTreeIDs: [],
      updatedMemberCoreMeasurementIDs: [],
      additionalAffectedCoreMeasurementIDs: [],
      allAffectedCoreMeasurementIDs: [],
      groups: []
    });
  });

  it('rejects requests missing the bulkPlanHash batch-level guard', async () => {
    const response = await POST(
      buildRequest({
        matchedRows: [],
        newRows: [],
        confirmNewRows: false,
        schema: 'forestgeo_testing',
        plotID: 1,
        censusID: 2
      })
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('bulkPlanHash');
  });

  it('returns 403 before scope checks for pending users', async () => {
    mocks.auth.mockResolvedValue({ user: { name: 'Mason', email: 'mason@example.com', userStatus: 'pending', sites: [] } });
    const response = await POST(buildRequest(buildValidBody()));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'pending users cannot edit measurements' });
    expect(mocks.assertCanEditMeasurementScope).not.toHaveBeenCalled();
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('returns 423 Locked when the plot/census measurement scope lock is unavailable', async () => {
    mocks.acquireApplicationLock.mockResolvedValue(false);

    const response = await POST(buildRequest(buildValidBody()));

    expect(response.status).toBe(423);
    await expect(response.json()).resolves.toEqual({
      error: 'Another measurement operation is already in progress for plot 1, census 2'
    });
    expect(mocks.buildMeasurementScopeLockName).toHaveBeenCalledWith('forestgeo_testing', 1, 2);
    expect(mocks.acquireApplicationLock).toHaveBeenCalledWith('measurement-scope:forestgeo_testing:1:2', 'tx-1', 0);
  });

  it('returns 423 Locked when a clean upload session is active for the same plot/census', async () => {
    mocks.executeQuery.mockImplementation(async (query: string) => {
      if (query.includes('FROM ??.upload_sessions')) {
        return [{ session_id: 'upload-session-7' }];
      }
      return [];
    });

    const response = await POST(buildRequest(buildValidBody()));

    expect(response.status).toBe(423);
    await expect(response.json()).resolves.toEqual({
      error: 'Cannot apply revisions while upload session upload-session-7 is active for plot 1, census 2'
    });
  });

  it('returns 423 Locked when a recent validation run is active for the same plot/census', async () => {
    mocks.executeQuery.mockImplementation(async (query: string) => {
      if (query.includes('FROM ??.upload_sessions')) {
        return [];
      }
      if (query.includes('FROM ??.validation_runs')) {
        return [{ RunID: 99, StartedAt: new Date().toISOString() }];
      }
      return [];
    });

    const response = await POST(buildRequest(buildValidBody()));

    expect(response.status).toBe(423);
    await expect(response.json()).resolves.toEqual({
      error: 'Cannot apply revisions while validation run 99 is active for plot 1, census 2'
    });
  });

  it('normalizes duplicate deletion IDs before validation so survivor collisions are caught', async () => {
    const response = await POST(
      buildRequest(
        buildValidBody({
          matchedRows: [{ coreMeasurementID: 42, csvRow: {}, duplicateMeasurementIDsToDelete: [42] }],
          duplicateMeasurementIDsToDelete: [{ coreMeasurementID: '42', survivorCoreMeasurementID: 42 }]
        })
      )
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Duplicate deletion request failed validation',
      applyErrors: [
        {
          coreMeasurementID: 42,
          error: 'Duplicate ID 42 is also a survivor — refusing to delete a row being updated'
        }
      ]
    });
  });

  it('recomputes the bulk hash from the full reviewed row set', async () => {
    mocks.executeQuery.mockImplementation(async (query: string) => {
      if (query.includes('cm.MeasuredDBH') && query.includes('cm.CoreMeasurementID IN')) {
        return [buildDbRow(101), buildDbRow(202)];
      }
      return [];
    });
    await POST(
      buildRequest(
        buildValidBody({
          matchedRows: [
            { coreMeasurementID: 101, csvRow: { dbh: '12.5' } },
            { coreMeasurementID: 202, csvRow: {}, duplicateMeasurementIDsToDelete: [303] }
          ],
          newRows: [{ csvIndex: 5, csvRow: { tag: 'T2', dbh: '1.2' } }],
          invalidRows: [{ csvIndex: 7, csvRow: { tag: 'BAD' }, reason: 'duplicate stemid' }]
        })
      )
    );

    expect(mocks.analyzeBulk).toHaveBeenCalledWith(
      expect.any(Object),
      'forestgeo_testing',
      'measurementssummary',
      1,
      2,
      {
        matched: [
          { rowIndex: 0, targetID: 101, newRow: { MeasuredDBH: 12.5 }, explicitSpeciesCode: null },
          { rowIndex: 1, targetID: 202, newRow: {}, explicitSpeciesCode: null }
        ],
        newRows: [{ rowIndex: 5, newRow: { TreeTag: 'T2', MeasuredDBH: 1.2 } }],
        invalid: [{ rowIndex: 7, reason: 'duplicate stemid' }],
        duplicateMeasurementIDsToDelete: [{ coreMeasurementID: 303, survivorCoreMeasurementID: 202 }]
      },
      'tx-1',
      { role: 'global' }
    );
  });

  it('carries explicitSpeciesCode into the recomputed bulk input, even when the spcode cell is unchanged and dropped from newRow (#427 batch species-correction grouping needs the sibling signal computeDiff throws away)', async () => {
    mocks.executeQuery.mockImplementation(async (query: string) => {
      if (query.includes('cm.MeasuredDBH') && query.includes('cm.CoreMeasurementID IN')) {
        return [buildDbRow(101, { SpeciesCode: 'QUEMAR' }), buildDbRow(202, { SpeciesCode: 'AAA' })];
      }
      return [];
    });

    await POST(
      buildRequest(
        buildValidBody({
          matchedRows: [
            // Row 0: spcode retyped with a case-only match against the DB
            // value — computeDiff reports no change, so newRow carries no
            // SpeciesCode, but the request still explicitly named 'quemar'.
            { coreMeasurementID: 101, csvRow: { spcode: 'quemar' } },
            // Row 1: blank spcode — genuinely unspecified.
            { coreMeasurementID: 202, csvRow: { spcode: '' } }
          ]
        })
      )
    );

    expect(mocks.analyzeBulk).toHaveBeenCalledTimes(1);
    const analyzeArgs = mocks.analyzeBulk.mock.calls[0] as unknown as Array<unknown>;
    const bulkInput = analyzeArgs[5] as {
      matched: Array<{ targetID: number; newRow: Record<string, unknown>; explicitSpeciesCode?: string | null }>;
    };
    expect(bulkInput.matched).toHaveLength(2);

    const row0 = bulkInput.matched.find(m => m.targetID === 101)!;
    expect(row0.newRow).toEqual({});
    expect(row0.explicitSpeciesCode).toBe('quemar');

    const row1 = bulkInput.matched.find(m => m.targetID === 202)!;
    expect(row1.explicitSpeciesCode).toBeNull();
  });

  it('stages new rows with plot coordinates into temporarymeasurements PlotX/PlotY', async () => {
    mocks.executeQuery.mockImplementation(async (query: string) => {
      if (query.includes('INSERT INTO ??.temporarymeasurements')) return { affectedRows: 1, warningStatus: 0 };
      return [];
    });
    const response = await POST(
      buildRequest(
        buildValidBody({
          newRows: [
            {
              csvIndex: 0,
              csvRow: {
                tag: 'T9',
                stemtag: 'S9',
                spcode: 'AAA',
                quadrat: 'Q1',
                lx: '3.5',
                ly: '4.25',
                px: '-2.531244',
                py: '487.125',
                dbh: '10',
                date: '2026-04-01'
              }
            }
          ],
          confirmNewRows: true
        })
      )
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ insertedCount: 1 });

    const insertCall = mocks.executeQuery.mock.calls.find(([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO ??.temporarymeasurements'));
    expect(insertCall).toBeDefined();
    const [insertSQL, insertParams] = insertCall!;
    expect(insertSQL).toContain('LocalX, LocalY, PlotX, PlotY, DBH, HOM');
    const rowValues = (insertParams as unknown[][])[0][0] as unknown[];
    // Column order: FileID, BatchID, PlotID, CensusID, TreeTag, StemTag,
    // SpeciesCode, QuadratName, LocalX, LocalY, PlotX, PlotY, DBH, HOM, ...
    expect(rowValues[8]).toBe(3.5);
    expect(rowValues[9]).toBe(4.25);
    expect(rowValues[10]).toBe(-2.531244);
    expect(rowValues[11]).toBe(487.125);

    const statements = mocks.executeQuery.mock.calls.map(([sql]) => String(sql));
    const procedureIndex = statements.findIndex(sql => sql.includes('bulkingestionprocess'));
    expect(statements.slice(procedureIndex - 1, procedureIndex + 2)).toEqual([
      CALLER_OWNS_TRANSACTION_SQL,
      BULK_INGESTION_CALL_TEMPLATE,
      CLEAR_CALLER_TRANSACTION_SQL
    ]);
    for (const [, , transactionID] of mocks.executeQuery.mock.calls.slice(procedureIndex - 1, procedureIndex + 2)) {
      expect(transactionID, 'the flag and CALL must run on the revision transaction').toBe(REVISION_TRANSACTION_ID);
    }
    expect(mocks.discardTransaction).not.toHaveBeenCalled();
  });

  it('fails the apply instead of reporting inserted rows when the CALL succeeded but the caller flag could not be cleared', async () => {
    const clearError = new Error('connection lost while clearing the caller flag');
    mocks.executeQuery.mockImplementation(async (query: string) => {
      if (query.includes('INSERT INTO ??.temporarymeasurements')) return { affectedRows: 1, warningStatus: 0 };
      if (query === CLEAR_CALLER_TRANSACTION_SQL) throw clearError;
      return [];
    });

    const response = await POST(
      buildRequest(
        buildValidBody({
          newRows: [{ csvIndex: 0, csvRow: { tag: 'T9', stemtag: 'S9', spcode: 'AAA', quadrat: 'Q1', dbh: '10', date: '2026-04-01' } }],
          confirmNewRows: true
        })
      )
    );

    expect(response.status).toBe(HTTPResponses.INTERNAL_SERVER_ERROR);
    await expect(response.json()).resolves.toEqual({ error: clearError.message });
    expect(mocks.discardTransaction).toHaveBeenCalledWith(REVISION_TRANSACTION_ID, FLAG_CLEAR_FAILED_REASON);
    expect(mocks.refreshMeasurementViewsForScope, 'no derived refresh may follow a discarded transaction').not.toHaveBeenCalled();
  });

  it('rejects malformed numeric values in new rows before inserting temporary measurements', async () => {
    const response = await POST(
      buildRequest(
        buildValidBody({
          newRows: [{ csvIndex: 0, csvRow: { tag: 'T1', dbh: '12abc' } }],
          confirmNewRows: true
        })
      )
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ error: 'invalid field value', field: 'MeasuredDBH' });
    expect(mocks.executeQuery).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO ??.temporarymeasurements'), expect.anything(), expect.anything());
  });

  it('rejects out-of-range plot coordinates before inserting temporary measurements', async () => {
    const response = await POST(
      buildRequest(
        buildValidBody({
          newRows: [{ csvIndex: 0, csvRow: { tag: 'T1', px: '1000000' } }],
          confirmNewRows: true
        })
      )
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ error: 'invalid field value', field: 'StemPlotX' });
    expect(mocks.executeQuery).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO ??.temporarymeasurements'), expect.anything(), expect.anything());
  });

  it('rolls back revision staging when MySQL reports a warning and surfaces its details', async () => {
    mocks.executeQuery.mockImplementation(async (query: string) => {
      if (query.includes('INSERT INTO ??.temporarymeasurements')) return { affectedRows: 1, warningStatus: 1 };
      if (query === 'SHOW WARNINGS') return [{ Level: 'Warning', Code: 1265, Message: "Data truncated for column 'PlotX'" }];
      return [];
    });

    const response = await POST(
      buildRequest(
        buildValidBody({
          newRows: [{ csvIndex: 0, csvRow: { tag: 'T1', px: '12.5' } }],
          confirmNewRows: true
        })
      )
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: "Revision staging produced 1 SQL warning(s): Warning 1265 Data truncated for column 'PlotX'"
    });
    expect(mocks.executeQuery).not.toHaveBeenCalledWith(expect.stringContaining('bulkingestionprocess'), expect.anything(), expect.anything());

    // SHOW WARNINGS must go through the text protocol. runQuery routes to
    // connection.execute() whenever a params array is supplied, and MySQL
    // rejects SHOW WARNINGS there with ER_UNSUPPORTED_PS (1295) — which would
    // throw an opaque 500 over the very diagnostic this branch exists to read.
    const showWarningsCall = mocks.executeQuery.mock.calls.find(([query]: [string]) => query === 'SHOW WARNINGS');
    expect(showWarningsCall).toBeDefined();
    expect(showWarningsCall![1]).toBeUndefined();
    expect(mocks.loggerError).toHaveBeenCalledWith(
      '[revisionupload/apply] temporarymeasurement staging produced SQL warnings',
      undefined,
      expect.objectContaining({ warningCount: 1 })
    );
  });

  it('rejects a staging row-count mismatch instead of reporting the requested count as inserted', async () => {
    mocks.executeQuery.mockImplementation(async (query: string) => {
      if (query.includes('INSERT INTO ??.temporarymeasurements')) return { affectedRows: 0, warningStatus: 0 };
      return [];
    });

    const response = await POST(
      buildRequest(
        buildValidBody({
          newRows: [{ csvIndex: 0, csvRow: { tag: 'T1', px: '12.5' } }],
          confirmNewRows: true
        })
      )
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ error: 'Revision staging inserted 0 of 1 expected row(s)' });
    expect(mocks.executeQuery).not.toHaveBeenCalledWith(expect.stringContaining('bulkingestionprocess'), expect.anything(), expect.anything());
  });

  it('returns 409 with freshPlan when the bulk plan hash drifts between match and apply', async () => {
    const freshPlan = buildFreshPlan(DRIFTED_PLAN_HASH, { rowCount: 2 });
    mocks.analyzeBulk.mockResolvedValue(freshPlan);
    mocks.executeQuery.mockImplementation(async (query: string) => {
      if (query.includes('cm.MeasuredDBH') && query.includes('cm.CoreMeasurementID IN')) {
        return [buildDbRow(101)];
      }
      return [];
    });

    const response = await POST(
      buildRequest(
        buildValidBody({
          matchedRows: [{ coreMeasurementID: 101, csvRow: { dbh: '12.5' } }],
          bulkPlanHash: MATCHED_PLAN_HASH
        })
      )
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'plan hash mismatch',
      freshPlan
    });
    expect(mocks.applyEditInTransaction).not.toHaveBeenCalled();
  });

  it('moves apply-time invalid matched rows into the hash plan and only writes surviving matched rows', async () => {
    mocks.executeQuery.mockImplementation(async (query: string) => {
      if (query.includes('FROM ??.upload_sessions')) return [];
      if (query.includes('FROM ??.validation_runs')) return [];
      if (query.includes('cm.MeasuredDBH') && query.includes('cm.CoreMeasurementID IN')) {
        return [buildDbRow(101), buildDbRow(202)];
      }
      return [];
    });
    mocks.analyzeBulk
      .mockResolvedValueOnce(
        buildFreshPlan('demoted-row-plan', {
          rowCount: 2,
          rowPlans: [
            { rowIndex: 0, targetID: 101, status: 'invalid', reason: 'Quadrat 999 was not found in this plot/census' },
            { rowIndex: 1, targetID: 202, status: 'matched' }
          ]
        })
      )
      .mockResolvedValueOnce(
        buildFreshPlan(MATCHED_PLAN_HASH, {
          rowCount: 2,
          rowPlans: [
            { rowIndex: 0, targetID: 202, status: 'matched' },
            { rowIndex: 10, status: 'invalid', reason: 'Quadrat 999 was not found in this plot/census' }
          ]
        })
      );

    const response = await POST(
      buildRequest(
        buildValidBody({
          matchedRows: [
            { csvIndex: 10, coreMeasurementID: 101, csvRow: { quadrat: '999' }, duplicateMeasurementIDsToDelete: [55] },
            { csvIndex: 11, coreMeasurementID: 202, csvRow: { dbh: '12.5' } }
          ]
        })
      )
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      updatedCount: 1,
      skippedCount: 0,
      deletedDuplicateCount: 0
    });
    expect(mocks.analyzeBulk).toHaveBeenCalledTimes(2);
    const secondBulkInput = (mocks.analyzeBulk.mock.calls[1] as unknown as Array<unknown>)[5] as {
      matched: Array<{ targetID: number }>;
      invalid: Array<{ rowIndex: number; reason: string }>;
      duplicateMeasurementIDsToDelete: Array<{ coreMeasurementID: number; survivorCoreMeasurementID: number }>;
    };
    expect(secondBulkInput.matched.map(row => row.targetID)).toEqual([202]);
    expect(secondBulkInput.invalid).toEqual([{ rowIndex: 10, reason: 'Quadrat 999 was not found in this plot/census' }]);
    expect(secondBulkInput.duplicateMeasurementIDsToDelete).toEqual([]);
    expect(mocks.applyEditInTransaction).toHaveBeenCalledTimes(1);
    expect((mocks.applyEditInTransaction.mock.calls[0] as unknown as [unknown, Record<string, unknown>])[1]).toMatchObject({ targetID: 202 });
  });

  const GROUP_CONFLICT_TREE_ID = 42;
  const GROUP_CONFLICT_ROW_INDEXES = [0, 1];
  const GROUP_SPECIES_CONFLICT_ERROR = {
    kind: 'TreeStemResolution',
    subject: 'species',
    reason: 'group_species_conflict',
    field: 'SpeciesCode',
    message: `Tree T#${GROUP_CONFLICT_TREE_ID} (TreeTag "T") has conflicting species corrections requested in this batch: "BBB", "CCC". Submit one species per tree in a single batch.`,
    severity: 'destructive',
    blocking: true,
    treeID: GROUP_CONFLICT_TREE_ID,
    rowIndex: GROUP_CONFLICT_ROW_INDEXES[0],
    rowIndexes: GROUP_CONFLICT_ROW_INDEXES
  } as const;

  it('skips the demote-and-re-run and surfaces the group blocker via the existing unapplicable-plan path when the fresh plan carries a batch-level group blocker (#427)', async () => {
    mocks.executeQuery.mockImplementation(async (query: string) => {
      if (query.includes('FROM ??.upload_sessions')) return [];
      if (query.includes('FROM ??.validation_runs')) return [];
      if (query.includes('cm.MeasuredDBH') && query.includes('cm.CoreMeasurementID IN')) {
        return [buildDbRow(101), buildDbRow(202)];
      }
      return [];
    });

    // Row 0 (target 101) individually threw and would normally be demoted;
    // row 1 (target 202) matched fine. Both also triggered the group conflict.
    mocks.analyzeBulk.mockResolvedValueOnce(
      buildFreshPlan('plan-with-group-blocker', {
        rowCount: 2,
        rowPlans: [
          { rowIndex: 0, targetID: 101, status: 'invalid', reason: 'Row 1: species "BBB" was not found' },
          { rowIndex: 1, targetID: 202, status: 'matched' }
        ],
        errors: [GROUP_SPECIES_CONFLICT_ERROR],
        maxSeverity: 'destructive'
      })
    );
    mocks.assertBulkPlanCanApply.mockImplementation(() => {
      throw new mocks.MockBulkPlanUnapplicableError([GROUP_SPECIES_CONFLICT_ERROR]);
    });

    const response = await POST(
      buildRequest(
        buildValidBody({
          matchedRows: [
            { csvIndex: 10, coreMeasurementID: 101, csvRow: { spcode: 'BBB' } },
            { csvIndex: 11, coreMeasurementID: 202, csvRow: { spcode: 'CCC' } }
          ]
        })
      )
    );

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body).toEqual({ error: 'plan not applicable', blockingErrors: [GROUP_SPECIES_CONFLICT_ERROR] });
    expect(
      mocks.analyzeBulk,
      'a batch-level group blocker already makes canApply false; re-running on survivors only would drop row 0 explicitSpeciesCode and silently erase the conflict'
    ).toHaveBeenCalledTimes(1);
    expect(mocks.applyEditInTransaction).not.toHaveBeenCalled();
  });

  it('still demotes and re-runs when the only blocking error is a non-group TreeStemResolution reason (regression: the #427 gate must match only reason values prefixed "group_", not any blocking error)', async () => {
    mocks.executeQuery.mockImplementation(async (query: string) => {
      if (query.includes('FROM ??.upload_sessions')) return [];
      if (query.includes('FROM ??.validation_runs')) return [];
      if (query.includes('cm.MeasuredDBH') && query.includes('cm.CoreMeasurementID IN')) {
        return [buildDbRow(101), buildDbRow(202)];
      }
      return [];
    });
    mocks.analyzeBulk
      .mockResolvedValueOnce(
        buildFreshPlan('plan-with-non-group-blocker', {
          rowCount: 2,
          rowPlans: [
            { rowIndex: 0, targetID: 101, status: 'invalid', reason: 'Matching stem exists in a different quadrat' },
            { rowIndex: 1, targetID: 202, status: 'matched' }
          ],
          errors: [
            {
              kind: 'TreeStemResolution',
              subject: 'stem',
              reason: 'different_quadrat',
              field: 'QuadratName',
              message: 'Matching stem exists in a different quadrat',
              severity: 'destructive',
              blocking: true,
              rowIndex: 0
            }
          ],
          maxSeverity: 'destructive'
        })
      )
      .mockResolvedValueOnce(
        buildFreshPlan(MATCHED_PLAN_HASH, {
          rowCount: 2,
          rowPlans: [
            { rowIndex: 0, targetID: 202, status: 'matched' },
            { rowIndex: 10, status: 'invalid', reason: 'Matching stem exists in a different quadrat' }
          ]
        })
      );

    const response = await POST(
      buildRequest(
        buildValidBody({
          matchedRows: [
            { csvIndex: 10, coreMeasurementID: 101, csvRow: { quadrat: '999' } },
            { csvIndex: 11, coreMeasurementID: 202, csvRow: { dbh: '12.5' } }
          ]
        })
      )
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      updatedCount: 1,
      skippedCount: 0,
      deletedDuplicateCount: 0
    });
    expect(
      mocks.analyzeBulk,
      'a non-group blocking error must not engage the #427 gate; demotion+re-run is still required so classify and apply hash the same survivor-only input'
    ).toHaveBeenCalledTimes(2);
    const secondBulkInput = (mocks.analyzeBulk.mock.calls[1] as unknown as Array<unknown>)[5] as {
      matched: Array<{ targetID: number }>;
      invalid: Array<{ rowIndex: number; reason: string }>;
    };
    expect(secondBulkInput.matched.map(row => row.targetID)).toEqual([202]);
    expect(secondBulkInput.invalid).toEqual([{ rowIndex: 10, reason: 'Matching stem exists in a different quadrat' }]);
  });

  it('returns 403 when the recomputed bulk plan contains role-forbidden fields', async () => {
    mocks.assertBulkPlanCanApply.mockImplementation(() => {
      throw new mocks.MockRoleForbiddenFieldError(['spcode'], 'field crew');
    });

    const response = await POST(buildRequest(buildValidBody()));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'role forbidden field', fields: ['spcode'], role: 'field crew' });
    expect(mocks.applyEditInTransaction).not.toHaveBeenCalled();
  });

  it('returns 401 and does not write when authorization is stale after the hash check', async () => {
    mocks.assertAuthorizationFresh.mockRejectedValue(new mocks.MockSessionExpiredError());
    mocks.executeQuery.mockImplementation(async (query: string) => {
      if (query.includes('cm.MeasuredDBH') && query.includes('cm.CoreMeasurementID IN')) {
        return [buildDbRow(101)];
      }
      return [];
    });

    const response = await POST(
      buildRequest(
        buildValidBody({
          matchedRows: [{ coreMeasurementID: 101, csvRow: { dbh: '12.5' } }]
        })
      )
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'session expired' });
    expect(mocks.assertAuthorizationFresh).toHaveBeenCalledTimes(1);
    expect(mocks.applyEditInTransaction).not.toHaveBeenCalled();
  });

  it('calls applyEditInTransaction per matched row with operationType=bulk-revision-row, suppresses per-row ledger writes, and writes one summary ledger entry', async () => {
    mocks.executeQuery.mockImplementation(async (query: string) => {
      if (query.includes('FROM ??.upload_sessions')) return [];
      if (query.includes('FROM ??.validation_runs')) return [];
      if (query.includes('cm.MeasuredDBH') && query.includes('cm.CoreMeasurementID IN')) {
        return [buildDbRow(101), buildDbRow(202)];
      }
      return [];
    });

    const response = await POST(
      buildRequest(
        buildValidBody({
          matchedRows: [
            { coreMeasurementID: 101, csvRow: { dbh: '12.5', codes: 'L;D' } },
            { coreMeasurementID: 202, csvRow: { hom: '1.3' } }
          ]
        })
      )
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.updatedCount).toBe(2);
    expect(body.skippedCount).toBe(0);
    expect(body.validationPending).toBe(true);

    expect(mocks.applyEditInTransaction).toHaveBeenCalledTimes(2);

    const firstCall = mocks.applyEditInTransaction.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
    const firstInput = firstCall[1];
    expect(firstInput).toMatchObject({
      dataType: 'measurementssummary',
      schema: 'forestgeo_testing',
      plotID: 1,
      censusID: 2,
      targetID: 101,
      expectedPlanHash: null,
      operationType: 'bulk-revision-row',
      revertable: false,
      writeLedger: false,
      refreshViews: false,
      transactionID: 'tx-1'
    });
    expect(firstInput.newRow).toEqual({ MeasuredDBH: 12.5, Attributes: 'L;D' });

    const secondCall = mocks.applyEditInTransaction.mock.calls[1] as unknown as [unknown, Record<string, unknown>];
    const secondInput = secondCall[1];
    expect(secondInput).toMatchObject({
      targetID: 202,
      operationType: 'bulk-revision-row',
      revertable: false,
      writeLedger: false,
      refreshViews: false
    });
    expect(secondInput.newRow).toEqual({ MeasuredHOM: 1.3 });

    // Exactly one ledger entry for the whole batch, summarizing all IDs.
    expect(mocks.writeEditOperation).toHaveBeenCalledTimes(1);
    const summaryArgs = mocks.writeEditOperation.mock.calls[0] as unknown as [unknown, string, Record<string, unknown>, string];
    expect(summaryArgs[1]).toBe('forestgeo_testing');
    expect(summaryArgs[3]).toBe('tx-1');
    const summaryRecord = summaryArgs[2];
    expect(summaryRecord).toMatchObject({
      operationType: 'bulk-revision-row',
      revertable: false,
      dataType: 'measurementssummary',
      // Bulk ledger rows set TargetID null because no single CoreMeasurementID
      // represents the batch; affected IDs live in BeforeState JSON.
      targetID: null,
      plotID: 1,
      censusID: 2,
      planHash: MATCHED_PLAN_HASH
    });
    const beforeState = summaryRecord.beforeState as Array<Record<string, unknown>>;
    expect(beforeState).toHaveLength(1);
    expect(beforeState[0]).toMatchObject({
      table: 'bulk-revision-apply',
      primaryKey: 'bulkPlanHash',
      primaryKeyValue: MATCHED_PLAN_HASH
    });
    expect((beforeState[0].row as Record<string, unknown>).updatedCoreMeasurementIDs).toEqual([101, 202]);
    expect((beforeState[0].row as Record<string, unknown>).deletedDuplicateCoreMeasurementIDs).toEqual([]);
  });

  it('rolls back the entire batch and surfaces 500 when the writer throws mid-loop', async () => {
    mocks.executeQuery.mockImplementation(async (query: string) => {
      if (query.includes('FROM ??.upload_sessions')) return [];
      if (query.includes('FROM ??.validation_runs')) return [];
      if (query.includes('cm.MeasuredDBH') && query.includes('cm.CoreMeasurementID IN')) {
        return [buildDbRow(101), buildDbRow(202)];
      }
      return [];
    });

    const writerError = new Error('writer blew up on row 2');
    mocks.applyEditInTransaction.mockImplementationOnce(async () => ({
      updatedIDs: { CoreMeasurementID: 101 },
      applyErrors: [],
      editOperationID: null,
      validationPending: true
    }));
    mocks.applyEditInTransaction.mockImplementationOnce(async () => {
      throw writerError;
    });

    // Simulate withTransaction: run fn and propagate errors (no commit swallow).
    mocks.withTransaction.mockImplementation(
      async (fn: (tx: { query: (sql: string, params?: unknown[]) => Promise<unknown>; id: string }) => Promise<unknown>) => {
        return fn({ query: (sql: string, params?: unknown[]) => mocks.executeQuery(sql, params), id: 'tx-1' });
      }
    );

    const response = await POST(
      buildRequest(
        buildValidBody({
          matchedRows: [
            { coreMeasurementID: 101, csvRow: { dbh: '12.5' } },
            { coreMeasurementID: 202, csvRow: { dbh: '13.0' } }
          ]
        })
      )
    );

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe('writer blew up on row 2');
    expect(mocks.applyEditInTransaction).toHaveBeenCalledTimes(2);
    expect(mocks.refreshMeasurementViewsForScope).not.toHaveBeenCalled();
  });

  it('rolls back the batch when TOCTOU re-resolve finds a measurement inactive', async () => {
    mocks.executeQuery.mockImplementation(async (query: string) => {
      if (query.includes('FROM ??.upload_sessions')) return [];
      if (query.includes('FROM ??.validation_runs')) return [];
      if (query.includes('cm.CoreMeasurementID IN')) {
        return []; // row no longer active or deleted
      }
      return [];
    });

    const response = await POST(
      buildRequest(
        buildValidBody({
          matchedRows: [{ coreMeasurementID: 101, csvRow: { dbh: '12.5' } }]
        })
      )
    );

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toBe('Measurement 101 is no longer active in this plot/census — may have been deactivated since upload was matched');
    expect(mocks.applyEditInTransaction).not.toHaveBeenCalled();
  });

  it('deletes denormalized view rows when removing a verified duplicate measurement', async () => {
    mocks.executeQuery.mockImplementation(async (query: string) => {
      if (query.includes('FROM ??.upload_sessions')) return [];
      if (query.includes('FROM ??.validation_runs')) return [];
      if (query.includes('cm.MeasuredDBH') && query.includes('cm.CoreMeasurementID IN')) {
        return [buildDbRow(101)];
      }
      if (query.includes('SELECT cm.CoreMeasurementID, cm.StemGUID')) {
        return [
          { CoreMeasurementID: 55, StemGUID: 777 },
          { CoreMeasurementID: 101, StemGUID: 777 }
        ];
      }
      if (query.includes('DELETE FROM ??.coremeasurements WHERE CoreMeasurementID = ? AND CensusID = ? AND IsActive = 1')) {
        return { affectedRows: 1 };
      }
      return [];
    });

    const response = await POST(
      buildRequest(
        buildValidBody({
          matchedRows: [{ coreMeasurementID: 101, csvRow: {}, duplicateMeasurementIDsToDelete: [55] }],
          duplicateMeasurementIDsToDelete: [{ coreMeasurementID: 55, survivorCoreMeasurementID: 101 }]
        })
      )
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      updatedCount: 0,
      skippedCount: 1,
      insertedCount: 0,
      deletedDuplicateCount: 1,
      applyErrors: [],
      validationPending: true
    });

    expect(mocks.applyEditInTransaction).not.toHaveBeenCalled();
    expect(mocks.executeQuery).toHaveBeenCalledWith('DELETE FROM ??.measurementssummary WHERE CoreMeasurementID = ?', [55], 'tx-1');
    expect(mocks.executeQuery).toHaveBeenCalledWith('DELETE FROM ??.viewfulltable WHERE CoreMeasurementID = ?', [55], 'tx-1');
    expect(mocks.refreshMeasurementViewsForScope).toHaveBeenCalledWith(expect.any(Object), 'forestgeo_testing', 1, 2, 'tx-1');
  });

  it('refreshes derived measurement views when matched rows are updated', async () => {
    mocks.executeQuery.mockImplementation(async (query: string) => {
      if (query.includes('FROM ??.upload_sessions')) return [];
      if (query.includes('FROM ??.validation_runs')) return [];
      if (query.includes('cm.MeasuredDBH') && query.includes('cm.CoreMeasurementID IN')) {
        return [buildDbRow(101), buildDbRow(202)];
      }
      return [];
    });

    const response = await POST(
      buildRequest(
        buildValidBody({
          matchedRows: [{ coreMeasurementID: 101, csvRow: { dbh: '12.5' } }]
        })
      )
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      updatedCount: 1,
      skippedCount: 0,
      insertedCount: 0,
      deletedDuplicateCount: 0,
      applyErrors: [],
      validationPending: true
    });

    expect(mocks.applyEditInTransaction).toHaveBeenCalledTimes(1);
    expect(mocks.refreshMeasurementViewsForScope).toHaveBeenCalledWith(expect.any(Object), 'forestgeo_testing', 1, 2, 'tx-1');
  });

  it('returns 422 with structured blockingErrors payload when assertBulkPlanCanApply throws BulkPlanUnapplicableError', async () => {
    const blockingErrors = [
      { kind: 'role-forbidden', subject: 'SpeciesCode', reason: 'field crew cannot edit this field', blocking: true },
      { kind: 'validation', subject: 'MeasuredDBH', reason: 'value exceeds species maximum', blocking: true }
    ];
    mocks.assertBulkPlanCanApply.mockImplementation(() => {
      throw new mocks.MockBulkPlanUnapplicableError(blockingErrors);
    });

    const response = await POST(buildRequest(buildValidBody()));

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body).toEqual({ error: 'plan not applicable', blockingErrors });
    expect(mocks.applyEditInTransaction).not.toHaveBeenCalled();
  });

  it('returns 422 with subject and reason when a mutating resolver throws MeasurementResolutionError', async () => {
    mocks.applyEditInTransaction.mockRejectedValue(new mocks.MockMeasurementResolutionError('quadrat', 'missing', 'Quadrat not found for stem resolution'));

    mocks.executeQuery.mockImplementation(async (query: string) => {
      if (query.includes('FROM ??.upload_sessions')) return [];
      if (query.includes('FROM ??.validation_runs')) return [];
      if (query.includes('cm.MeasuredDBH') && query.includes('cm.CoreMeasurementID IN')) {
        return [buildDbRow(101), buildDbRow(202)];
      }
      return [];
    });

    const response = await POST(
      buildRequest(
        buildValidBody({
          matchedRows: [{ coreMeasurementID: 101, csvRow: { dbh: '12.5' } }]
        })
      )
    );

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body).toEqual({
      error: 'Quadrat not found for stem resolution',
      subject: 'quadrat',
      reason: 'missing'
    });
    expect(mocks.refreshMeasurementViewsForScope).not.toHaveBeenCalled();
  });

  it('does not refresh derived measurement views when apply makes no changes', async () => {
    mocks.executeQuery.mockImplementation(async (query: string) => {
      if (query.includes('FROM ??.upload_sessions')) return [];
      if (query.includes('FROM ??.validation_runs')) return [];
      if (query.includes('cm.MeasuredDBH') && query.includes('cm.CoreMeasurementID IN')) {
        return [buildDbRow(101), buildDbRow(202)];
      }
      return [];
    });

    const response = await POST(
      buildRequest(
        buildValidBody({
          matchedRows: [{ coreMeasurementID: 101, csvRow: {} }]
        })
      )
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      updatedCount: 0,
      skippedCount: 1,
      insertedCount: 0,
      deletedDuplicateCount: 0,
      applyErrors: [],
      validationPending: false
    });

    expect(mocks.refreshMeasurementViewsForScope).not.toHaveBeenCalled();
    expect(mocks.applyEditInTransaction).not.toHaveBeenCalled();
    expect(mocks.writeEditOperation).not.toHaveBeenCalled();
  });

  it('skips matched rows whose CSV cells are all NULL placeholders, regardless of which columns are populated (regression: round-trip identity columns must not be rejected as `invalid clear`)', async () => {
    mocks.executeQuery.mockImplementation(async (query: string) => {
      if (query.includes('FROM ??.upload_sessions')) return [];
      if (query.includes('FROM ??.validation_runs')) return [];
      if (query.includes('cm.MeasuredDBH') && query.includes('cm.CoreMeasurementID IN')) {
        // DB row matches every CSV value, so computeDiff returns {} per row.
        return [buildDbRow(101, { TreeTag: 'T1', StemTag: 'S1', SpeciesCode: 'AAA', QuadratName: 'Q1' })];
      }
      return [];
    });

    const response = await POST(
      buildRequest(
        buildValidBody({
          matchedRows: [
            {
              coreMeasurementID: 101,
              csvRow: {
                tag: null,
                stemtag: null,
                spcode: null,
                quadrat: null,
                lx: null,
                ly: null,
                date: null,
                dbh: null,
                hom: null,
                codes: null,
                comments: null
              }
            }
          ]
        })
      )
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      updatedCount: 0,
      skippedCount: 1,
      insertedCount: 0,
      deletedDuplicateCount: 0,
      applyErrors: [],
      validationPending: false
    });
    expect(mocks.applyEditInTransaction).not.toHaveBeenCalled();

    // Plan-hash recomputation must use the same diff-driven matched-row
    // filtering as the classify route — so the bulk input's matched newRow
    // is empty, never carrying nulls for invalid-clear identity fields.
    expect(mocks.analyzeBulk).toHaveBeenCalledTimes(1);
    const analyzeArgs = mocks.analyzeBulk.mock.calls[0] as unknown as Array<unknown>;
    const bulkInput = analyzeArgs[5] as { matched: Array<{ newRow: Record<string, unknown> }> };
    expect(bulkInput.matched).toHaveLength(1);
    expect(bulkInput.matched[0].newRow).toEqual({});
  });

  it('keeps leading-zero round-trip rows out of the analyzer/writer payload (regression: tag/stemtag/quadrat tolerance must apply at apply time too)', async () => {
    mocks.executeQuery.mockImplementation(async (query: string) => {
      if (query.includes('FROM ??.upload_sessions')) return [];
      if (query.includes('FROM ??.validation_runs')) return [];
      if (query.includes('cm.MeasuredDBH') && query.includes('cm.CoreMeasurementID IN')) {
        // DB stores '0101' for QuadratName; CSV says '101'. Same digit-string
        // value after leading-zero strip, so computeDiff returns {} and the
        // row must be skipped.
        return [buildDbRow(101, { QuadratName: '0101', TreeTag: '10063', StemTag: '10063' })];
      }
      return [];
    });

    const response = await POST(
      buildRequest(
        buildValidBody({
          matchedRows: [
            {
              coreMeasurementID: 101,
              csvRow: { quadrat: '101', tag: '10063', stemtag: '10063' }
            }
          ]
        })
      )
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.updatedCount).toBe(0);
    expect(body.skippedCount).toBe(1);
    expect(mocks.applyEditInTransaction).not.toHaveBeenCalled();

    const analyzeArgs = mocks.analyzeBulk.mock.calls[0] as unknown as Array<unknown>;
    const bulkInput = analyzeArgs[5] as { matched: Array<{ newRow: Record<string, unknown> }> };
    expect(bulkInput.matched[0].newRow).toEqual({});
  });

  it('routes a species-correction group member through applyPreparedBulkSpeciesCorrections and skips it in the ordinary per-row apply loop, while the non-member row still goes through applyEditInTransaction (#427 group routing)', async () => {
    const GROUP_MEMBER_CORE_ID = 501;
    const ORDINARY_ROW_CORE_ID = 601;

    mocks.executeQuery.mockImplementation(async (query: string) => {
      if (query.includes('FROM ??.upload_sessions')) return [];
      if (query.includes('FROM ??.validation_runs')) return [];
      if (query.includes('cm.MeasuredDBH') && query.includes('cm.CoreMeasurementID IN')) {
        return [buildDbRow(GROUP_MEMBER_CORE_ID, { SpeciesCode: 'AAA' }), buildDbRow(ORDINARY_ROW_CORE_ID)];
      }
      return [];
    });

    mocks.analyzeBulk.mockResolvedValue(
      buildFreshPlan(MATCHED_PLAN_HASH, {
        rowCount: 2,
        rowPlans: [
          { rowIndex: 0, targetID: GROUP_MEMBER_CORE_ID, status: 'matched', plan: buildGroupMemberPlan(GROUP_MEMBER_CORE_ID) },
          { rowIndex: 1, targetID: ORDINARY_ROW_CORE_ID, status: 'matched', plan: buildGroupMemberPlan(ORDINARY_ROW_CORE_ID) }
        ],
        speciesCorrectionGroups: [buildSpeciesCorrectionGroup([{ rowIndex: 0, coreMeasurementID: GROUP_MEMBER_CORE_ID, requestedCorrection: true }])]
      })
    );

    const response = await POST(
      buildRequest(
        buildValidBody({
          matchedRows: [
            { coreMeasurementID: GROUP_MEMBER_CORE_ID, csvRow: { spcode: 'BBB' } },
            { coreMeasurementID: ORDINARY_ROW_CORE_ID, csvRow: { dbh: '12.5' } }
          ]
        })
      )
    );

    expect(response.status).toBe(200);
    expect(mocks.prepareBulkSpeciesCorrections).toHaveBeenCalledTimes(1);
    expect(mocks.applyPreparedBulkSpeciesCorrections).toHaveBeenCalledTimes(1);

    const applyCalls = mocks.applyEditInTransaction.mock.calls as unknown as Array<[unknown, Record<string, unknown>]>;
    const memberCall = applyCalls.find(call => call[1].targetID === GROUP_MEMBER_CORE_ID);
    expect(
      memberCall,
      'the group member must never reach the ordinary per-row writer — its write context cannot be threaded through applyEditInTransaction'
    ).toBeUndefined();

    const ordinaryCall = applyCalls.find(call => call[1].targetID === ORDINARY_ROW_CORE_ID);
    expect(ordinaryCall, 'the non-member row must still go through the ordinary writer').toBeDefined();
    expect(mocks.applyEditInTransaction).toHaveBeenCalledTimes(1);
  });

  it('includes a submitted sibling row whose own diff is empty (rowPlan status "unchanged") as a species-correction group member instead of 500ing the whole batch (#427 fix F35 regression)', async () => {
    const REQUESTER_CORE_ID = 501;
    const UNCHANGED_SIBLING_CORE_ID = 502;

    mocks.executeQuery.mockImplementation(async (query: string) => {
      if (query.includes('FROM ??.upload_sessions')) return [];
      if (query.includes('FROM ??.validation_runs')) return [];
      if (query.includes('cm.MeasuredDBH') && query.includes('cm.CoreMeasurementID IN')) {
        return [buildDbRow(REQUESTER_CORE_ID, { SpeciesCode: 'AAA' }), buildDbRow(UNCHANGED_SIBLING_CORE_ID, { SpeciesCode: 'AAA' })];
      }
      return [];
    });

    mocks.analyzeBulk.mockResolvedValue(
      buildFreshPlan(MATCHED_PLAN_HASH, {
        rowCount: 2,
        rowPlans: [
          { rowIndex: 0, targetID: REQUESTER_CORE_ID, status: 'matched', plan: buildGroupMemberPlan(REQUESTER_CORE_ID) },
          { rowIndex: 1, targetID: UNCHANGED_SIBLING_CORE_ID, status: 'unchanged', plan: buildUnchangedGroupMemberPlan(UNCHANGED_SIBLING_CORE_ID) }
        ],
        speciesCorrectionGroups: [
          buildSpeciesCorrectionGroup([
            { rowIndex: 0, coreMeasurementID: REQUESTER_CORE_ID, requestedCorrection: true },
            { rowIndex: 1, coreMeasurementID: UNCHANGED_SIBLING_CORE_ID, requestedCorrection: false }
          ])
        ]
      })
    );

    const speciesCorrectionsSummary = {
      correctedTreeIDs: [SPECIES_GROUP_TREE_ID],
      updatedMemberCoreMeasurementIDs: [REQUESTER_CORE_ID],
      additionalAffectedCoreMeasurementIDs: [],
      allAffectedCoreMeasurementIDs: [REQUESTER_CORE_ID],
      groups: []
    };
    mocks.applyPreparedBulkSpeciesCorrections.mockResolvedValueOnce(speciesCorrectionsSummary);

    const response = await POST(
      buildRequest(
        buildValidBody({
          matchedRows: [
            { coreMeasurementID: REQUESTER_CORE_ID, csvRow: { spcode: 'BBB' } },
            // Species omitted entirely: this sibling's own diff is empty,
            // so it is a legitimate zero-change group member pulled in by
            // tree membership — not an ordinary skip, and not absent.
            { coreMeasurementID: UNCHANGED_SIBLING_CORE_ID, csvRow: {} }
          ]
        })
      )
    );

    expect(response.status, 'removing the "unchanged" half of the rowPlan-status filter trips the assembly guard and 500s the whole batch').toBe(200);
    const body = await response.json();
    expect(body.code).toBeUndefined();

    expect(mocks.prepareBulkSpeciesCorrections).toHaveBeenCalledTimes(1);
    const prepareInput = mocks.prepareBulkSpeciesCorrections.mock.calls[0][1] as { members: Array<{ coreMeasurementID: number }> };
    expect(prepareInput.members.map(m => m.coreMeasurementID).sort((a, b) => a - b)).toEqual([REQUESTER_CORE_ID, UNCHANGED_SIBLING_CORE_ID]);

    // The requester's own row-local write is accounted for inside
    // applyPreparedBulkSpeciesCorrections (route.ts ~1058), not the ordinary
    // per-row loop (route.ts ~1005-1009 `continue`s past every group
    // member). The zero-change sibling is a submitted member absent from
    // updatedMemberCoreMeasurementIDs, so it increments skippedCount exactly
    // once (route.ts ~1064-1068) — never through the ordinary-row
    // zero-diff branch at ~1012, which group members never reach.
    expect(body.updatedCount).toBe(1);
    expect(body.skippedCount).toBe(1);
  });

  it('completes species-correction preparation but performs zero writes when assertAuthorizationFresh rejects immediately afterward (#427 fix F33: the single fresh-auth call sits right before the first mutation)', async () => {
    const REQUESTER_CORE_ID = 501;

    mocks.executeQuery.mockImplementation(async (query: string) => {
      if (query.includes('FROM ??.upload_sessions')) return [];
      if (query.includes('FROM ??.validation_runs')) return [];
      if (query.includes('cm.MeasuredDBH') && query.includes('cm.CoreMeasurementID IN')) {
        return [buildDbRow(REQUESTER_CORE_ID, { SpeciesCode: 'AAA' })];
      }
      return [];
    });

    mocks.analyzeBulk.mockResolvedValue(
      buildFreshPlan(MATCHED_PLAN_HASH, {
        rowCount: 1,
        rowPlans: [{ rowIndex: 0, targetID: REQUESTER_CORE_ID, status: 'matched', plan: buildGroupMemberPlan(REQUESTER_CORE_ID) }],
        speciesCorrectionGroups: [buildSpeciesCorrectionGroup([{ rowIndex: 0, coreMeasurementID: REQUESTER_CORE_ID, requestedCorrection: true }])]
      })
    );
    mocks.assertAuthorizationFresh.mockRejectedValueOnce(new mocks.MockSessionExpiredError());

    const response = await POST(
      buildRequest(
        buildValidBody({
          matchedRows: [{ coreMeasurementID: REQUESTER_CORE_ID, csvRow: { spcode: 'BBB' } }]
        })
      )
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'session expired' });

    expect(mocks.prepareBulkSpeciesCorrections, 'preparation is read-only and must complete before the fresh-auth gate').toHaveBeenCalledTimes(1);
    expect(mocks.applyPreparedBulkSpeciesCorrections).not.toHaveBeenCalled();
    expect(mocks.applyEditInTransaction).not.toHaveBeenCalled();
    expect(mocks.writeEditOperation).not.toHaveBeenCalled();
    expect(mocks.refreshMeasurementViewsForScope).not.toHaveBeenCalled();
    expect(mocks.executeQuery).not.toHaveBeenCalledWith(expect.stringContaining('DELETE FROM ??.coremeasurements'), expect.anything(), expect.anything());
    expect(mocks.executeQuery).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO ??.temporarymeasurements'), expect.anything(), expect.anything());
  });

  it('surfaces a species-correction write conflict as the FIXED safe 422 message/code, never the raw drift message, SQL fragment, coreMeasurementID, or transaction id it carried (#427 fix F34)', async () => {
    const REQUESTER_CORE_ID = 501;

    mocks.executeQuery.mockImplementation(async (query: string) => {
      if (query.includes('FROM ??.upload_sessions')) return [];
      if (query.includes('FROM ??.validation_runs')) return [];
      if (query.includes('cm.MeasuredDBH') && query.includes('cm.CoreMeasurementID IN')) {
        return [buildDbRow(REQUESTER_CORE_ID, { SpeciesCode: 'AAA' })];
      }
      return [];
    });

    mocks.analyzeBulk.mockResolvedValue(
      buildFreshPlan(MATCHED_PLAN_HASH, {
        rowCount: 1,
        rowPlans: [{ rowIndex: 0, targetID: REQUESTER_CORE_ID, status: 'matched', plan: buildGroupMemberPlan(REQUESTER_CORE_ID) }],
        speciesCorrectionGroups: [buildSpeciesCorrectionGroup([{ rowIndex: 0, coreMeasurementID: REQUESTER_CORE_ID, requestedCorrection: true }])]
      })
    );

    const sensitiveDriftMessage = `${SENSITIVE_SQL_FRAGMENT} reason=${SENSITIVE_REASON_TOKEN} coreMeasurementID=${SENSITIVE_CORE_MEASUREMENT_ID} txID=${SENSITIVE_TRANSACTION_ID_PREPARED}`;
    mocks.applyPreparedBulkSpeciesCorrections.mockRejectedValueOnce(new SpeciesCorrectionWriteConflictError({ kind: 'drift', message: sensitiveDriftMessage }));

    const response = await POST(
      buildRequest(
        buildValidBody({
          matchedRows: [{ coreMeasurementID: REQUESTER_CORE_ID, csvRow: { spcode: 'BBB' } }]
        })
      )
    );

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.code).toBe(SPECIES_CORRECTION_CONFLICT_CODE);
    expect(body.freshPlan, '409+freshPlan is reserved exclusively for actual plan-hash drift, never a write-conflict').toBeUndefined();

    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toContain(SENSITIVE_SQL_FRAGMENT);
    expect(bodyText).not.toContain(SENSITIVE_REASON_TOKEN);
    expect(bodyText).not.toContain(String(SENSITIVE_CORE_MEASUREMENT_ID));
    expect(bodyText).not.toContain(SENSITIVE_TRANSACTION_ID_PREPARED);
  });

  it('propagates a mid-apply applyPreparedBulkSpeciesCorrections failure with no ledger write and no view refresh, surfacing the FIXED safe 500 server-failure code, never leaking the transaction ids it carried (#427 fix F34)', async () => {
    const REQUESTER_CORE_ID = 501;

    mocks.executeQuery.mockImplementation(async (query: string) => {
      if (query.includes('FROM ??.upload_sessions')) return [];
      if (query.includes('FROM ??.validation_runs')) return [];
      if (query.includes('cm.MeasuredDBH') && query.includes('cm.CoreMeasurementID IN')) {
        return [buildDbRow(REQUESTER_CORE_ID, { SpeciesCode: 'AAA' })];
      }
      return [];
    });

    mocks.analyzeBulk.mockResolvedValue(
      buildFreshPlan(MATCHED_PLAN_HASH, {
        rowCount: 1,
        rowPlans: [{ rowIndex: 0, targetID: REQUESTER_CORE_ID, status: 'matched', plan: buildGroupMemberPlan(REQUESTER_CORE_ID) }],
        speciesCorrectionGroups: [buildSpeciesCorrectionGroup([{ rowIndex: 0, coreMeasurementID: REQUESTER_CORE_ID, requestedCorrection: true }])]
      })
    );

    mocks.applyPreparedBulkSpeciesCorrections.mockRejectedValueOnce(
      new SpeciesCorrectionTransactionMismatchError(SENSITIVE_TRANSACTION_ID_PREPARED, SENSITIVE_TRANSACTION_ID_APPLY)
    );

    const response = await POST(
      buildRequest(
        buildValidBody({
          matchedRows: [{ coreMeasurementID: REQUESTER_CORE_ID, csvRow: { spcode: 'BBB' } }]
        })
      )
    );

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.code).toBe(SPECIES_CORRECTION_SERVER_FAILURE_CODE);
    expect(body.freshPlan).toBeUndefined();

    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toContain(SENSITIVE_TRANSACTION_ID_PREPARED);
    expect(bodyText).not.toContain(SENSITIVE_TRANSACTION_ID_APPLY);

    // Limitation: this harness's withTransaction mock has no commit/rollback
    // spies, so it cannot observe actual rollback. Real transactional
    // atomicity is covered by the DB integration suite.
    expect(mocks.applyEditInTransaction).not.toHaveBeenCalled();
    expect(mocks.writeEditOperation, 'a mid-apply failure must never produce a ledger entry for a partially-applied batch').not.toHaveBeenCalled();
    expect(mocks.refreshMeasurementViewsForScope).not.toHaveBeenCalled();
  });

  it('maps a group-member write-context rejection raised mid-apply to the FIXED safe 500 server-failure code, never echoing the transaction ids in its message (#427)', async () => {
    const REQUESTER_CORE_ID = 501;

    mocks.executeQuery.mockImplementation(async (query: string) => {
      if (query.includes('FROM ??.upload_sessions')) return [];
      if (query.includes('FROM ??.validation_runs')) return [];
      if (query.includes('cm.MeasuredDBH') && query.includes('cm.CoreMeasurementID IN')) {
        return [buildDbRow(REQUESTER_CORE_ID, { SpeciesCode: 'AAA' })];
      }
      return [];
    });

    mocks.analyzeBulk.mockResolvedValue(
      buildFreshPlan(MATCHED_PLAN_HASH, {
        rowCount: 1,
        rowPlans: [{ rowIndex: 0, targetID: REQUESTER_CORE_ID, status: 'matched', plan: buildGroupMemberPlan(REQUESTER_CORE_ID) }],
        speciesCorrectionGroups: [buildSpeciesCorrectionGroup([{ rowIndex: 0, coreMeasurementID: REQUESTER_CORE_ID, requestedCorrection: true }])]
      })
    );

    const sensitiveContextMessage = `group-member write context transactionID ("${SENSITIVE_TRANSACTION_ID_PREPARED}") does not match this call's own transaction ("${SENSITIVE_TRANSACTION_ID_APPLY}")`;
    mocks.applyPreparedBulkSpeciesCorrections.mockRejectedValueOnce(new SpeciesCorrectionGroupMemberContextError(sensitiveContextMessage));

    const response = await POST(
      buildRequest(
        buildValidBody({
          matchedRows: [{ coreMeasurementID: REQUESTER_CORE_ID, csvRow: { spcode: 'BBB' } }]
        })
      )
    );

    const body = await response.json();
    const bodyText = JSON.stringify(body);
    expect(response.status, `response body: ${bodyText}`).toBe(500);
    expect(body.code).toBe(SPECIES_CORRECTION_SERVER_FAILURE_CODE);
    expect(bodyText).not.toContain(SENSITIVE_TRANSACTION_ID_PREPARED);
    expect(bodyText).not.toContain(SENSITIVE_TRANSACTION_ID_APPLY);
    expect(mocks.writeEditOperation, 'a mid-apply failure must never produce a ledger entry').not.toHaveBeenCalled();
  });

  it('reports the full affected species-correction membership (submitted members plus additionally-affected unsubmitted measurements) on a non-revertable ledger entry, without inflating updatedCount for the unsubmitted ones (#427)', async () => {
    const REQUESTER_CORE_ID = 501;
    const ADDITIONALLY_AFFECTED_CORE_ID = 777;

    mocks.executeQuery.mockImplementation(async (query: string) => {
      if (query.includes('FROM ??.upload_sessions')) return [];
      if (query.includes('FROM ??.validation_runs')) return [];
      if (query.includes('cm.MeasuredDBH') && query.includes('cm.CoreMeasurementID IN')) {
        return [buildDbRow(REQUESTER_CORE_ID, { SpeciesCode: 'AAA' })];
      }
      return [];
    });

    mocks.analyzeBulk.mockResolvedValue(
      buildFreshPlan(MATCHED_PLAN_HASH, {
        rowCount: 1,
        rowPlans: [{ rowIndex: 0, targetID: REQUESTER_CORE_ID, status: 'matched', plan: buildGroupMemberPlan(REQUESTER_CORE_ID) }],
        speciesCorrectionGroups: [buildSpeciesCorrectionGroup([{ rowIndex: 0, coreMeasurementID: REQUESTER_CORE_ID, requestedCorrection: true }])]
      })
    );

    const speciesCorrectionsSummary = {
      correctedTreeIDs: [SPECIES_GROUP_TREE_ID],
      updatedMemberCoreMeasurementIDs: [REQUESTER_CORE_ID],
      additionalAffectedCoreMeasurementIDs: [ADDITIONALLY_AFFECTED_CORE_ID],
      allAffectedCoreMeasurementIDs: [REQUESTER_CORE_ID, ADDITIONALLY_AFFECTED_CORE_ID],
      groups: []
    };
    mocks.applyPreparedBulkSpeciesCorrections.mockResolvedValueOnce(speciesCorrectionsSummary);

    const response = await POST(
      buildRequest(
        buildValidBody({
          matchedRows: [{ coreMeasurementID: REQUESTER_CORE_ID, csvRow: { spcode: 'BBB' } }]
        })
      )
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.speciesCorrections).toEqual(speciesCorrectionsSummary);
    expect(body.updatedCount, 'a not-submitted measurement the correction also touched must never inflate updatedCount').toBe(1);

    expect(mocks.writeEditOperation).toHaveBeenCalledTimes(1);
    const summaryArgs = mocks.writeEditOperation.mock.calls[0] as unknown as [unknown, string, Record<string, unknown>, string];
    const summaryRecord = summaryArgs[2];
    expect(summaryRecord.revertable, 'a species-correction batch ledger entry must be non-revertable').toBe(false);

    const beforeStateRow = (summaryRecord.beforeState as Array<Record<string, unknown>>)[0].row as Record<string, unknown>;
    const recordedSpeciesCorrections = beforeStateRow.speciesCorrections as typeof speciesCorrectionsSummary;
    expect(recordedSpeciesCorrections.additionalAffectedCoreMeasurementIDs).toEqual([ADDITIONALLY_AFFECTED_CORE_ID]);
    expect(recordedSpeciesCorrections.allAffectedCoreMeasurementIDs).toEqual([REQUESTER_CORE_ID, ADDITIONALLY_AFFECTED_CORE_ID]);
  });
});
