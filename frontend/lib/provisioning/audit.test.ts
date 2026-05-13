import { describe, it, expect, vi, beforeEach } from 'vitest';

const { ailoggerMock } = vi.hoisted(() => ({
  ailoggerMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));
vi.mock('@/ailogger', () => ({ default: ailoggerMock }));

import { auditAttempt, auditSuccess, auditFailure } from './audit';

describe('auditProvisioningAction', () => {
  beforeEach(() => vi.clearAllMocks());

  it('logs attempt at info', () => {
    auditAttempt({ action: 'teardown', user: 'a@b.c', runId: 7, schemaName: 'forestgeo_x' });
    expect(ailoggerMock.info).toHaveBeenCalledWith(
      'provisioning.attempt',
      expect.objectContaining({ action: 'teardown', user: 'a@b.c', runId: 7, schemaName: 'forestgeo_x' })
    );
  });

  it('logs success at info', () => {
    auditSuccess({ action: 'abort', user: 'a@b.c', runId: 8, schemaName: 'forestgeo_y' });
    expect(ailoggerMock.info).toHaveBeenCalledWith('provisioning.success', expect.objectContaining({ action: 'abort', runId: 8 }));
  });

  it('logs failure at warn with error message but not the full Error', () => {
    const err = new Error('boom');
    auditFailure({ action: 'teardown', user: 'a@b.c', runId: 9, schemaName: 'forestgeo_z', error: err });
    expect(ailoggerMock.warn).toHaveBeenCalledWith(
      'provisioning.failure',
      expect.objectContaining({ action: 'teardown', user: 'a@b.c', runId: 9, schemaName: 'forestgeo_z', errorMessage: 'boom' })
    );
    const ctx = ailoggerMock.warn.mock.calls[0][1];
    expect(ctx.error).toBeUndefined();
  });

  it('omits undefined fields from the log context', () => {
    auditAttempt({ action: 'start', user: 'a@b.c', schemaName: 'forestgeo_q' });
    const ctx = ailoggerMock.info.mock.calls[0][1];
    expect('runId' in ctx).toBe(false);
    expect(ctx.action).toBe('start');
    expect(ctx.user).toBe('a@b.c');
    expect(ctx.schemaName).toBe('forestgeo_q');
  });
});
