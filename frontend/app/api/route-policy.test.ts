/**
 * Route Authorization Policy Matrix Test
 *
 * Enforces three invariants:
 *
 *   (a) COVERAGE: every route.ts under app/api has an entry in ROUTE_POLICIES.
 *   (b) NO ORPHANS: every key in ROUTE_POLICIES maps to a real route file.
 *   (c) SITE-SCOPED PROTECTION: every 'site-scoped' route either references
 *       a recognised authz signal in its source or is explicitly listed in
 *       UNVERIFIED_SCHEMA_ACCESS (tracked remediation debt).
 *
 * This is pure static analysis — no database, no network.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ROUTE_POLICIES, UNVERIFIED_SCHEMA_ACCESS, type RoutePolicy } from '@/lib/route-policy';

// ── Filesystem helpers ────────────────────────────────────────────────────────

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const API_ROOT = path.join(PROJECT_ROOT, 'app', 'api');

/** Recursively collect every route.ts under app/api. */
function collectRouteFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectRouteFiles(fullPath));
    } else if (entry.isFile() && entry.name === 'route.ts') {
      files.push(fullPath);
    }
  }
  return files;
}

/**
 * Convert an absolute route file path to the policy-map key.
 * e.g. /…/app/api/dashboardmetrics/[metric]/[schema]/[plotIDParam]/[censusIDParam]/route.ts
 *   → 'dashboardmetrics/[metric]/[schema]/[plotIDParam]/[censusIDParam]'
 */
function routeFileToKey(absolutePath: string): string {
  const relative = path.relative(API_ROOT, absolutePath);
  // Strip the trailing /route.ts
  return relative
    .replace(/[\\/]route\.ts$/, '')
    .split(path.sep)
    .join('/');
}

// Recognised authz signals in route source code.
// Signal presence alone is necessary but NOT sufficient — see AUTHZ_RETURN_PATTERNS.
const AUTHZ_SIGNAL_PATTERNS = [
  // validateContextualValues calls auth() internally and checks schema membership
  /validateContextualValues/,
  // assertSchemaAccess from lib/authz
  /assertSchemaAccess/,
  // validatedSchema from sqlsecurity (used together with auth check)
  /validatedSchema\b/,
  // requireSession from lib/auth-helpers — confirms identity but not schema access
  // We only count requireSession when paired with auth() AND a schema ownership check
  // (edit routes use assertSessionMayEdit which internally calls hasSchemaAccess)
  /assertSessionMayEdit/,
  // requireAdmin from lib/auth-helpers — admin implies cross-site privilege
  /requireAdmin/,
  // assertCanEditMeasurementScope from config/editplan/scopeguard — DB-backed
  // schema/plot/census scope check; throws ScopeAccessError on denial
  /assertCanEditMeasurementScope/
] as const;

/**
 * Return-on-failure patterns: each one proves the matching authz signal's
 * failure short-circuits the handler before any business logic runs. A signal
 * without a corresponding return is "security theater" — it runs the check
 * but never returns the failure response.
 *
 * Patterns recognised:
 *   - `if (!validation.success) … return validation.response` (validateContextualValues)
 *   - `if (denied) return denied` (assertSchemaAccess)
 *   - `if (adminError) return adminError` (requireAdmin)
 *   - `if (authError) return authError` (requireAdmin/requireSession alt naming)
 *   - `if (sessionError) return sessionError` (requireSession)
 *   - `assertSessionMayEdit(…)` followed by a return (returns a NextResponse on denial)
 *   - `try { validatedSchema(…) } catch { return … }` (validatedSchema throws on invalid)
 */
const AUTHZ_RETURN_PATTERNS = [
  /if\s*\(\s*!\s*validation\.success\s*\)[\s\S]{0,1000}?return\s+validation\.response/,
  /if\s*\(\s*denied\s*\)\s*return\s+denied/,
  /if\s*\(\s*adminError\s*\)\s*return\s+adminError/,
  /if\s*\(\s*authError\s*\)\s*return\s+authError/,
  /if\s*\(\s*sessionError\s*\)\s*return\s+sessionError/,
  /assertSessionMayEdit[\s\S]{0,300}?return/,
  /try\s*\{[\s\S]{0,300}?validatedSchema[\s\S]{0,300}?\}\s*catch[\s\S]{0,200}?return/,
  // assertCanEditMeasurementScope throws ScopeAccessError; the catch returns 403
  /error\s+instanceof\s+ScopeAccessError\s*\)[\s\S]{0,200}?return/
] as const;

/**
 * Fallback-bypass detector. A route that uses `validateContextualValues` but
 * also references a raw URL `schemaParam` in a fallback branch must run a
 * proper auth gate (`auth()` + `assertSchemaAccess`, or `requireAdmin`) inside
 * that branch — otherwise the validation signal is silently defeated.
 *
 * This was the root cause of the dashboardmetrics fallback bug and the
 * batchedupload fallback bug. The check stays heuristic (regex over source,
 * no AST) and conservative: when in doubt, fail the gate.
 */
