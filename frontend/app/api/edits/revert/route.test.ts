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

  return {
    auth: vi.fn(),
    isValidSchema: vi.fn(() => true),
    safeFormatQuery: vi.fn((_schema: string, query: string) => query),
    revertEdit: vi.fn(),
    readEditOperation: vi.fn(),
    closeConnection: vi.fn(async () => undefined),
    MockDisallowedFieldError,
    MockTargetNotFoundError,
    MockSpeciesNotFoundError,
    MockHashDriftError,
    MockScopeLockHeldError,
    MockEditOperationNotFoundError,
    MockAlreadyRevertedError,
    MockCannotRevertRevertError
  };
});

vi.mock('@/auth', () => ({
  auth: mocks.auth
}));

vi.mock('@/config/utils/sqlsecurity', () => ({
  isValidSchema: mocks.isValidSchema,
  safeFormatQuery: mocks.safeFormatQuery
}));

vi.mock('@/config/connectionmanager', () => ({
  default: {
    getInstance: () => ({
      closeConnection: mocks.closeConnection
    })
  }
}));

vi.mock('@/config/editplan/analyzer', () => ({
  DisallowedFieldError: mocks.MockDisallowedFieldError,
  TargetNotFoundError: mocks.MockTargetNotFoundError
}));

vi.mock('@/config/editplan/rules/context', () => ({
  SpeciesNotFoundError: mocks.MockSpeciesNotFoundError
}));

vi.mock('@/config/editplan/apply', () => ({
  HashDriftError: mocks.MockHashDriftError,
  ScopeLockHeldError: mocks.MockScopeLockHeldError
}));

vi.mock('@/config/editplan/revert', () => ({
  revertEdit: mocks.revertEdit,
  EditOperationNotFoundError: mocks.MockEditOperationNotFoundError,
  AlreadyRevertedError: mocks.MockAlreadyRevertedError,
  CannotRevertRevertError: mocks.MockCannotRevertRevertError
}));

vi.mock('@/config/editoperations', () => ({
  readEditOperation: mocks.readEditOperation
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
    mocks.auth.mockResolvedValue({ user: { email: 'mason@example.com' } });
    mocks.isValidSchema.mockReturnValue(true);
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

  it('returns 423 when revertEdit throws ScopeLockHeldError', async () => {
    mocks.revertEdit.mockRejectedValue(new mocks.MockScopeLockHeldError());
    const response = await POST(buildRequest(VALID_BODY));
    expect(response.status).toBe(423);
    await expect(response.json()).resolves.toEqual({ error: 'scope locked' });
  });

  it('returns 422 when revertEdit throws DisallowedFieldError', async () => {
    mocks.revertEdit.mockRejectedValue(new mocks.MockDisallowedFieldError(['SpeciesName']));
    const response = await POST(buildRequest(VALID_BODY));
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ error: 'disallowed fields', fields: ['SpeciesName'] });
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
    expect(mocks.revertEdit).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        schema: 'forestgeo_testing',
        editOperationID: 7,
        createdBy: 'mason@example.com'
      })
    );
    expect(mocks.closeConnection).toHaveBeenCalled();
  });
});
