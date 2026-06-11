import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from './route';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  requireSession: vi.fn(() => null),
  getSessionUserId: vi.fn(() => 'mason@example.com'),
  getPoolMonitorInstance: vi.fn(() => ({ pool: 'catalog-pool' })),
  getBackgroundJobWithDetails: vi.fn(),
  cancelBackgroundJob: vi.fn(),
  requestBackgroundJobCancel: vi.fn()
}));

vi.mock('@/auth', () => ({
  auth: mocks.auth
}));

vi.mock('@/lib/auth-helpers', () => ({
  requireSession: mocks.requireSession,
  getSessionUserId: mocks.getSessionUserId
}));

vi.mock('@/config/poolmonitorsingleton', () => ({
  getPoolMonitorInstance: mocks.getPoolMonitorInstance
}));

vi.mock('@/lib/background-jobs/repository', () => ({
  getBackgroundJobWithDetails: mocks.getBackgroundJobWithDetails,
  cancelBackgroundJob: mocks.cancelBackgroundJob,
  requestBackgroundJobCancel: mocks.requestBackgroundJobCancel
}));

const session = {
  user: {
    email: 'mason@example.com',
    name: 'Mason',
    userStatus: 'field crew'
  }
};

const ownedJob = {
  jobID: 42,
  createdBy: 'mason@example.com',
  status: 'queued',
  files: [],
  events: []
};

describe('GET /api/uploadjobs/[jobId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue(session);
    mocks.getBackgroundJobWithDetails.mockResolvedValue(ownedJob);
  });

  it('returns job details for the owner', async () => {
    const response = await GET(new Request('http://localhost/api/uploadjobs/42') as any, { params: Promise.resolve({ jobId: '42' }) });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ job: ownedJob });
    expect(mocks.getBackgroundJobWithDetails).toHaveBeenCalledWith('catalog-pool', 42);
  });

  it('rejects access to another user job', async () => {
    mocks.getBackgroundJobWithDetails.mockResolvedValueOnce({ ...ownedJob, createdBy: 'other@example.com' });

    const response = await GET(new Request('http://localhost/api/uploadjobs/42') as any, { params: Promise.resolve({ jobId: '42' }) });

    expect(response.status).toBe(403);
  });

  it('returns 404 for missing jobs', async () => {
    mocks.getBackgroundJobWithDetails.mockResolvedValueOnce(null);

    const response = await GET(new Request('http://localhost/api/uploadjobs/42') as any, { params: Promise.resolve({ jobId: '42' }) });

    expect(response.status).toBe(404);
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

  function makeCancelRequest(action: string = 'cancel') {
    return new Request('http://localhost/api/uploadjobs/42', {
      method: 'POST',
      body: JSON.stringify({ action })
    }) as any;
  }

  it('cancels an owned queued job directly', async () => {
    const response = await POST(makeCancelRequest(), { params: Promise.resolve({ jobId: '42' }) });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(mocks.cancelBackgroundJob).toHaveBeenCalledWith('catalog-pool', 42, 'mason@example.com');
    expect(mocks.requestBackgroundJobCancel).not.toHaveBeenCalled();
  });

  it('flips a running job to cancel_requested and reports the cancellation as pending', async () => {
    mocks.getBackgroundJobWithDetails.mockResolvedValueOnce({ ...ownedJob, status: 'running' });
    mocks.cancelBackgroundJob.mockResolvedValueOnce(false);
    mocks.requestBackgroundJobCancel.mockResolvedValueOnce(true);

    const response = await POST(makeCancelRequest(), { params: Promise.resolve({ jobId: '42' }) });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, pending: true });
    expect(mocks.cancelBackgroundJob).toHaveBeenCalledWith('catalog-pool', 42, 'mason@example.com');
    expect(mocks.requestBackgroundJobCancel).toHaveBeenCalledWith('catalog-pool', 42, 'mason@example.com');
  });

  it('treats a repeat cancel of a cancel_requested job as idempotent pending success', async () => {
    mocks.getBackgroundJobWithDetails.mockResolvedValueOnce({ ...ownedJob, status: 'cancel_requested' });

    const response = await POST(makeCancelRequest(), { params: Promise.resolve({ jobId: '42' }) });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, pending: true });
    expect(mocks.cancelBackgroundJob).not.toHaveBeenCalled();
    expect(mocks.requestBackgroundJobCancel).not.toHaveBeenCalled();
  });

  it('returns 409 when the job is already terminal', async () => {
    mocks.getBackgroundJobWithDetails.mockResolvedValueOnce({ ...ownedJob, status: 'completed' });
    mocks.cancelBackgroundJob.mockResolvedValueOnce(false);
    mocks.requestBackgroundJobCancel.mockResolvedValueOnce(false);

    const response = await POST(makeCancelRequest(), { params: Promise.resolve({ jobId: '42' }) });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'Upload job cannot be cancelled from its current state' });
  });

  it('rejects unsupported actions', async () => {
    const response = await POST(makeCancelRequest('retry'), { params: Promise.resolve({ jobId: '42' }) });

    expect(response.status).toBe(400);
    expect(mocks.cancelBackgroundJob).not.toHaveBeenCalled();
    expect(mocks.requestBackgroundJobCancel).not.toHaveBeenCalled();
  });
});
