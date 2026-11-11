import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

const mocks = vi.hoisted(() => {
  class MockDisallowedFieldError extends Error {
    fields: string[];
    constructor(fields: string[]) {
      super(`Disallowed fields: ${fields.join(',')}`);
      this.name = 'DisallowedFieldError';
      this.fields = fields;
    }
  }

  class MockTargetNotFoundError extends Error {
    targetID: number;
    constructor(targetID: number) {
      super(`target not found: ${targetID}`);
      this.name = 'TargetNotFoundError';
      this.targetID = targetID;
    }
  }

  class MockSpeciesNotFoundError extends Error {
    code: string;
    constructor(code: string) {
      super(`Species not found: ${code}`);
      this.name = 'SpeciesNotFoundError';
      this.code = code;
    }
  }

  class MockHashDriftError extends Error {
    freshPlan: unknown;
    constructor(freshPlan: unknown) {
      super('plan hash drift');
      this.name = 'HashDriftError';
      this.freshPlan = freshPlan;
    }
  }

  class MockScopeLockHeldError extends Error {
    constructor() {
      super('scope locked');
      this.name = 'ScopeLockHeldError';
    }
  }

  class MockSessionExpiredError extends Error {
    constructor() {
      super('session expired');
      this.name = 'SessionExpiredError';
    }
  }

  class MockRoleForbiddenFieldError extends Error {
    fields: string[];
    role: string;
    constructor(fields: string[], role = 'field crew') {
      super(`role ${role} cannot edit fields: ${fields.join(',')}`);
      this.name = 'RoleForbiddenFieldError';
      this.fields = fields;
      this.role = role;
    }
  }

  class MockEditOperationNotFoundError extends Error {
    editOperationID: number;
    constructor(editOperationID: number) {
      super(`edit operation not found: ${editOperationID}`);
      this.name = 'EditOperationNotFoundError';
      this.editOperationID = editOperationID;
    }
  }

  class MockAlreadyRevertedError extends Error {
    editOperationID: number;
    byEditOperationID: number;
    constructor(editOperationID: number, byEditOperationID: number) {
      super(`edit operation ${editOperationID} already reverted by ${byEditOperationID}`);
      this.name = 'AlreadyRevertedError';
      this.editOperationID = editOperationID;
      this.byEditOperationID = byEditOperationID;
    }
  }

  class MockCannotRevertRevertError extends Error {
    editOperationID: number;
    constructor(editOperationID: number) {
      super(`cannot revert a revert operation: ${editOperationID}`);
      this.name = 'CannotRevertRevertError';
      this.editOperationID = editOperationID;
    }
  }

  class MockNonRevertableEditOperationError extends Error {
    editOperationID: number;
    constructor(editOperationID: number) {
      super(`edit operation is not revertable: ${editOperationID}`);
      this.name = 'NonRevertableEditOperationError';
      this.editOperationID = editOperationID;
    }
  }

  class MockRevertDriftError extends Error {
    freshPlan: unknown;
    constructor(freshPlan: unknown) {
      super('revert plan has cross-row or destructive effects; confirmation required');
      this.name = 'RevertDriftError';
      this.freshPlan = freshPlan;
    }
  }

  class MockRevertRecordChangedError extends Error {
    editOperationID: number;
    constructor(editOperationID: number) {
      super(`edit operation ${editOperationID} changed between the discovery read and the locked recheck`);
      this.name = 'RevertRecordChangedError';
      this.editOperationID = editOperationID;
    }
  }

  class MockScopeAccessError extends Error {
    constructor(message = 'scope forbidden') {
      super(message);
      this.name = 'ScopeAccessError';
    }
  }

  class MockScopeBusyError extends Error {
    constructor(message = 'edit scope is currently busy') {
      super(message);
      this.name = 'ScopeBusyError';
    }
  }

  class MockInvalidClearError extends Error {
    field: string;
    constructor(field: string) {
      super(`Field "${field}" cannot be cleared`);
      this.name = 'InvalidClearError';
      this.field = field;
    }
  }

  class MockInvalidFieldValueError extends Error {
    field: string;
    value: unknown;
    constructor(field: string, value: unknown = 'bad') {
      super(`Field "${field}" has an invalid value`);
      this.name = 'InvalidFieldValueError';
      this.field = field;
      this.value = value;
    }
  }

  // --- #427 species-correction undo mappings ---------------------------
  class MockSpeciesCorrectionUndoMetadataError extends Error {
    editOperationID: number;
    constructor(editOperationID: number, message: string) {
      super(`parseSpeciesCorrectionUndoMetadata: EditOperationID=${editOperationID}: ${message}`);
      this.name = 'SpeciesCorrectionUndoMetadataError';
      this.editOperationID = editOperationID;
    }
  }

  class MockEditOperationStateIntegrityError extends Error {
    editOperationID: number;
    column: string;
    constructor(editOperationID: number, column: string, reason: string) {
      super(`EditOperationID=${editOperationID} ${column}: ${reason}`);
      this.name = 'EditOperationStateIntegrityError';
      this.editOperationID = editOperationID;
      this.column = column;
    }
  }

  class MockSpeciesCorrectionUndoUnapplicableError extends Error {
    editOperationID: number;
    reason: string;
    constructor(editOperationID: number, reason: string) {
      super(`SpeciesCorrectionUndoUnapplicableError: EditOperationID=${editOperationID}: ${reason}`);
      this.name = 'SpeciesCorrectionUndoUnapplicableError';
      this.editOperationID = editOperationID;
      this.reason = reason;
    }
  }

  class MockSpeciesCorrectionUndoCurrentStateConflictError extends Error {
    editOperationID: number;
    conflicts: Array<{ kind: string; detail: string }>;
    constructor(editOperationID: number, conflicts: Array<{ kind: string; detail: string }>) {
      super('species correction undo current-state conflict');
      this.name = 'SpeciesCorrectionUndoCurrentStateConflictError';
      this.editOperationID = editOperationID;
      this.conflicts = conflicts;
    }
  }

  class MockSpeciesCorrectionWriteConflictError extends Error {
    reason: unknown;
    constructor(reason: unknown) {
      super('species correction write conflict');
      this.name = 'SpeciesCorrectionWriteConflictError';
      this.reason = reason;
    }
  }

  return {
    auth: vi.fn(),
    isValidSchema: vi.fn(() => true),
    safeFormatQuery: vi.fn((_schema: string, query: string) => query),
    revertEdit: vi.fn(),
    readEditOperation: vi.fn(),
    ensureEditOperationsTable: vi.fn(async () => undefined),
    assertCanEditMeasurementScope: vi.fn(),
    assertNoActiveMeasurementScopeConflict: vi.fn(),
    closeConnection: vi.fn(async () => undefined),
    MockDisallowedFieldError,
    MockTargetNotFoundError,
    MockSpeciesNotFoundError,
    MockHashDriftError,
    MockScopeLockHeldError,
    MockSessionExpiredError,
    MockRoleForbiddenFieldError,
    MockEditOperationNotFoundError,
    MockAlreadyRevertedError,
    MockCannotRevertRevertError,
    MockNonRevertableEditOperationError,
    MockRevertDriftError,
    MockRevertRecordChangedError,
    MockScopeAccessError,
    MockScopeBusyError,
    MockInvalidClearError,
    MockInvalidFieldValueError,
    MockSpeciesCorrectionUndoMetadataError,
    MockEditOperationStateIntegrityError,
    MockSpeciesCorrectionUndoUnapplicableError,
    MockSpeciesCorrectionUndoCurrentStateConflictError,
    MockSpeciesCorrectionWriteConflictError
  };
});

