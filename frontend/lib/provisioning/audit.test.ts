import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

const { ailoggerMock } = vi.hoisted(() => ({
  ailoggerMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));
vi.mock('@/ailogger', () => ({ default: ailoggerMock }));

type AuditModule = typeof import('./audit');
let audit!: AuditModule;

describe('auditProvisioningAction', () => {
  beforeAll(async () => {
    // Reset modules so this file gets a fresh ./audit binding that resolves the
    // mocked @/ailogger above — even when a previously-run test file has
    // already imported ./audit with the real ailogger (singleFork + isolate:false).
    vi.resetModules();
    audit = await import('./audit');
  });

  beforeEach(() => vi.clearAllMocks());

  it('logs attempt at info', () => {
    audit.auditAttempt({ action: 'teardown', user: 'a@b.c', runId: 7, schemaName: 'forestgeo_x' });
    expect(ailoggerMock.info).toHaveBeenCalledWith(
      'provisioning.attempt',
      expect.objectContaining({ action: 'teardown', user: 'a@b.c', runId: 7, schemaName: 'forestgeo_x' })
    );
  });

  it('logs success at info', () => {
    audit.auditSuccess({ action: 'abort', user: 'a@b.c', runId: 8, schemaName: 'forestgeo_y' });
    expect(ailoggerMock.info).toHaveBeenCalledWith('provisioning.success', expect.objectContaining({ action: 'abort', runId: 8 }));
  });

  it('logs failure at warn with error message but not the full Error', () => {
    const err = new Error('boom');
    audit.auditFailure({ action: 'teardown', user: 'a@b.c', runId: 9, schemaName: 'forestgeo_z', error: err });
    expect(ailoggerMock.warn).toHaveBeenCalledWith(
      'provisioning.failure',
      expect.objectContaining({ action: 'teardown', user: 'a@b.c', runId: 9, schemaName: 'forestgeo_z', errorMessage: 'boom' })
    );
    const ctx = ailoggerMock.warn.mock.calls[0][1];
    expect(ctx.error).toBeUndefined();
  });

  it('omits undefined fields from the log context', () => {
    audit.auditAttempt({ action: 'start', user: 'a@b.c', schemaName: 'forestgeo_q' });
    const ctx = ailoggerMock.info.mock.calls[0][1];
    expect('runId' in ctx).toBe(false);
    expect(ctx.action).toBe('start');
    expect(ctx.user).toBe('a@b.c');
    expect(ctx.schemaName).toBe('forestgeo_q');
  });
});
