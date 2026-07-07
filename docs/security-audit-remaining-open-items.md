# ForestGEO Frontend Security Audit — Remaining Open Items

Date: 2026-07-07
Branch: `security/route-authz-remediation`
Companion: [`read-only-security-audit-supplemental-findings.md`](./read-only-security-audit-supplemental-findings.md)

This tracks what is **still open** from the read-only audit after the raw-schema /
route-authz remediation landed. Every status below was verified against the working
tree on the date above — not carried over from the audit report.

## Already remediated on this branch (context, not open)

These are done and are listed only so the open items read in contrast:

- Raw-schema SQL injection closed in `details/cmid`, `formdownload`, `specieslimits`,
  `validations/validationlist`, `validations/validationerrordisplay`, and the
  `validations/procedures/*` family — all routed through `safeFormatQuery` /
  `validateSchemaOrThrow`.
- `validations/procedures/*` now executes **server-owned validation definitions**
  instead of a client-supplied `cursorQuery` (the arbitrary-SQL path is gone).
- `fetchall` gained a `dataType` whitelist + identifier escaping.
- `changelog/overview` schema injection closed (`validateContextualValues` +
  `validateSchemaOrThrow` on the URL-param fallback).
- `structure/[schema]` now requires admin at runtime.
- `withRouteAuthz` (driven by `ROUTE_POLICIES`) exists and gives runtime enforcement;
  **9 of 77** route handlers are converted so far.

---

## 1. Per-site authorization debt — the main open front

`lib/route-policy.ts` `UNVERIFIED_SCHEMA_ACCESS` still lists **34 site-scoped routes**
that authenticate the session (via middleware) but do **not** verify the caller is a
member of the target site's schema. Any logged-in user can therefore read/write
another site's data by naming its schema (cross-tenant IDOR). These are
injection-safe (schema shape is validated) — the gap is authorization only.

The remediation path is agreed: convert each onto `withRouteAuthz` and drive the set
to 0 (see the `forestgeo-route-authz-campaign` skill). Highest-value entries to take
first (writes / broad reads):

| Route | Why it ranks high |
|---|---|
| `fixeddata/[dataType]/[[...slugs]]` | POST/PATCH/DELETE writes via `coreapifunctions`, no auth |
| `fixeddatafilter/[dataType]/[[...slugs]]` | delegates to `coreapifunctions`, no auth |
| `bulkcrud` | operates on schema with no `auth()`/`validateContextualValues` |
| `reingestsinglefailure/[schema]/[targetRowID]` | mutating reingest, `safeFormatQuery` only |
| `validations/run`, `validations/updatepassedvalidations` | cross-site validation writes |
| `errors/explorer/*`, `changes/explorer/*` | broad cross-site reads, `isValidSchema` only |
| `postvalidation`, `postvalidationbyquery/...`, `refreshviews/[view]/[schema]` | schema ops, no auth |

The `setupbulk*` / `verify*` / `sqlpacketload` group authenticates via **upload-session
token ownership**, not user↔site membership — weaker than per-site authz but not
anonymous; lower priority than the routes above.

## 2. Other open security items

| Sev | Location | Item | Note |
|---|---|---|---|
| Medium | `app/api/validations/validate-query/route.ts:16,42` | `POST` executes `EXPLAIN ${query}` on caller-supplied SQL with **zero** in-handler auth (session via middleware only) and no per-site check | Query-plan / schema info disclosure + resource use by any logged-in user. Still in `UNVERIFIED_SCHEMA_ACCESS`. |
| Medium | `app/api/validations/updatepassedvalidations/route.ts` | Still listed as "raw schema from body/query, no auth" | Confirm the schema is now routed through `safeFormatQuery` **and** add per-site authz. |
| Medium | `components/processors/processormacros.ts:30-31` | `escapeSql` only doubles `'`; a value ending in `\` breaks out of the quoted literal under default `sql_mode` | Reaches SQL via datagrid `filterModel` in `fixeddatafilter`. Sibling `buildSearchStub` already uses mysql2 `escape()` — mirror it. LIKE operators are safe. |
| Medium | `next.config.js:164` `headers()` | No security headers (CSP, `X-Frame-Options`/frame-ancestors, HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`) | Clickjacking / MIME-sniffing / downgrade exposure. CORS is fine (no wildcard). |
| Low/Info | `config/utils.ts:314`, `config/uploadsessiontracker.ts:243`, +4 | `Math.random()` for batch/session/operation IDs | Not auth tokens today; only matters if `generateSessionId` becomes an authorization boundary. Genuinely security-relevant paths already use `crypto`. |

## 3. Async / connection-pool / React state

None of these are touched by the route-authz work.

