import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// getAppInsightsConnectionString() reconciles the two historical env-var
// spellings. The bug it fixes: the user-sync hook read the legacy underscore-less
// name, so telemetry user context never attached when only the canonical name was
// configured. These tests pin the precedence and the one-time deprecation warning.

const CANONICAL_VAR = 'NEXT_PUBLIC_APP_INSIGHTS_CONNECTION_STRING';
const LEGACY_VAR = 'NEXT_PUBLIC_APPINSIGHTS_CONNECTION_STRING';

const CANONICAL_VALUE = 'InstrumentationKey=canonical-key;IngestionEndpoint=https://canonical.example/';
const LEGACY_VALUE = 'InstrumentationKey=legacy-key;IngestionEndpoint=https://legacy.example/';

let savedCanonical: string | undefined;
let savedLegacy: string | undefined;

async function freshAccessor() {
  // Reset modules so the module-private "warned once" flag starts false per test.
  vi.resetModules();
  const mod = await import('./applicationinsights');
  return mod.getAppInsightsConnectionString;
}

beforeEach(() => {
  savedCanonical = process.env[CANONICAL_VAR];
  savedLegacy = process.env[LEGACY_VAR];
  delete process.env[CANONICAL_VAR];
  delete process.env[LEGACY_VAR];
});

afterEach(() => {
  if (savedCanonical === undefined) delete process.env[CANONICAL_VAR];
  else process.env[CANONICAL_VAR] = savedCanonical;
  if (savedLegacy === undefined) delete process.env[LEGACY_VAR];
  else process.env[LEGACY_VAR] = savedLegacy;
  vi.restoreAllMocks();
});

describe('getAppInsightsConnectionString', () => {
  it('returns the canonical var when it is set', async () => {
    process.env[CANONICAL_VAR] = CANONICAL_VALUE;
    const getConn = await freshAccessor();
    expect(getConn()).toBe(CANONICAL_VALUE);
  });

  it('prefers the canonical var over the legacy var when both are set, without warning', async () => {
    process.env[CANONICAL_VAR] = CANONICAL_VALUE;
    process.env[LEGACY_VAR] = LEGACY_VALUE;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const getConn = await freshAccessor();
    expect(getConn()).toBe(CANONICAL_VALUE);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('falls back to the legacy var and warns exactly once about the deprecation', async () => {
    process.env[LEGACY_VAR] = LEGACY_VALUE;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const getConn = await freshAccessor();

    expect(getConn()).toBe(LEGACY_VALUE);
    expect(getConn()).toBe(LEGACY_VALUE);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain(LEGACY_VAR);
    expect(warnSpy.mock.calls[0][0]).toContain(CANONICAL_VAR);
  });

  it('returns undefined when neither var is set', async () => {
    const getConn = await freshAccessor();
    expect(getConn()).toBeUndefined();
  });
});