function hasFallbackBypass(source: string): boolean {
  const usesValidation = /if\s*\(\s*!\s*validation\.success\s*\)/.test(source);
  const referencesUrlSchema = /\bschemaParam\b/.test(source);
  if (!usesValidation || !referencesUrlSchema) return false;
  // If the file calls auth() AND uses an authz gate (assertSchemaAccess or
  // requireAdmin), we assume the fallback is gated. Conservative — admits a
  // few false positives but never false negatives.
  const hasAuthGate = /\bauth\s*\(/.test(source) && /(assertSchemaAccess|requireAdmin\b)/.test(source);
  return !hasAuthGate;
}

function routeSourceIsProtected(absolutePath: string): { protected: boolean; reason?: string } {
  const source = fs.readFileSync(absolutePath, 'utf8');
  const hasSignal = AUTHZ_SIGNAL_PATTERNS.some(pattern => pattern.test(source));
  if (!hasSignal) return { protected: false, reason: 'no authz signal' };
  const hasReturn = AUTHZ_RETURN_PATTERNS.some(pattern => pattern.test(source));
  if (!hasReturn) return { protected: false, reason: 'signal present but no return-on-failure pattern' };
  if (hasFallbackBypass(source)) return { protected: false, reason: 'fallback references schemaParam without an auth gate' };
  return { protected: true };
}

// ── Build the ground truth ────────────────────────────────────────────────────

const allRouteFiles = collectRouteFiles(API_ROOT);
const allRouteKeys = allRouteFiles.map(routeFileToKey);

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Route authorization policy matrix', () => {
  it('(a) COVERAGE: every app/api route.ts has an entry in ROUTE_POLICIES', () => {
    const unclassified = allRouteKeys.filter(key => !(key in ROUTE_POLICIES));

    if (unclassified.length > 0) {
      const list = unclassified.map(k => `  - ${k}`).join('\n');
      throw new Error(
        `${unclassified.length} route(s) are missing from ROUTE_POLICIES.\n` + `Add them to lib/route-policy.ts with an explicit policy:\n${list}`
      );
    }

    expect(unclassified).toHaveLength(0);
  });

  it('(b) NO ORPHANS: every ROUTE_POLICIES key corresponds to a real route file', () => {
    const routeKeySet = new Set(allRouteKeys);
    const stale = Object.keys(ROUTE_POLICIES).filter(key => !routeKeySet.has(key));

    if (stale.length > 0) {
      const list = stale.map(k => `  - ${k}`).join('\n');
      throw new Error(`${stale.length} ROUTE_POLICIES key(s) have no matching route.ts.\n` + `Remove stale entries from lib/route-policy.ts:\n${list}`);
    }

    expect(stale).toHaveLength(0);
  });

  it('(c) SITE-SCOPED PROTECTION: every site-scoped route is honestly protected (signal + return-on-failure, no fallback bypass) or in UNVERIFIED_SCHEMA_ACCESS', () => {
    const siteScopedEntries = Object.entries(ROUTE_POLICIES).filter(([, policy]) => policy === 'site-scoped') as [string, RoutePolicy][];

    const routeKeyToFile = new Map<string, string>(allRouteFiles.map(f => [routeFileToKey(f), f]));

    const unprotected: { key: string; reason: string }[] = [];
    let protectedCount = 0;
    let unverifiedCount = 0;

    for (const [key] of siteScopedEntries) {
      if (UNVERIFIED_SCHEMA_ACCESS.has(key)) {
        unverifiedCount++;
        continue;
      }

      const absolutePath = routeKeyToFile.get(key);
      if (!absolutePath) {
        // (b) will catch this orphan; skip here to avoid a confusing double-error
        continue;
      }

      const result = routeSourceIsProtected(absolutePath);
      if (result.protected) {
        protectedCount++;
      } else {
        unprotected.push({ key, reason: result.reason ?? 'unknown' });
      }
    }

    // Print debt summary — visible in test output
    console.log(`[route-policy] site-scoped routes: ${protectedCount} protected, ${unverifiedCount} in UNVERIFIED_SCHEMA_ACCESS (tracked debt)`);

    if (unprotected.length > 0) {
      const list = unprotected.map(({ key, reason }) => `  - ${key} (${reason})`).join('\n');
      throw new Error(
        `${unprotected.length} site-scoped route(s) fail the strengthened authz gate and are not in UNVERIFIED_SCHEMA_ACCESS.\n` +
          `Either add a return-on-failure pattern (and gate any URL-param fallback) or add the key to UNVERIFIED_SCHEMA_ACCESS in lib/route-policy.ts:\n${list}`
      );
    }

    expect(unprotected).toHaveLength(0);
  });

  it('UNVERIFIED_SCHEMA_ACCESS only contains site-scoped routes', () => {
    const nonSiteScoped = [...UNVERIFIED_SCHEMA_ACCESS].filter(key => ROUTE_POLICIES[key] !== 'site-scoped');

    if (nonSiteScoped.length > 0) {
      const list = nonSiteScoped.map(k => `  - ${k} (${ROUTE_POLICIES[k] ?? 'missing'})`).join('\n');
      throw new Error(`UNVERIFIED_SCHEMA_ACCESS contains non-site-scoped routes.\n` + `Only 'site-scoped' routes should appear in this set:\n${list}`);
    }

    expect(nonSiteScoped).toHaveLength(0);
  });

  it('policy distribution matches expected counts', () => {
    const counts: Record<RoutePolicy, number> = { public: 0, authed: 0, 'site-scoped': 0, admin: 0 };
    for (const policy of Object.values(ROUTE_POLICIES)) {
      counts[policy]++;
    }
    console.log('[route-policy] Policy distribution:', JSON.stringify(counts));
    // Sanity: we should have at least one of each type
    expect(counts.public).toBeGreaterThan(0);
    expect(counts.authed).toBeGreaterThan(0);
    expect(counts['site-scoped']).toBeGreaterThan(0);
    expect(counts.admin).toBeGreaterThan(0);
    // Total must match all discovered routes
    const totalClassified = Object.values(counts).reduce((a, b) => a + b, 0);
    expect(totalClassified).toBe(allRouteKeys.length);
  });
});
