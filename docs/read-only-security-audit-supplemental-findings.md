# ForestGEO Frontend Read-Only Security Audit - Supplemental Findings

Date: 2026-07-02

This note supplements the read-only audit of `feat/published-stemid-foundation`. It records findings validated directly against the repository and items that should be added or corrected in the original report.

## Summary

The original report is directionally strong. Its dominant findings are valid:

- `frontend/lib/route-policy.ts` is a policy map enforced by tests, not a runtime authorization gate.
- Middleware only enforces that `/api/*` callers are authenticated; it does not enforce per-site schema ownership.
- Several handlers interpolate request-controlled `schema` into SQL without validation.
- A number of site-scoped routes validate schema shape but do not enforce membership in `session.user.sites`.

The report is not complete. It misses at least two route-level issues and overstates safety for one endpoint family.

## Additions

### 1. `validations/validationlist` is also raw-schema injectable

Severity: Critical

Location: `frontend/app/api/validations/validationlist/route.ts`

The handler reads `schema` from `request.nextUrl.searchParams` and only checks that it is present. It then interpolates the value directly into:

```ts
SELECT ValidationID, ProcedureName, Description, Definition
FROM ${schema}.sitespecificvalidations
WHERE IsEnabled = 1;
```

This should be treated like the other raw-schema injection findings, not only as missing per-site authorization debt. It needs `validateSchemaOrThrow` or `safeFormatQuery`, plus per-site schema authorization.

### 2. `fetchall` lacks a `dataType` whitelist

Severity: High or Medium, depending on accepted threat model

Location: `frontend/app/api/fetchall/[[...slugs]]/route.ts`

`fetchall` resolves and authorizes `schema` through `validateContextualValues`, but it does not constrain `dataType`. The default branch executes:

```ts
SELECT * FROM ${schema}.${dataType}
```

Because `dataType` comes from the route slug, this can expose arbitrary tables inside an otherwise authorized schema. It also leaves the table identifier as raw SQL text. Even if mysql2 rejects multi-statement payloads by default, this should not be considered safe. Add an explicit table whitelist and identifier escaping, or route each supported data type through fixed query builders.

The original report's false-positive watchlist should be narrowed: `fixeddatafilter`, `formsearch`, and explorer helpers have schema/dataType checks, but `fetchall` does not have equivalent `dataType` validation.

### 3. Runtime route policy gap is confirmed

Severity: High

Location: `frontend/lib/route-policy.ts`, `frontend/app/api/route-policy.test.ts`, `frontend/middleware.ts`

`ROUTE_POLICIES` and `UNVERIFIED_SCHEMA_ACCESS` are only imported by `frontend/app/api/route-policy.test.ts`. They do not gate requests at runtime.

Middleware verifies authentication for non-public API paths, but it stops at session presence:

```ts
if (isApi && !isAuthenticated) {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}
```

Therefore the report's cross-tenant IDOR conclusion is valid for routes that do not call `assertSchemaAccess`, `validateContextualValues` with schema access enabled, or an equivalent runtime ownership check.

### 4. `/api/structure/[schema]` policy mismatch is valid

Severity: High

Location: `frontend/app/api/structure/[schema]/route.ts`

The route is classified as `admin` in `ROUTE_POLICIES`, but the handler has no runtime `auth()` or `requireAdmin()` call. It returns `information_schema.columns` metadata for the supplied schema parameter. This is not SQL injectable because the schema is passed as a bind parameter, but it is an authorization failure.

### 5. Validation procedure execution is broader than schema injection

Severity: Critical

Location: `frontend/app/api/validations/procedures/[validationType]/route.ts`, `frontend/components/processors/processorhelperfunctions.tsx`

The route accepts body-supplied `cursorQuery` and passes it into `runValidation`. `runValidation` rewrites pieces of the query and executes the resulting SQL. Fixing schema validation alone is insufficient; the arbitrary query execution path needs to be removed or constrained to stored, server-owned validation definitions.

### 6. Operational findings checked as valid

The following critiques from the original report are valid based on direct inspection:

- `frontend/config/poolmonitor.ts`: `connection.on('query')` and `connection.on('release')` handlers are attached on every acquired connection, so recycled MySQL connections can accumulate listeners.
- `frontend/config/connectionmanager.ts`: direct callers of `beginTransaction()` bypass `acquireTransactionSlot()`, while `commitTransaction()` and `rollbackTransaction()` still call `releaseTransactionSlot()`. This can desynchronize transaction concurrency accounting.
- `frontend/components/processors/processormacros.ts`: `escapeSql()` only doubles single quotes and is weaker than mysql2 escaping used elsewhere.
- `frontend/app/api/validations/validate-query/route.ts`: executes `EXPLAIN ${query}` for caller-supplied SQL without per-site authz. This is an information disclosure and resource-use concern even when it does not mutate data.
- `frontend/next.config.js`: only animation cache headers are configured. Security headers such as CSP, HSTS, `X-Content-Type-Options`, `Referrer-Policy`, and `Permissions-Policy` are absent.
- Application Insights environment variables are split between `NEXT_PUBLIC_APPINSIGHTS_CONNECTION_STRING` and `NEXT_PUBLIC_APP_INSIGHTS_CONNECTION_STRING`, confirming the env-validation critique.

## Recommended Ordering

1. Fix all raw-schema SQL routes, including `validations/validationlist`.
2. Add runtime per-site schema authorization for every site-scoped route, ideally through a shared route guard rather than scattered one-off checks.
3. Add a `dataType` whitelist to `fetchall`.
4. Remove or constrain body-supplied validation SQL execution.
5. Repair transaction-slot accounting and pool listener attachment.
6. Add security headers and central env validation.
