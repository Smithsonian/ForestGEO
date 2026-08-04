import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from './route';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  requireSession: vi.fn(() => null),
  getSessionUserId: vi.fn(() => 'mason@example.com'),
  getPoolMonitorInstance: vi.fn(() => ({ getUsablePool: vi.fn(async () => 'catalog-pool') })),
  getBackgroundJobWithDetails: vi.fn(),
  cancelBackgroundJob: vi.fn(),
  requestBackgroundJobCancel: vi.fn(),
  executeQuery: vi.fn(),
  loggerError: vi.fn()
}));

vi.mock('@/auth', () => ({
  auth: mocks.auth
}));

vi.mock('@/lib/auth-helpers', () => ({
  requireSession: mocks.requireSession,
  getSessionUserId: mocks.getSessionUserId
}));

vi.mock('@/lib/db/poolmonitorsingleton', () => ({
  getPoolMonitorInstance: mocks.getPoolMonitorInstance
}));

vi.mock('@/lib/db/connectionmanager', () => ({
  default: {
    getInstance: () => ({ executeQuery: mocks.executeQuery })
  }
}));

vi.mock('@/lib/background-jobs/repository', () => ({
  getBackgroundJobWithDetails: mocks.getBackgroundJobWithDetails,
  cancelBackgroundJob: mocks.cancelBackgroundJob,
  requestBackgroundJobCancel: mocks.requestBackgroundJobCancel
}));

vi.mock('@/ailogger', () => ({
  default: {
    error: mocks.loggerError,
    warn: vi.fn(),
    info: vi.fn()
  }
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

const ownedJob = {
  jobID: 42,
  createdBy: 'mason@example.com',
  schemaName: AUTHORIZED_SCHEMA,
  status: 'queued',
  files: [],
  events: []
};

function makeGetRequest(query: string = `?schema=${AUTHORIZED_SCHEMA}`) {
  const url = new URL(`http://localhost/api/uploadjobs/42${query}`);
  const req = new Request(url.toString()) as any;
  req.nextUrl = url; // withRouteAuthz's fromQuery resolver reads request.nextUrl
  return req;
}

function jobProps() {
  return { params: Promise.resolve({ jobId: '42' }) };
}

describe('GET /api/uploadjobs/[jobId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue(session);
    mocks.getBackgroundJobWithDetails.mockResolvedValue(ownedJob);
  });

  it('returns job details for the owner', async () => {
    const response = await GET(makeGetRequest(), jobProps());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ job: ownedJob });
    expect(mocks.getBackgroundJobWithDetails).toHaveBeenCalledWith('catalog-pool', 42);
  });

  it('returns 503 and logs when the catalog pool cannot self-heal', async () => {
    const failure = new Error('pool rebuild failed');
    mocks.getPoolMonitorInstance.mockReturnValueOnce({ getUsablePool: vi.fn().mockRejectedValue(failure) });

    const response = await GET(makeGetRequest(), jobProps());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'Upload job database is unavailable' });
    expect(mocks.getBackgroundJobWithDetails).not.toHaveBeenCalled();
    expect(mocks.loggerError).toHaveBeenCalledWith('uploadjobs.database_unavailable', failure);
  });

  it('rejects access to another user job in the same schema with 403 after a single catalog read', async () => {
    mocks.getBackgroundJobWithDetails.mockResolvedValueOnce({ ...ownedJob, createdBy: 'other@example.com' });

    const response = await GET(makeGetRequest(), jobProps());

    expect(response.status).toBe(403);
    expect(mocks.getBackgroundJobWithDetails).toHaveBeenCalledTimes(1);
  });

  it('returns 404 for missing jobs', async () => {
    mocks.getBackgroundJobWithDetails.mockResolvedValueOnce(null);

    const response = await GET(makeGetRequest(), jobProps());

    expect(response.status).toBe(404);
  });

  it('rejects a request with a missing schema with 400 before any catalog read', async () => {
    const response = await GET(makeGetRequest(''), jobProps());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'INVALID_SCHEMA' });
    expect(mocks.getBackgroundJobWithDetails).not.toHaveBeenCalled();
    expect(mocks.executeQuery).not.toHaveBeenCalled();
  });

  it('rejects a schema outside the caller session scope with 403 and zero catalog/SQL calls', async () => {
    const response = await GET(makeGetRequest('?schema=forestgeo_other'), jobProps());

    expect(response.status).toBe(403);
    expect(mocks.getBackgroundJobWithDetails).not.toHaveBeenCalled();
    expect(mocks.executeQuery).not.toHaveBeenCalled();
  });

  it('returns 404 (not job details) when the loaded job belongs to a different schema than the authorized query schema', async () => {
    // The caller is a member of forestgeo_other, so withRouteAuthz's own gate
    // passes; the job itself was created under forestgeo_testing.
    mocks.auth.mockResolvedValue({ user: { ...session.user, sites: [{ schemaName: 'forestgeo_other' }] } });
    mocks.getBackgroundJobWithDetails.mockResolvedValueOnce({ ...ownedJob, schemaName: AUTHORIZED_SCHEMA });

    const response = await GET(makeGetRequest('?schema=forestgeo_other'), jobProps());

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).not.toHaveProperty('job');
  });

  it('matches the authorized schema case-insensitively, mirroring hasSchemaAccess', async () => {
    // withRouteAuthz's assertSchemaAccess/hasSchemaAccess is case-insensitive,
    // so a job stored with a differently-cased SchemaName than the query
    // param must still resolve — otherwise a membership-valid request would
    // pass authz and then get a spurious 404 from the schema-match check.
    const differentlyCasedJob = { ...ownedJob, schemaName: 'Forestgeo_Testing' };
    mocks.getBackgroundJobWithDetails.mockResolvedValueOnce(differentlyCasedJob);

    const response = await GET(makeGetRequest(`?schema=${AUTHORIZED_SCHEMA}`), jobProps());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ job: differentlyCasedJob });
  });

  it('grants an admin session access even when the schema is not in their sites list', async () => {
    mocks.auth.mockResolvedValue({ user: { ...session.user, userStatus: 'global', sites: [] } });

    const response = await GET(makeGetRequest(), jobProps());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ job: ownedJob });
  });

  // The above admin test reuses ownedJob, whose createdBy matches the mocked
  // session user — it proves withRouteAuthz's schema-membership admin bypass
  // (assertSchemaAccess), not requireJobAccess's OWNERSHIP bypass. These two
  // tests keep the caller's sites membership intact (normal schema access)
  // and instead vary only userStatus + createdBy, isolating the ownership
  // bypass in lib/background-jobs/route-helpers.ts:requireJobAccess.
  it('grants a global-status caller access to a job owned by a different user (ownership bypass)', async () => {
    mocks.auth.mockResolvedValue({ user: { ...session.user, userStatus: 'global' } });
    const otherUsersJob = { ...ownedJob, createdBy: 'other@example.com' };
    mocks.getBackgroundJobWithDetails.mockResolvedValueOnce(otherUsersJob);

    const response = await GET(makeGetRequest(), jobProps());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ job: otherUsersJob });
  });

  it('grants a db-admin-status caller access to a job owned by a different user (ownership bypass)', async () => {
    mocks.auth.mockResolvedValue({ user: { ...session.user, userStatus: 'db admin' } });
    const otherUsersJob = { ...ownedJob, createdBy: 'other@example.com' };
    mocks.getBackgroundJobWithDetails.mockResolvedValueOnce(otherUsersJob);

    const response = await GET(makeGetRequest(), jobProps());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ job: otherUsersJob });
  });
});