vi.mock('@/auth', () => ({
  auth: mocks.auth
}));

vi.mock('@/lib/db/sqlsecurity', () => ({
  isValidSchema: mocks.isValidSchema,
  safeFormatQuery: mocks.safeFormatQuery
}));

vi.mock('@/lib/db/connectionmanager', () => ({
  default: {
    getInstance: () => ({
      closeConnection: mocks.closeConnection
    })
  }
}));

vi.mock('@/config/editplan/analyzer', () => ({
  DisallowedFieldError: mocks.MockDisallowedFieldError,
  RoleForbiddenFieldError: mocks.MockRoleForbiddenFieldError,
  TargetNotFoundError: mocks.MockTargetNotFoundError
}));

vi.mock('@/config/editplan/rules/context', () => ({
  SpeciesNotFoundError: mocks.MockSpeciesNotFoundError
}));

vi.mock('@/config/editplan/apply', () => ({
  HashDriftError: mocks.MockHashDriftError,
  ScopeLockHeldError: mocks.MockScopeLockHeldError,
  SessionExpiredError: mocks.MockSessionExpiredError
}));

vi.mock('@/config/editplan/revert', () => ({
  revertEdit: mocks.revertEdit,
  EditOperationNotFoundError: mocks.MockEditOperationNotFoundError,
  AlreadyRevertedError: mocks.MockAlreadyRevertedError,
  CannotRevertRevertError: mocks.MockCannotRevertRevertError,
  NonRevertableEditOperationError: mocks.MockNonRevertableEditOperationError,
  RevertDriftError: mocks.MockRevertDriftError,
  RevertRecordChangedError: mocks.MockRevertRecordChangedError
}));

