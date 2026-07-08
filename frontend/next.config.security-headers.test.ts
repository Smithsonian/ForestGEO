import { describe, expect, it } from 'vitest';

// The security posture shipped in next.config.js `headers()`. If any of these are
// dropped or renamed, the browser stops receiving the corresponding protection —
// so this test asserts the exact header set on the global `/:path*` block rather
// than merely that "some headers exist".

const GLOBAL_SOURCE = '/:path*';

const EXPECTED_SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), browsing-topics=()',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload'
} as const;

const CSP_REPORT_ONLY_HEADER = 'Content-Security-Policy-Report-Only';

// Directives that carry the real defense value of the report-only CSP: these
// block clickjacking, base-tag hijacking and plugin/object injection regardless
// of the (intentionally permissive) script/style allowances.
const REQUIRED_CSP_DIRECTIVES = ["frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'", "default-src 'self'"];

type HeaderEntry = { key: string; value: string };
type HeaderRule = { source: string; headers: HeaderEntry[] };

async function loadHeaderRules(): Promise<HeaderRule[]> {
  const mod = (await import('./next.config.js')) as unknown as { default: { headers: () => Promise<HeaderRule[]> } };
  return mod.default.headers();
}

function findGlobalRule(rules: HeaderRule[]): HeaderRule {
  const rule = rules.find(r => r.source === GLOBAL_SOURCE);
  if (!rule) {
    throw new Error(`No header rule found for source ${GLOBAL_SOURCE}; security headers are not applied globally.`);
  }
  return rule;
}

describe('next.config.js security response headers', () => {
  it('applies the security header block to every route', async () => {
    const rules = await loadHeaderRules();
    const sources = rules.map(r => r.source);
    expect(sources).toContain(GLOBAL_SOURCE);
  });

  it.each(Object.entries(EXPECTED_SECURITY_HEADERS))('sets %s to its expected value on the global block', async (key, value) => {
    const globalRule = findGlobalRule(await loadHeaderRules());
    const entry = globalRule.headers.find(h => h.key === key);
    expect(entry, `Expected header ${key} on ${GLOBAL_SOURCE}`).toBeDefined();
    expect(entry!.value).toBe(value);
  });

  it('ships a report-only CSP carrying the anti-clickjacking / anti-injection directives', async () => {
    const globalRule = findGlobalRule(await loadHeaderRules());
    const csp = globalRule.headers.find(h => h.key === CSP_REPORT_ONLY_HEADER);
    expect(csp, `Expected ${CSP_REPORT_ONLY_HEADER} on ${GLOBAL_SOURCE}`).toBeDefined();
    for (const directive of REQUIRED_CSP_DIRECTIVES) {
      expect(csp!.value).toContain(directive);
    }
  });

  it('preserves the immutable cache header on animation assets', async () => {
    const rules = await loadHeaderRules();
    const animations = rules.find(r => r.source === '/animations/:path*');
    expect(animations, 'animation cache rule must be preserved').toBeDefined();
    const cacheControl = animations!.headers.find(h => h.key === 'Cache-Control');
    expect(cacheControl!.value).toContain('immutable');
  });
});
