import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from './route';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  requireSession: vi.fn(() => null),
  getSessionUserId: vi.fn(() => 'mason@example.com'),
  getPoolMonitorInstance: vi.fn(() => ({ pool: 'catalog-pool' })),
  getBackgroundJobWithDetails: vi.fn(),
  cancelBackgroundJob: vi.fn()
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
  cancelBackgroundJob: mocks.cancelBackgroundJob
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
  });

  it('cancels an owned queued job', async () => {
    const request = new Request('http://localhost/api/uploadjobs/42', {
      method: 'POST',
      body: JSON.stringify({ action: 'cancel' })
    }) as any;

    const response = await POST(request, { params: Promise.resolve({ jobId: '42' }) });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(mocks.cancelBackgroundJob).toHaveBeenCalledWith('catalog-pool', 42, 'mason@example.com');
  });

  it('rejects unsupported actions', async () => {
    const request = new Request('http://localhost/api/uploadjobs/42', {
      method: 'POST',
      body: JSON.stringify({ action: 'retry' })
    }) as any;

    const response = await POST(request, { params: Promise.resolve({ jobId: '42' }) });

    expect(response.status).toBe(400);
    expect(mocks.cancelBackgroundJob).not.toHaveBeenCalled();
  });
});