vi.mock('@/config/editplan/scopeguard', () => ({
  assertCanEditMeasurementScope: mocks.assertCanEditMeasurementScope,
  assertNoActiveMeasurementScopeConflict: mocks.assertNoActiveMeasurementScopeConflict,
  ScopeAccessError: mocks.MockScopeAccessError,
  ScopeBusyError: mocks.MockScopeBusyError
}));

vi.mock('@/config/editplan/fieldpolicy', () => ({
  InvalidClearError: mocks.MockInvalidClearError,
  InvalidFieldValueError: mocks.MockInvalidFieldValueError
}));

vi.mock('@/config/editoperations', () => ({
  ensureEditOperationsTable: mocks.ensureEditOperationsTable,
  readEditOperation: mocks.readEditOperation,
  EditOperationStateIntegrityError: mocks.MockEditOperationStateIntegrityError
}));

vi.mock('@/config/editplan/species-correction-undo-metadata', () => ({
  SpeciesCorrectionUndoMetadataError: mocks.MockSpeciesCorrectionUndoMetadataError
}));

// This mock's SPECIES_CORRECTION_UNDO_CONFLICT_GUIDANCE text must stay in
// sync with the real export in species-correction-undo.ts (asserted via the
// test-local SPECIES_CORRECTION_UNDO_CONFLICT_GUIDANCE constant below) — a
// real vi.importActual isn't used here because that module also imports
// ConnectionManager as a value, which would pull in real DB wiring.
vi.mock('@/config/editplan/species-correction-undo', () => ({
  SPECIES_CORRECTION_UNDO_CONFLICT_GUIDANCE:
    "This correction can no longer be undone automatically because the affected tree's data changed after the correction was applied. Review the tree's current measurements and apply the needed change directly.",
  SpeciesCorrectionUndoCurrentStateConflictError: mocks.MockSpeciesCorrectionUndoCurrentStateConflictError,
  SpeciesCorrectionUndoUnapplicableError: mocks.MockSpeciesCorrectionUndoUnapplicableError
}));

vi.mock('@/config/editplan/tree-species-correction-writer', () => ({
  SpeciesCorrectionWriteConflictError: mocks.MockSpeciesCorrectionWriteConflictError
}));

function buildRequest(body: unknown) {
  return new Request('http://localhost/api/edits/revert', {
    method: 'POST',
    body: JSON.stringify(body)
  }) as any;
}

const VALID_BODY = {
  schema: 'forestgeo_testing',
  plotID: 1,
  censusID: 2,
  editOperationID: 7
};

function buildLedgerRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    editOperationID: 7,
    operationType: 'single-row-edit',
    revertable: true,
    dataType: 'measurementssummary',
    targetID: 42,
    plotID: 1,
    censusID: 2,
    planHash: 'a'.repeat(64),
    beforeState: [],
    afterState: [],
    createdBy: 'mason@example.com',
    createdAt: '2026-04-20T00:00:00.000Z',
    revertedByEditOperationID: null,
    ...overrides
  };
}

