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
    analyzeEdit: vi.fn(),
    assertEditScopeAllowed: vi.fn(),
    closeConnection: vi.fn(async () => undefined),
    MockDisallowedFieldError,
    MockTargetNotFoundError,
    MockSpeciesNotFoundError,
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
  analyzeEdit: mocks.analyzeEdit,
  DisallowedFieldError: mocks.MockDisallowedFieldError,
  TargetNotFoundError: mocks.MockTargetNotFoundError
}));

vi.mock('@/config/editplan/rules/context', () => ({
  SpeciesNotFoundError: mocks.MockSpeciesNotFoundError
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
  return new Request('http://localhost/api/edits/preview', {
    method: 'POST',
    body: JSON.stringify(body)
  }) as any;
}

const VALID_BODY = {
  schema: 'forestgeo_testing',
  plotID: 1,
  censusID: 2,
  dataType: 'measurementssummary' as const,
  targetID: 42,
  newRow: { MeasuredDBH: 12.5 }
};

describe('POST /api/edits/preview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { email: 'mason@example.com', userStatus: 'field crew', sites: [{ schemaName: 'forestgeo_testing' }] } });
    mocks.isValidSchema.mockReturnValue(true);
    mocks.assertEditScopeAllowed.mockResolvedValue(undefined);
    mocks.closeConnection.mockResolvedValue(undefined);
  });

  it('returns 401 when the request is unauthenticated', async () => {
    mocks.auth.mockResolvedValue(null);
    const response = await POST(buildRequest(VALID_BODY));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'unauthorized' });
    expect(mocks.analyzeEdit).not.toHaveBeenCalled();
  });

  it('returns 400 when the body fails zod validation', async () => {
    const response = await POST(buildRequest({ ...VALID_BODY, plotID: -1 }));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('bad body');
    expect(body.details).toBeDefined();
    expect(mocks.analyzeEdit).not.toHaveBeenCalled();
  });

  it('returns 400 when the schema name fails isValidSchema', async () => {
    mocks.isValidSchema.mockReturnValue(false);
    const response = await POST(buildRequest(VALID_BODY));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'invalid schema' });
    expect(mocks.analyzeEdit).not.toHaveBeenCalled();
  });

  it('returns 403 before scope checks for pending users', async () => {
    mocks.auth.mockResolvedValue({ user: { email: 'mason@example.com', userStatus: 'pending', sites: [] } });
    const response = await POST(buildRequest(VALID_BODY));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'pending users cannot edit measurements' });
    expect(mocks.assertEditScopeAllowed).not.toHaveBeenCalled();
    expect(mocks.analyzeEdit).not.toHaveBeenCalled();
  });

  it('returns 403 when the scope guard rejects the requested scope', async () => {
    mocks.assertEditScopeAllowed.mockRejectedValue(new mocks.MockEditScopeForbiddenError());
    const response = await POST(buildRequest(VALID_BODY));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'scope forbidden' });
    expect(mocks.analyzeEdit).not.toHaveBeenCalled();
  });

  it('returns 423 when the scope guard detects active work in the scope', async () => {
    mocks.assertEditScopeAllowed.mockRejectedValue(new mocks.MockEditScopeConflictError('validation run 9 is active for this plot/census'));
    const response = await POST(buildRequest(VALID_BODY));
    expect(response.status).toBe(423);
    await expect(response.json()).resolves.toEqual({ error: 'validation run 9 is active for this plot/census' });
    expect(mocks.analyzeEdit).not.toHaveBeenCalled();
  });

  it('returns 422 when the analyzer throws DisallowedFieldError', async () => {
    mocks.analyzeEdit.mockRejectedValue(new mocks.MockDisallowedFieldError(['SpeciesName']));
    const response = await POST(buildRequest(VALID_BODY));
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ error: 'disallowed fields', fields: ['SpeciesName'] });
  });

  it('returns 422 when the analyzer throws InvalidClearError', async () => {
    mocks.analyzeEdit.mockRejectedValue(new mocks.MockInvalidClearError('SpeciesCode'));
    const response = await POST(buildRequest(VALID_BODY));
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ error: 'invalid clear', field: 'SpeciesCode' });
  });

  it('returns 422 when the analyzer throws SpeciesNotFoundError', async () => {
    mocks.analyzeEdit.mockRejectedValue(new mocks.MockSpeciesNotFoundError('UNKNOWN'));
    const response = await POST(buildRequest(VALID_BODY));
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ error: 'species not found', code: 'UNKNOWN' });
  });

  it('returns 404 when the analyzer throws TargetNotFoundError', async () => {
    mocks.analyzeEdit.mockRejectedValue(new mocks.MockTargetNotFoundError(42));
    const response = await POST(buildRequest(VALID_BODY));
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'target not found' });
  });

  it('returns 200 with the EditPlan on happy path', async () => {
    const plan = {
      dataType: 'measurementssummary',
      targetID: 42,
      fieldChanges: [{ field: 'MeasuredDBH', from: 12.0, to: 12.5 }],
      effects: [],
      maxSeverity: 'info',
      planHash: 'a'.repeat(64),
      generatedAt: '2026-04-20T00:00:00.000Z'
    };
    mocks.analyzeEdit.mockResolvedValue(plan);

    const response = await POST(buildRequest(VALID_BODY));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(plan);
    expect(mocks.assertEditScopeAllowed).toHaveBeenCalledWith(
      expect.any(Object),
      { user: { email: 'mason@example.com', userStatus: 'field crew', sites: [{ schemaName: 'forestgeo_testing' }] } },
      {
        schema: 'forestgeo_testing',
        plotID: 1,
        censusID: 2
      }
    );
    expect(mocks.analyzeEdit).toHaveBeenCalledWith(
      expect.any(Object),
      'forestgeo_testing',
      'measurementssummary',
      1,
      2,
      42,
      { MeasuredDBH: 12.5 },
      undefined,
      { role: 'field crew' }
    );
    expect(mocks.closeConnection).toHaveBeenCalled();
  });
});
