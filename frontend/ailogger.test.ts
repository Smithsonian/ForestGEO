import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { getAppInsights } from './applicationinsights';
import ailogger from './ailogger';

// The global test setup replaces @/ailogger with a stub; this suite tests the
// real implementation, so restore it and control only the AI accessor.
vi.unmock('@/ailogger');
vi.mock('./applicationinsights', () => ({
  getAppInsights: vi.fn(() => null)
}));

// Regression test for the initialization race: ailogger is a module-level
// singleton, so it is constructed the moment any page chunk imports it —
// usually BEFORE the Providers useEffect calls initializeAppInsights. The old
// implementation captured getAppInsights() once in the constructor, leaving
// the logger permanently detached (all telemetry silently dropped) whenever
// it lost that race. The logger must resolve the instance lazily instead.
describe('ailogger late-initialization binding', () => {
  const mockGetAppInsights = getAppInsights as Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAppInsights.mockReturnValue(null);
  });

  it('does not throw when Application Insights is not initialized yet', () => {
    expect(() => ailogger.event('pre-init-event')).not.toThrow();
    expect(() => ailogger.error('pre-init-error')).not.toThrow();
  });

  it('delivers telemetry emitted AFTER Application Insights initializes, even though the logger was constructed before', () => {
    // Simulate the race being lost at import time…
    ailogger.event('dropped-while-uninitialized');

    // …then Application Insights coming up (Providers useEffect ran).
    const trackEvent = vi.fn();
    const trackTrace = vi.fn();
    const trackException = vi.fn();
    mockGetAppInsights.mockReturnValue({ trackEvent, trackTrace, trackException });

    ailogger.event('login-failure-displayed', { reason: 'user-not-provisioned', email: 'someone@example.com' });
    expect(trackEvent).toHaveBeenCalledWith(
      { name: 'login-failure-displayed' },
      expect.objectContaining({ reason: 'user-not-provisioned', email: 'someone@example.com' })
    );

    ailogger.error('late error', new Error('boom'));
    expect(trackException).toHaveBeenCalledTimes(1);
    expect(trackTrace).toHaveBeenCalled();
  });

  it('survives getAppInsights throwing and falls back to console', () => {
    mockGetAppInsights.mockImplementation(() => {
      throw new Error('accessor exploded');
    });
    expect(() => ailogger.warn('still logs to console')).not.toThrow();
  });
});