describe('POST /api/uploadjobs/[jobId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue(session);
    mocks.getBackgroundJobWithDetails.mockResolvedValue(ownedJob);
    mocks.cancelBackgroundJob.mockResolvedValue(true);
    mocks.requestBackgroundJobCancel.mockResolvedValue(false);
  });

  function makeCancelRequest(action: string = 'cancel', query: string = `?schema=${AUTHORIZED_SCHEMA}`) {
    const url = new URL(`http://localhost/api/uploadjobs/42${query}`);
    const req = new Request(url.toString(), {
      method: 'POST',
      body: JSON.stringify({ action })
    }) as any;
    req.nextUrl = url; // withRouteAuthz's fromQuery resolver reads request.nextUrl
    return req;
  }

  it('cancels an owned queued job directly', async () => {
    const response = await POST(makeCancelRequest(), jobProps());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(mocks.cancelBackgroundJob).toHaveBeenCalledWith('catalog-pool', 42, 'mason@example.com');
    expect(mocks.requestBackgroundJobCancel).not.toHaveBeenCalled();
  });

  it('flips a running job to cancel_requested and reports the cancellation as pending', async () => {
    mocks.getBackgroundJobWithDetails.mockResolvedValueOnce({ ...ownedJob, status: 'running' });
    mocks.cancelBackgroundJob.mockResolvedValueOnce(false);
    mocks.requestBackgroundJobCancel.mockResolvedValueOnce(true);

    const response = await POST(makeCancelRequest(), jobProps());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, pending: true });
    expect(mocks.cancelBackgroundJob).toHaveBeenCalledWith('catalog-pool', 42, 'mason@example.com');
    expect(mocks.requestBackgroundJobCancel).toHaveBeenCalledWith('catalog-pool', 42, 'mason@example.com');
  });

  it('treats a repeat cancel of a cancel_requested job as idempotent pending success', async () => {
    mocks.getBackgroundJobWithDetails.mockResolvedValueOnce({ ...ownedJob, status: 'cancel_requested' });

    const response = await POST(makeCancelRequest(), jobProps());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, pending: true });
    expect(mocks.cancelBackgroundJob).not.toHaveBeenCalled();
    expect(mocks.requestBackgroundJobCancel).not.toHaveBeenCalled();
  });

  it('returns 409 when the job is already terminal', async () => {
    mocks.getBackgroundJobWithDetails.mockResolvedValueOnce({ ...ownedJob, status: 'completed' });
    mocks.cancelBackgroundJob.mockResolvedValueOnce(false);
    mocks.requestBackgroundJobCancel.mockResolvedValueOnce(false);

    const response = await POST(makeCancelRequest(), jobProps());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'Upload job cannot be cancelled from its current state' });
  });

  it('rejects unsupported actions', async () => {
    const response = await POST(makeCancelRequest('retry'), jobProps());

    expect(response.status).toBe(400);
    expect(mocks.cancelBackgroundJob).not.toHaveBeenCalled();
    expect(mocks.requestBackgroundJobCancel).not.toHaveBeenCalled();
  });

  it('rejects a cancel request with a missing schema with 400 before any catalog read or mutation', async () => {
    const response = await POST(makeCancelRequest('cancel', ''), jobProps());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'INVALID_SCHEMA' });
    expect(mocks.getBackgroundJobWithDetails).not.toHaveBeenCalled();
    expect(mocks.cancelBackgroundJob).not.toHaveBeenCalled();
    expect(mocks.requestBackgroundJobCancel).not.toHaveBeenCalled();
    expect(mocks.executeQuery).not.toHaveBeenCalled();
  });

  it('rejects a cancel request for a schema outside the caller session scope with 403 and zero catalog/SQL calls', async () => {
    const response = await POST(makeCancelRequest('cancel', '?schema=forestgeo_other'), jobProps());

    expect(response.status).toBe(403);
    expect(mocks.getBackgroundJobWithDetails).not.toHaveBeenCalled();
    expect(mocks.cancelBackgroundJob).not.toHaveBeenCalled();
    expect(mocks.requestBackgroundJobCancel).not.toHaveBeenCalled();
    expect(mocks.executeQuery).not.toHaveBeenCalled();
  });

  it('returns 404 without mutating the job when the loaded job belongs to a different schema than the authorized query schema', async () => {
    mocks.auth.mockResolvedValue({ user: { ...session.user, sites: [{ schemaName: 'forestgeo_other' }] } });
    mocks.getBackgroundJobWithDetails.mockResolvedValueOnce({ ...ownedJob, schemaName: AUTHORIZED_SCHEMA });

    const response = await POST(makeCancelRequest('cancel', '?schema=forestgeo_other'), jobProps());

    expect(response.status).toBe(404);
    expect(mocks.cancelBackgroundJob).not.toHaveBeenCalled();
    expect(mocks.requestBackgroundJobCancel).not.toHaveBeenCalled();
  });

  it('rejects a same-schema non-owner cancel with 403 after a single catalog read and no mutation', async () => {
    mocks.getBackgroundJobWithDetails.mockResolvedValueOnce({ ...ownedJob, createdBy: 'other@example.com' });

    const response = await POST(makeCancelRequest(), jobProps());

    expect(response.status).toBe(403);
    expect(mocks.getBackgroundJobWithDetails).toHaveBeenCalledTimes(1);
    expect(mocks.cancelBackgroundJob).not.toHaveBeenCalled();
    expect(mocks.requestBackgroundJobCancel).not.toHaveBeenCalled();
  });

  // Isolates requireJobAccess's OWNERSHIP bypass (distinct from
  // withRouteAuthz's schema-membership admin bypass): the caller keeps
  // normal site membership, only userStatus + the job's createdBy differ, so
  // a passing cancel here can only be explained by the privileged-session
  // ownership check in lib/background-jobs/route-helpers.ts.
  it('allows a global-status caller to cancel a job owned by a different user (ownership bypass)', async () => {
    mocks.auth.mockResolvedValue({ user: { ...session.user, userStatus: 'global' } });
    mocks.getBackgroundJobWithDetails.mockResolvedValueOnce({ ...ownedJob, createdBy: 'other@example.com' });

    const response = await POST(makeCancelRequest(), jobProps());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(mocks.cancelBackgroundJob).toHaveBeenCalledWith('catalog-pool', 42, 'mason@example.com');
  });

  it('allows a db-admin-status caller to cancel a job owned by a different user (ownership bypass)', async () => {
    mocks.auth.mockResolvedValue({ user: { ...session.user, userStatus: 'db admin' } });
    mocks.getBackgroundJobWithDetails.mockResolvedValueOnce({ ...ownedJob, createdBy: 'other@example.com' });

    const response = await POST(makeCancelRequest(), jobProps());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(mocks.cancelBackgroundJob).toHaveBeenCalledWith('catalog-pool', 42, 'mason@example.com');
  });
});