describe('POST /api/edits/revert', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { email: 'mason@example.com', userStatus: 'field crew', sites: [{ schemaName: 'forestgeo_testing' }] } });
    mocks.isValidSchema.mockReturnValue(true);
    mocks.assertCanEditMeasurementScope.mockResolvedValue(undefined);
    mocks.assertNoActiveMeasurementScopeConflict.mockResolvedValue(undefined);
    mocks.ensureEditOperationsTable.mockResolvedValue(undefined);
    mocks.closeConnection.mockResolvedValue(undefined);
    mocks.readEditOperation.mockResolvedValue(buildLedgerRow());
  });

  it('returns 401 when unauthenticated', async () => {
    mocks.auth.mockResolvedValue(null);
    const response = await POST(buildRequest(VALID_BODY));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'unauthorized' });
    expect(mocks.revertEdit).not.toHaveBeenCalled();
  });

  it('returns 400 on bad body', async () => {
    const response = await POST(buildRequest({ ...VALID_BODY, editOperationID: -1 }));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('bad body');
    expect(mocks.revertEdit).not.toHaveBeenCalled();
  });

  it('returns 400 on invalid schema format', async () => {
    mocks.isValidSchema.mockReturnValue(false);
    const response = await POST(buildRequest(VALID_BODY));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'invalid schema' });
    expect(mocks.revertEdit).not.toHaveBeenCalled();
  });

  it('returns 403 before scope checks for pending users', async () => {
    mocks.auth.mockResolvedValue({ user: { email: 'mason@example.com', userStatus: 'pending', sites: [] } });
    const response = await POST(buildRequest(VALID_BODY));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'pending users cannot edit measurements' });
    expect(mocks.assertCanEditMeasurementScope).not.toHaveBeenCalled();
    expect(mocks.revertEdit).not.toHaveBeenCalled();
  });

  it('returns 403 when the scope access guard rejects the requested scope', async () => {
    mocks.assertCanEditMeasurementScope.mockRejectedValue(new mocks.MockScopeAccessError());
    const response = await POST(buildRequest(VALID_BODY));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'scope forbidden' });
    expect(mocks.ensureEditOperationsTable).not.toHaveBeenCalled();
    expect(mocks.readEditOperation).not.toHaveBeenCalled();
    expect(mocks.revertEdit).not.toHaveBeenCalled();
  });

  it('returns 423 when the conflict probe detects active work in the scope', async () => {
    mocks.assertNoActiveMeasurementScopeConflict.mockRejectedValue(new mocks.MockScopeBusyError('validation run 9 is active for this plot/census'));
    const response = await POST(buildRequest(VALID_BODY));
    expect(response.status).toBe(423);
    await expect(response.json()).resolves.toEqual({ error: 'validation run 9 is active for this plot/census' });
    expect(mocks.ensureEditOperationsTable).not.toHaveBeenCalled();
    expect(mocks.readEditOperation).not.toHaveBeenCalled();
    expect(mocks.revertEdit).not.toHaveBeenCalled();
  });

  it('returns 404 when the ledger row does not exist', async () => {
    mocks.readEditOperation.mockResolvedValue(null);
    const response = await POST(buildRequest(VALID_BODY));
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'edit operation not found' });
    expect(mocks.revertEdit).not.toHaveBeenCalled();
  });

  it('returns 403 when caller-supplied plotID/censusID disagree with the ledger', async () => {
    mocks.readEditOperation.mockResolvedValue(buildLedgerRow({ plotID: 99, censusID: 2 }));
    const response = await POST(buildRequest(VALID_BODY));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'scope mismatch' });
    expect(mocks.revertEdit).not.toHaveBeenCalled();
  });

  it('returns 404 when revertEdit throws EditOperationNotFoundError', async () => {
    mocks.revertEdit.mockRejectedValue(new mocks.MockEditOperationNotFoundError(7));
    const response = await POST(buildRequest(VALID_BODY));
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'edit operation not found' });
  });

  it('returns 409 when revertEdit throws AlreadyRevertedError', async () => {
    mocks.revertEdit.mockRejectedValue(new mocks.MockAlreadyRevertedError(7, 12));
    const response = await POST(buildRequest(VALID_BODY));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'already reverted', byEditOperationID: 12 });
  });

  it('returns 422 when revertEdit throws CannotRevertRevertError', async () => {
    mocks.revertEdit.mockRejectedValue(new mocks.MockCannotRevertRevertError(7));
    const response = await POST(buildRequest(VALID_BODY));
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ error: 'cannot revert a revert operation' });
  });

  it('returns 422 when revertEdit throws NonRevertableEditOperationError', async () => {
    mocks.revertEdit.mockRejectedValue(new mocks.MockNonRevertableEditOperationError(7));
    const response = await POST(buildRequest(VALID_BODY));
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ error: 'edit operation is not revertable' });
  });

  it('returns 409 with freshPlan when revertEdit throws RevertDriftError', async () => {
    const freshPlan = {
      dataType: 'measurementssummary',
      targetID: 42,
      fieldChanges: [{ field: 'MeasuredDBH', from: 99.9, to: 12.34 }],
      effects: [{ id: 'R4', severity: 'warn', category: 'cross-row', title: 'drift', detail: '', affectedTable: 'stems', affectedRowCount: 2 }],
      maxSeverity: 'warn',
      planHash: 'p'.repeat(64),
      generatedAt: '2026-04-22T00:00:00.000Z'
    };
    mocks.revertEdit.mockRejectedValue(new mocks.MockRevertDriftError(freshPlan));
    const response = await POST(buildRequest(VALID_BODY));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'revert drift', freshPlan });
  });

  it('forwards confirmedPlanHash to revertEdit when the client retries after a drift response', async () => {
    const applyResult = { updatedIDs: { coremeasurements: 42 }, applyErrors: [], editOperationID: 9, validationPending: false };
    mocks.revertEdit.mockResolvedValue(applyResult);
    const confirmedPlanHash = 'c'.repeat(64);
    const response = await POST(buildRequest({ ...VALID_BODY, confirmedPlanHash }));
    expect(response.status).toBe(200);
    expect(mocks.revertEdit).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ editOperationID: 7, confirmedPlanHash }));
  });

  it('returns 400 when confirmedPlanHash is not a 64-char hex string', async () => {
    const response = await POST(buildRequest({ ...VALID_BODY, confirmedPlanHash: 'too-short' }));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('bad body');
    expect(mocks.revertEdit).not.toHaveBeenCalled();
  });

  it('returns 423 when revertEdit throws ScopeLockHeldError', async () => {
    mocks.revertEdit.mockRejectedValue(new mocks.MockScopeLockHeldError());
    const response = await POST(buildRequest(VALID_BODY));
    expect(response.status).toBe(423);
    await expect(response.json()).resolves.toEqual({ error: 'scope locked' });
  });

  it('returns 401 when revertEdit detects stale authorization before commit', async () => {
    mocks.revertEdit.mockRejectedValue(new mocks.MockSessionExpiredError());
    const response = await POST(buildRequest(VALID_BODY));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'session expired' });
  });

  it('returns 403 when revertEdit rejects a role-forbidden field', async () => {
    mocks.revertEdit.mockRejectedValue(new mocks.MockRoleForbiddenFieldError(['SpeciesCode'], 'field crew'));
    const response = await POST(buildRequest(VALID_BODY));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'role forbidden field', fields: ['SpeciesCode'], role: 'field crew' });
  });

  it('returns 422 when revertEdit throws DisallowedFieldError', async () => {
    mocks.revertEdit.mockRejectedValue(new mocks.MockDisallowedFieldError(['SpeciesName']));
    const response = await POST(buildRequest(VALID_BODY));
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ error: 'disallowed fields', fields: ['SpeciesName'] });
  });

  it('returns 422 when revertEdit throws InvalidClearError', async () => {
    mocks.revertEdit.mockRejectedValue(new mocks.MockInvalidClearError('QuadratName'));
    const response = await POST(buildRequest(VALID_BODY));
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ error: 'invalid clear', field: 'QuadratName' });
  });

  it('returns 422 when revertEdit throws InvalidFieldValueError', async () => {
    mocks.revertEdit.mockRejectedValue(new mocks.MockInvalidFieldValueError('Date'));
    const response = await POST(buildRequest(VALID_BODY));
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ error: 'invalid field value', field: 'Date' });
  });

  it('returns 200 with ApplyResult on happy path and forwards createdBy', async () => {
    const applyResult = {
      updatedIDs: { coremeasurements: 42 },
      applyErrors: [],
      editOperationID: 8,
      validationPending: true
    };
    mocks.revertEdit.mockResolvedValue(applyResult);

    const response = await POST(buildRequest(VALID_BODY));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(applyResult);
    expect(mocks.assertCanEditMeasurementScope).toHaveBeenCalledWith(
      expect.any(Object),
      { user: { email: 'mason@example.com', userStatus: 'field crew', sites: [{ schemaName: 'forestgeo_testing' }] } },
      {
        schema: 'forestgeo_testing',
        plotID: 1,
        censusID: 2
      }
    );
    expect(mocks.assertNoActiveMeasurementScopeConflict).toHaveBeenCalledWith(expect.any(Object), {
      schema: 'forestgeo_testing',
      plotID: 1,
      censusID: 2
    });
    expect(mocks.ensureEditOperationsTable).toHaveBeenCalledWith(expect.any(Object), 'forestgeo_testing');
    expect(mocks.revertEdit).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        schema: 'forestgeo_testing',
        editOperationID: 7,
        createdBy: 'mason@example.com',
        role: 'field crew',
        assertAuthorizationFresh: expect.any(Function)
      })
    );
    expect(mocks.closeConnection).toHaveBeenCalled();
  });

  it('forwards the authorized request-body scope to revertEdit as expectedScope', async () => {
    const applyResult = { updatedIDs: { coremeasurements: 42 }, applyErrors: [], editOperationID: 8, validationPending: false };
    mocks.revertEdit.mockResolvedValue(applyResult);

    await POST(buildRequest(VALID_BODY));

    expect(mocks.revertEdit).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ expectedScope: { plotID: VALID_BODY.plotID, censusID: VALID_BODY.censusID } })
    );
  });

  it('returns 409 when revertEdit throws RevertRecordChangedError from the locked recheck', async () => {
    mocks.revertEdit.mockRejectedValue(new mocks.MockRevertRecordChangedError(7));
    const response = await POST(buildRequest(VALID_BODY));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'edit operation changed during revert, please retry' });
  });
});

