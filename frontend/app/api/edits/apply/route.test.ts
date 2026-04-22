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

  class MockEditScopeForbiddenError extends Error {
    constructor(message = 'scope forbidden') {
      super(message);
      this.name = 'EditScopeForbiddenError';
    }
  }

  class MockEditScopeConflictError extends Error {
    constructor(message = 'edit scope is currently busy') {
      super(message);
      this.name = 'EditScopeConflictError';
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

  return {
    auth: vi.fn(),
    isValidSchema: vi.fn(() => true),
    safeFormatQuery: vi.fn((_schema: string, query: string) => query),
    applyEdit: vi.fn(),
    assertEditScopeAllowed: vi.fn(),
    closeConnection: vi.fn(async () => undefined),
    MockDisallowedFieldError,
    MockTargetNotFoundError,
    MockSpeciesNotFoundError,
    MockHashDriftError,
    MockScopeLockHeldError,
    MockEditScopeForbiddenError,
    MockEditScopeConflictError,
    MockInvalidClearError
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
  applyEdit: mocks.applyEdit,
  HashDriftError: mocks.MockHashDriftError,
  ScopeLockHeldError: mocks.MockScopeLockHeldError
}));

vi.mock('@/config/editplan/scopeguard', () => ({
  assertEditScopeAllowed: mocks.assertEditScopeAllowed,
  EditScopeForbiddenError: mocks.MockEditScopeForbiddenError,
  EditScopeConflictError: mocks.MockEditScopeConflictError
}));

vi.mock('@/config/editplan/fieldpolicy', () => ({
  InvalidClearError: mocks.MockInvalidClearError
}));

function buildRequest(body: unknown) {
  return new Request('http://localhost/api/edits/apply', {
    method: 'POST',
    body: JSON.stringify(body)
  }) as any;
}

const VALID_PLAN_HASH = 'a'.repeat(64);
const VALID_BODY = {
  schema: 'forestgeo_testing',
  plotID: 1,
  censusID: 2,
  dataType: 'measurementssummary' as const,
  targetID: 42,
  newRow: { MeasuredDBH: 12.5 },
  planHash: VALID_PLAN_HASH
};

describe('POST /api/edits/apply', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { email: 'mason@example.com' } });
    mocks.isValidSchema.mockReturnValue(true);
    mocks.assertEditScopeAllowed.mockResolvedValue(undefined);
    mocks.closeConnection.mockResolvedValue(undefined);
  });

  it('returns 401 when unauthenticated', async () => {
    mocks.auth.mockResolvedValue(null);
    const response = await POST(buildRequest(VALID_BODY));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'unauthorized' });
    expect(mocks.applyEdit).not.toHaveBeenCalled();
  });

  it('returns 400 when the body is missing planHash', async () => {
    const { planHash: _planHash, ...rest } = VALID_BODY;
    const response = await POST(buildRequest(rest));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('bad body');
    expect(mocks.applyEdit).not.toHaveBeenCalled();
  });

  it('returns 400 when planHash is not exactly 64 chars (public bypass rejected)', async () => {
    const response = await POST(buildRequest({ ...VALID_BODY, planHash: 'short' }));
    expect(response.status).toBe(400);
    expect(mocks.applyEdit).not.toHaveBeenCalled();
  });

  it('returns 400 when schema format fails isValidSchema', async () => {
    mocks.isValidSchema.mockReturnValue(false);
    const response = await POST(buildRequest(VALID_BODY));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'invalid schema' });
  });

  it('returns 403 when the scope guard rejects the requested scope', async () => {
    mocks.assertEditScopeAllowed.mockRejectedValue(new mocks.MockEditScopeForbiddenError());
    const response = await POST(buildRequest(VALID_BODY));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'scope forbidden' });
    expect(mocks.applyEdit).not.toHaveBeenCalled();
  });

  it('returns 423 when the scope guard detects active work in the scope', async () => {
    mocks.assertEditScopeAllowed.mockRejectedValue(new mocks.MockEditScopeConflictError('upload session abc is active for this plot/census'));
    const response = await POST(buildRequest(VALID_BODY));
    expect(response.status).toBe(423);
    await expect(response.json()).resolves.toEqual({ error: 'upload session abc is active for this plot/census' });
    expect(mocks.applyEdit).not.toHaveBeenCalled();
  });

  it('returns 409 when applyEdit throws HashDriftError with the fresh plan', async () => {
    const freshPlan = { planHash: 'b'.repeat(64), fieldChanges: [] };
    mocks.applyEdit.mockRejectedValue(new mocks.MockHashDriftError(freshPlan));
    const response = await POST(buildRequest(VALID_BODY));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'plan hash mismatch', freshPlan });
  });

  it('returns 423 when applyEdit throws ScopeLockHeldError', async () => {
    mocks.applyEdit.mockRejectedValue(new mocks.MockScopeLockHeldError());
    const response = await POST(buildRequest(VALID_BODY));
    expect(response.status).toBe(423);
    await expect(response.json()).resolves.toEqual({ error: 'scope locked' });
  });

  it('returns 422 when applyEdit throws DisallowedFieldError', async () => {
    mocks.applyEdit.mockRejectedValue(new mocks.MockDisallowedFieldError(['SpeciesName']));
    const response = await POST(buildRequest(VALID_BODY));
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ error: 'disallowed fields', fields: ['SpeciesName'] });
  });

  it('returns 422 when applyEdit throws InvalidClearError', async () => {
    mocks.applyEdit.mockRejectedValue(new mocks.MockInvalidClearError('TreeTag'));
    const response = await POST(buildRequest(VALID_BODY));
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ error: 'invalid clear', field: 'TreeTag' });
  });

  it('returns 422 when applyEdit throws SpeciesNotFoundError', async () => {
    mocks.applyEdit.mockRejectedValue(new mocks.MockSpeciesNotFoundError('UNKNOWN'));
    const response = await POST(buildRequest(VALID_BODY));
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ error: 'species not found', code: 'UNKNOWN' });
  });

  it('returns 404 when applyEdit throws TargetNotFoundError', async () => {
    mocks.applyEdit.mockRejectedValue(new mocks.MockTargetNotFoundError(42));
    const response = await POST(buildRequest(VALID_BODY));
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'target not found' });
  });

  it('returns 200 with ApplyResult on happy path and forwards the session email as createdBy', async () => {
    const applyResult = {
      updatedIDs: { coremeasurements: 42 },
      applyErrors: [],
      editOperationID: 7,
      validationPending: true
    };
    mocks.applyEdit.mockResolvedValue(applyResult);

    const response = await POST(buildRequest(VALID_BODY));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(applyResult);
    expect(mocks.assertEditScopeAllowed).toHaveBeenCalledWith(
      expect.any(Object),
      { user: { email: 'mason@example.com' } },
      {
        schema: 'forestgeo_testing',
        plotID: 1,
        censusID: 2
      }
    );
    expect(mocks.applyEdit).toHaveBeenCalledTimes(1);
    expect(mocks.applyEdit).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        schema: 'forestgeo_testing',
        plotID: 1,
        censusID: 2,
        dataType: 'measurementssummary',
        targetID: 42,
        newRow: { MeasuredDBH: 12.5 },
        expectedPlanHash: VALID_PLAN_HASH,
        createdBy: 'mason@example.com'
      })
    );
    expect(mocks.closeConnection).toHaveBeenCalled();
  });
});
