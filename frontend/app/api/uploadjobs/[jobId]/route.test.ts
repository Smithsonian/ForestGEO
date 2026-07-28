import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from './route';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  requireSession: vi.fn(() => null),
  getSessionUserId: vi.fn(() => 'mason@example.com'),
  getPoolMonitorInstance: vi.fn(() => ({ pool: 'catalog-pool' })),
  getBackgroundJobWithDetails: vi.fn(),
  cancelBackgroundJob: vi.fn(),
  requestBackgroundJobCancel: vi.fn(),
  executeQuery: vi.fn()
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

  it('grants an admin session access even when the schema is not in their sites list', async () => {
    mocks.auth.mockResolvedValue({ user: { ...session.user, userStatus: 'global', sites: [] } });

    const response = await GET(makeGetRequest(), jobProps());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ job: ownedJob });
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
});