| Sev | Location | Item |
|---|---|---|
| High | `config/poolmonitor.ts:175-176` | `connection.on('query'/'release')` attached on **every** acquire; mysql2 recycles connections → listeners accumulate (`MaxListenersExceededWarning`, stacked `resetInactivityTimer`). |
| High | `config/connectionmanager.ts:223` (callers `bulkcrud`, `sqlpacketload`) | Manual `beginTransaction()` bypasses `acquireTransactionSlot()` yet commit/rollback still `releaseTransactionSlot()` → uncapped concurrent upload transactions, no `KILL QUERY` watchdog, desynced slot accounting. |
| Medium | `lib/connectionlogger.ts:283-295` | Before/after diff SELECT reuses the UPDATE's full `params` against a one-placeholder query → prepared-statement param-count mismatch that can fail multi-column user UPDATEs. Needs a quick multi-column test. |
| Medium | `lib/connectionlogger.ts:219-226,320-325` | Non-transaction changelog entries drained by an unawaited `processChangelogQueue`; short-lived routes return first → silent audit-trail loss. |
| Medium | `config/poolmonitor.ts:163-168,221-244` | Unawaited `SET SESSION …` and an async inactivity-`setTimeout` whose `closeAllConnections()` rejection is fire-and-forget → unhandled rejections during teardown. |
| Medium | `app/(hub)/layout.tsx:94-187` | Cascading site→plot→census fetches use bare `fetch`, no `AbortController` → stale-response last-write-wins race. |
| Medium | `app/(hub)/layout.tsx:353-361,214-218` | `redirect()` inside `useEffect` reading `currentSite/Plot/Census` unconditionally can fire mid-reset; `redirect()`-in-effect is itself an anti-pattern. |
| Low-Med | `lib/provisioning/worker.ts:92,96-107` | `void runWithHeartbeat(...)` fire-and-forget with `try/finally` but no `catch` → unhandled rejection can crash the process past the orchestrator handler. |

## 4. Quality / maintainability

| Sev | Location | Item |
|---|---|---|
| High | `tests/site-plot-selection.test.tsx:242,249-265`; `tests/auth-flow.test.tsx:192` | Cheater tests — behavior-titled cases assert only `toBeDefined()` or re-assert their own fixtures. Violates the repo NO CHEATER TESTS rule on a core flow + an auth path. |
| Medium | `components/editplan/revertmenuitem.tsx`; `components/metrics/progresspiechart.tsx` (test-only referrer); `config/sqlrdsdefinitions/zones.ts:27` `SitesMapper` | Grep-confirmed dead code (not graph guesses). Flag, do not delete — `RevertMenuItem` may be a lost feature wire-up. |
| Medium | `config/datamapper.ts:223-289` `MapperFactory`/`IDataMapper` | Cosmetic abstraction: ~30-case switch, one real impl, `as unknown as IDataMapper` casts defeat the interface's type safety. |
| Medium | repo-wide; `config/poolmonitorsingleton.ts:10` | No fail-fast env validation. `parseInt(process.env.AZURE_SQL_PORT!)` → `NaN` if unset. App Insights var is typo-split: `NEXT_PUBLIC_APPINSIGHTS_CONNECTION_STRING` vs `..._APP_INSIGHTS_...`. |
| Low | `cypress/e2e/errors-explorer.cy.ts:81-87` ↔ `validation-invalid-codes.cy.ts:69-75`; `app/api/changes/explorer/_shared.ts` ↔ `app/api/errors/explorer/_shared.ts` | Duplicated helpers / parallel query-builder scaffolding; consolidate into shared helpers. |
| Low | many routes (`uploadsession`, `bulkcrud`, `formsearch`, `changelog/overview`, `reingestsinglefailure`) | Raw `error.message` / `details: e.message` returned to clients; inconsistent response shape. No tokens/bodies/secrets leaked. |
| Low | `middleware.ts:57` | Protected pages are an enumerated allowlist — a new sensitive page not added here renders without a redirect (data still flows through gated APIs). |
| Low | `app/api/fixeddata/[dataType]/[[...slugs]]/route.ts:81-82` | `page`/`pageSize` use bare `parseInt` (vs `parseOptionalPositiveInt` for ids) → `NaN`/negative `LIMIT`, 500 instead of 400. |

## Suggested ordering

1. Finish `withRouteAuthz` conversion — drive `UNVERIFIED_SCHEMA_ACCESS` to 0 (start with the §1 write routes), each with a 403-for-out-of-scope-schema integration test.
2. `validate-query` authz + `escapeSql` backslash fix (remaining injection-adjacent items).
3. Pool/transaction correctness (`poolmonitor` listeners, `connectionmanager` slot accounting) — these degrade under production load, not just on malicious input.
4. Security headers + central env validation.
5. Cheater-test replacement and dead-code/abstraction cleanup.

## Verification note

The `changelog/overview` **injection** is fixed but the route is still in
`UNVERIFIED_SCHEMA_ACCESS` because of the URL-param fallback authz path — it belongs to
the §1 campaign, not §2. `validate-query` and `updatepassedvalidations` remain in the
set and are the highest-severity members because they combine a mutation/exec path with
missing authz.
