import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

// GET is wrapped by withRouteAuthz, whose Handler type requires a
// RouteContext second argument even though this route has no dynamic
// segments and never reads context.params.
const EMPTY_CONTEXT = { params: Promise.resolve({}) };
function callGet(request: any) {
  return GET(request, EMPTY_CONTEXT);
}

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  requireSession: vi.fn(() => null),
  getSessionUserIds: vi.fn(() => ['mason@example.com', 'Mason']),
  isAsyncUploadEnabledFor: vi.fn(() => true)
}));

vi.mock('@/auth', () => ({
  auth: mocks.auth
}));

vi.mock('@/lib/auth-helpers', () => ({
  requireSession: mocks.requireSession,
  getSessionUserIds: mocks.getSessionUserIds
}));

vi.mock('@/lib/background-jobs/feature-gate', () => ({
  isAsyncUploadEnabledFor: mocks.isAsyncUploadEnabledFor
}));

const AUTHORIZED_SCHEMA = 'forestgeo_testing';

const session = {
  user: {
    email: 'mason@example.com',
    name: 'Mason',
    userStatus: 'field crew',
    sites: [{ schemaName: AUTHORIZED_SCHEMA }]
  }
};

function makeRequest(query: string) {
  const url = new URL(`http://localhost/api/features/async-upload${query}`);
  const req = new Request(url.toString()) as any;
  req.nextUrl = url; // withRouteAuthz's fromQuery resolver reads request.nextUrl
  return req;
}

describe('GET /api/features/async-upload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue(session);
    mocks.isAsyncUploadEnabledFor.mockReturnValue(true);
  });

  it('reports enablement for a member schema', async () => {
    const response = await callGet(makeRequest(`?schema=${AUTHORIZED_SCHEMA}&formType=measurements`));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ enabled: true });
    expect(mocks.isAsyncUploadEnabledFor).toHaveBeenCalledWith({
      schema: AUTHORIZED_SCHEMA,
      formType: 'measurements',
      userIds: ['mason@example.com', 'Mason']
    });
  });

  it('reflects a disabled gate for a member schema', async () => {
    mocks.isAsyncUploadEnabledFor.mockReturnValue(false);

    const response = await callGet(makeRequest(`?schema=${AUTHORIZED_SCHEMA}&formType=measurements`));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ enabled: false });
  });

  it('rejects a probe with a missing schema with 400 before evaluating the feature gate', async () => {
    const response = await callGet(makeRequest('?formType=measurements'));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'INVALID_SCHEMA' });
    expect(mocks.isAsyncUploadEnabledFor).not.toHaveBeenCalled();
  });

  it('rejects a probe with an invalid schema with 400 before evaluating the feature gate', async () => {
    const response = await callGet(makeRequest('?schema=not a schema&formType=measurements'));

    expect(response.status).toBe(400);
    expect(mocks.isAsyncUploadEnabledFor).not.toHaveBeenCalled();
  });

  it('rejects a probe for a schema outside the caller session scope with 403 and never evaluates the feature gate', async () => {
    const response = await callGet(makeRequest('?schema=forestgeo_other&formType=measurements'));

    expect(response.status).toBe(403);
    expect(mocks.isAsyncUploadEnabledFor).not.toHaveBeenCalled();
  });

  it('grants an admin session access to a schema outside their sites list', async () => {
    mocks.auth.mockResolvedValue({ user: { ...session.user, userStatus: 'global', sites: [] } });

    const response = await callGet(makeRequest('?schema=forestgeo_other&formType=measurements'));

    expect(response.status).toBe(200);
    expect(mocks.isAsyncUploadEnabledFor).toHaveBeenCalledWith(expect.objectContaining({ schema: 'forestgeo_other', formType: 'measurements' }));
  });
});