// #427 — tree-species-correction undo mappings added to the route's catch
// chain. These mirror route.ts's own (private, unexported) response shapes
// and status codes exactly, so a regression in either the mapping or an
// information leak through any of these payloads is caught here.
describe('POST /api/edits/revert — #427 species-correction undo error mappings', () => {
  // Mirrors species-correction-undo.ts's real (mocked above) exported guidance text.
  const SPECIES_CORRECTION_UNDO_CONFLICT_GUIDANCE =
    "This correction can no longer be undone automatically because the affected tree's data changed after the correction was applied. Review the tree's current measurements and apply the needed change directly.";
  // Mirrors route.ts's private SPECIES_CORRECTION_UNDO_CONFLICT_CODE — not exported, so re-declared here for assertion only.
  const SPECIES_CORRECTION_UNDO_CONFLICT_CODE = 'species-correction-undo-conflict';
  // Mirrors route.ts's private SPECIES_CORRECTION_REVERT_CONFLICT_MESSAGE/_CODE.
  const SPECIES_CORRECTION_REVERT_CONFLICT_MESSAGE = "This tree's species state changed since this revert was previewed. Refresh and retry the revert.";
  const SPECIES_CORRECTION_REVERT_CONFLICT_CODE = 'species-correction-revert-conflict';

  // Distinctive markers planted inside internal error evidence (conflict
  // `detail`, SpeciesCorrectionWriteConflictError's `reason.message`, and an
  // EditOperationStateIntegrityError's `reason`) that must never reach the
  // serialized HTTP response body.
  const UNDO_CONFLICT_DETAIL_LEAK_MARKER = 'UNDO_CONFLICT_DETAIL_LEAK_MARKER_8f21ac';
  const UNDO_CONFLICT_DETAIL_SQL_FRAGMENT = 'SELECT StemGUID FROM forestgeo_testing.stems FOR UPDATE';
  const UNDO_CONFLICT_DETAIL_JSON_FRAGMENT = '{"internalPlanHash":"should-not-leak"}';
  const WRITE_CONFLICT_REASON_MESSAGE_LEAK_MARKER = 'WRITE_CONFLICT_REASON_MESSAGE_LEAK_MARKER_3d91c7';
  const STATE_INTEGRITY_REASON_LEAK_MARKER = 'STATE_INTEGRITY_REASON_LEAK_MARKER_77ab42';
  const STATE_INTEGRITY_STORED_PAYLOAD_FRAGMENT = '{"row":{"RawSpCode":"should-not-leak-either"}}';

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { email: 'mason@example.com', userStatus: 'field crew', sites: [{ schemaName: 'forestgeo_testing' }] } });
    mocks.isValidSchema.mockReturnValue(true);
    mocks.assertCanEditMeasurementScope.mockResolvedValue(undefined);
    mocks.assertNoActiveMeasurementScopeConflict.mockResolvedValue(undefined);
    mocks.ensureEditOperationsTable.mockResolvedValue(undefined);
    mocks.closeConnection.mockResolvedValue(undefined);
    mocks.readEditOperation.mockResolvedValue(buildLedgerRow());
  });

  it('returns 422 with a generic message when revertEdit throws SpeciesCorrectionUndoMetadataError', async () => {
    mocks.revertEdit.mockRejectedValue(new mocks.MockSpeciesCorrectionUndoMetadataError(7, 'beforeState metadata.targetTreeID must be a positive integer'));
    const response = await POST(buildRequest(VALID_BODY));
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ error: 'species correction metadata is invalid' });
  });

  it('returns 422 with a generic message when revertEdit throws SpeciesCorrectionUndoUnapplicableError', async () => {
    mocks.revertEdit.mockRejectedValue(
      new mocks.MockSpeciesCorrectionUndoUnapplicableError(7, 'reverse replan returned "edited_stem_inactive": the edited stem is no longer active')
    );
    const response = await POST(buildRequest(VALID_BODY));
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ error: 'species correction undo is not applicable' });
  });

  it('returns 422 with a generic message when revertEdit throws EditOperationStateIntegrityError, and the response leaks no stored payload content from the error', async () => {
    mocks.revertEdit.mockRejectedValue(
      new mocks.MockEditOperationStateIntegrityError(
        7,
        'BeforeState',
        `${STATE_INTEGRITY_REASON_LEAK_MARKER} stored string is not valid JSON near ${STATE_INTEGRITY_STORED_PAYLOAD_FRAGMENT}`
      )
    );
    const response = await POST(buildRequest(VALID_BODY));
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body).toEqual({ error: 'edit operation state is invalid' });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(STATE_INTEGRITY_REASON_LEAK_MARKER);
    expect(serialized).not.toContain(STATE_INTEGRITY_STORED_PAYLOAD_FRAGMENT);
    expect(serialized).not.toContain('BeforeState');
  });

  it('returns 422 (never 409) with the fixed guidance and only the conflict kinds when revertEdit throws SpeciesCorrectionUndoCurrentStateConflictError, leaking no per-conflict detail', async () => {
    const conflicts = [
      {
        kind: 'tree-species',
        detail: `${UNDO_CONFLICT_DETAIL_LEAK_MARKER} current species (ID=4, code="ABC") does not match recorded afterState species; evidence: ${UNDO_CONFLICT_DETAIL_SQL_FRAGMENT}`
      },
      {
        kind: 'stem-membership',
        detail: `stem 501 current membership differs from recorded afterState membership; raw dump: ${UNDO_CONFLICT_DETAIL_JSON_FRAGMENT}`
      }
    ];
    mocks.revertEdit.mockRejectedValue(new mocks.MockSpeciesCorrectionUndoCurrentStateConflictError(7, conflicts));

    const response = await POST(buildRequest(VALID_BODY));

    expect(response.status).toBe(422);
    expect(response.status).not.toBe(409);
    const body = await response.json();
    expect(body).toEqual({
      error: SPECIES_CORRECTION_UNDO_CONFLICT_GUIDANCE,
      code: SPECIES_CORRECTION_UNDO_CONFLICT_CODE,
      conflictKinds: ['tree-species', 'stem-membership']
    });
    const serialized = JSON.stringify(body);
    expect(serialized).toContain(SPECIES_CORRECTION_UNDO_CONFLICT_GUIDANCE);
    expect(serialized).toContain('tree-species');
    expect(serialized).toContain('stem-membership');
    expect(serialized).not.toContain(UNDO_CONFLICT_DETAIL_LEAK_MARKER);
    expect(serialized).not.toContain(UNDO_CONFLICT_DETAIL_SQL_FRAGMENT);
    expect(serialized).not.toContain(UNDO_CONFLICT_DETAIL_JSON_FRAGMENT);
    expect(serialized).not.toContain('detail');
  });

  it('returns 422 with a fixed message when revertEdit throws SpeciesCorrectionWriteConflictError, never leaking reason.message', async () => {
    mocks.revertEdit.mockRejectedValue(
      new mocks.MockSpeciesCorrectionWriteConflictError({
        kind: 'drift',
        message: `${WRITE_CONFLICT_REASON_MESSAGE_LEAK_MARKER} field "MeasuredDBH" no longer matches its locked current value`
      })
    );

    const response = await POST(buildRequest(VALID_BODY));

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body).toEqual({ error: SPECIES_CORRECTION_REVERT_CONFLICT_MESSAGE, code: SPECIES_CORRECTION_REVERT_CONFLICT_CODE });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(WRITE_CONFLICT_REASON_MESSAGE_LEAK_MARKER);
    expect(serialized).not.toContain('MeasuredDBH');
    expect(serialized).not.toContain('drift');
  });

  it('still returns 409 with freshPlan for RevertDriftError, confirming 409 remains the confirmation bucket, not the species-correction-undo conflict bucket', async () => {
    const freshPlan = {
      dataType: 'measurementssummary',
      targetID: 42,
      fieldChanges: [{ field: 'SpeciesCode', from: 'PSIMEN', to: 'PSIMEN2' }],
      effects: [],
      maxSeverity: 'warn',
      planHash: 'f'.repeat(64),
      generatedAt: '2026-04-22T00:00:00.000Z'
    };
    mocks.revertEdit.mockRejectedValue(new mocks.MockRevertDriftError(freshPlan));

    const response = await POST(buildRequest(VALID_BODY));

    expect(response.status).toBe(409);
    expect(response.status).not.toBe(422);
    const body = await response.json();
    expect(body).toEqual({ error: 'revert drift', freshPlan });
    expect(body.freshPlan).toBeDefined();
  });

  it('still returns 403 with {fields, role} when revertEdit rejects a role-forbidden field on the undo path', async () => {
    mocks.revertEdit.mockRejectedValue(new mocks.MockRoleForbiddenFieldError(['SpeciesCode', 'StemLocalX'], 'field crew'));

    const response = await POST(buildRequest(VALID_BODY));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'role forbidden field', fields: ['SpeciesCode', 'StemLocalX'], role: 'field crew' });
  });

  it('returns 200 with the resolved ApplyResult, validationPending included, when the species-correction undo succeeds', async () => {
    const applyResult = {
      updatedIDs: { coremeasurements: 42, trees: 1, stems: 501 },
      applyErrors: [],
      editOperationID: 11,
      validationPending: true
    };
    mocks.revertEdit.mockResolvedValue(applyResult);

    const response = await POST(buildRequest(VALID_BODY));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(applyResult);
  });
});
