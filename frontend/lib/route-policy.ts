/**
 * API Route Authorization Policy Map
 *
 * Every entry in app/api must appear here with an explicit policy.  The
 * companion test (app/api/route-policy.test.ts) enforces:
 *
 *   1. COVERAGE  – every route.ts in app/api has an entry here.
 *   2. NO ORPHANS – every key here corresponds to a real route file.
 *   3. SITE-SCOPED PROTECTION – every 'site-scoped' route either references
 *      a recognised authz signal in its source or is listed in
 *      UNVERIFIED_SCHEMA_ACCESS (tracked remediation debt).
 *
 * Policy definitions:
 *   public        – no authentication required
 *   authed        – requires a logged-in session; no per-site restriction
 *   site-scoped   – operates on a per-site schema; must enforce per-site access
 *   admin         – privileged / cross-site / destructive; requires admin role
 *
 * Keys are the route path relative to app/api (without leading slash and
 * without the trailing /route.ts suffix), e.g.:
 *   'dashboardmetrics/[metric]/[schema]/[plotIDParam]/[censusIDParam]'
 */

export type RoutePolicy = 'public' | 'authed' | 'site-scoped' | 'admin';

export const ROUTE_POLICIES = {
  // ── Public routes (no auth required) ─────────────────────────────────────
  // Health probe – intentionally public for Azure App Service health checks
  health: 'public',
  // NextAuth handler – manages auth flows themselves
  'auth/[[...nextauth]]': 'public',
  // Lottie animation assets served from the filesystem (allowlisted filenames)
  'animations/[filename]': 'public',
  // Clears site-selection cookies on logout; no sensitive data written
  clearallcookies: 'public',
  // Diagnostics probe restricted to an explicit host allowlist, not user auth
  'diagnostics/streaming-timeout': 'public',
  // E2E-only fresh-authorization poll stub for the real-DB Cypress edit-apply
  // flow. Hard-gated to NEXT_PUBLIC_E2E_TESTING === 'true' && NODE_ENV !==
  // 'production' (404 otherwise), so it is unreachable in any real deployment;
  // 'public' reflects that the edit-plan freshness check polls it server-to-
  // server without a session cookie.
  'e2e-auth-poll': 'public',

  // ── Authed routes (session required, no per-site restriction) ────────────
  // Catalog user lookup – cross-site catalog.users table, no schema scoping
  'catalog/[firstName]/[lastName]': 'authed',
  // Raw SQL query endpoint – hybrid posture, NOT a pure admin route:
  //   • requires a session (requireSession) — hence 'authed', not 'public'
  //   • admins may run any SQL; non-admins may run read-only SELECTs against
  //     schemas in session.user.sites (enforced in authorizeQuery via
  //     hasSchemaAccess). Multi-statement and write SQL are 403 for non-admins.
  // This does not fit 'site-scoped' (no single declared schema in the URL) nor
  // 'admin' (the route is reachable to non-admins for read-only queries).
  // Do not re-tighten to 'admin' without removing the non-admin branch in
  // authorizeQuery — the prior 'admin' classification mismatched the runtime.
  query: 'authed',

  // ── Admin routes (admin role required) ───────────────────────────────────
  // Hard-delete of table data for a census – destructive, admin only
  'admin/clear/[tableType]/[schema]/[plotID]/[censusID]': 'admin',
  // Site provisioning orchestration – cross-site privileged ops
  'admin/provision/[runId]/abort': 'admin',
  'admin/provision/[runId]/mark-failed': 'admin',
  'admin/provision/[runId]/reconcile': 'admin',
  'admin/provision/[runId]/retry': 'admin',
  'admin/provision/[runId]': 'admin',
  'admin/provision/[runId]/teardown': 'admin',
  'admin/provision/list': 'admin',
  'admin/provision': 'admin',
  // Cross-site admin data fetch (email/user lookups, etc.)
  'administrative/fetch/[type]': 'admin',
  // Validation rule CRUD – modifying site validation config is admin-only
  'validations/crud': 'admin',
  // Schema structure introspection – exposes full table/column metadata
  'structure/[schema]': 'admin',
  // Global cleanup of abandoned sessions and orphaned data
  cleanup: 'admin',
  'cleanup/status': 'admin',
  // Census hard-clear stored procedures (destructive, no per-user auth — classified admin for privilege)
  clearcensus: 'admin',

  // ── Site-scoped routes ────────────────────────────────────────────────────
  // ArcGIS two-sheet xlsx import — both gate on assertCanEditMeasurementScope
  // (schema/plot/census scope check) and return 403 on ScopeAccessError
  'arcgis/preflight': 'site-scoped',
  'arcgis/commit': 'site-scoped',
  // Bulk upload ingestion pipeline
  'batchedupload/[schema]/[[...slugs]]': 'site-scoped',
  bulkcrud: 'site-scoped',
  'setupbulkcollapser/[censusID]': 'site-scoped',
  'setupbulkfailure/[fileID]/[batchID]': 'site-scoped',
  'setupbulkprocedure/[fileID]/[batchID]': 'site-scoped',
  'setupbulkprocessor/[schema]/[plotID]/[censusID]': 'site-scoped',
  sqlpacketload: 'site-scoped',
  uploadsession: 'site-scoped',
  verifyprocessing: 'site-scoped',
  verifysession: 'site-scoped',
  verifyupload: 'site-scoped',
  prevalidate: 'site-scoped',
  revisionupload: 'site-scoped',
  'revisionupload/apply': 'site-scoped',
  // Dashboard metrics
  'dashboardmetrics/[metric]/[schema]/[plotIDParam]/[censusIDParam]': 'site-scoped',
  'dashboardmetrics/all/[schema]/[plotID]/[censusID]': 'site-scoped',
  // Data fetch / paged data views
  'fetchall/[[...slugs]]': 'site-scoped',
  'fixeddata/[dataType]/[[...slugs]]': 'site-scoped',
  'fixeddatafilter/[dataType]/[[...slugs]]': 'site-scoped',
  'formdownload/[dataType]/[[...slugs]]': 'site-scoped',
  'formsearch/[dataType]': 'site-scoped',
  'formvalidation/[dataType]/[[...slugs]]': 'site-scoped',
  'details/cmid': 'site-scoped',
  'specieslimits/[plotID]/[plotCensusNumber]': 'site-scoped',
  'resettableview/[gridType]/[plotID]/[censusID]': 'site-scoped',
  // Changelog
  'changelog/overview/[changelogType]/[[...options]]': 'site-scoped',
  // Recent changes explorer
  'changes/explorer/facets': 'site-scoped',
  'changes/explorer/query': 'site-scoped',
  // Errors / validation explorer
  'errors/explorer/details/[measurementID]': 'site-scoped',
  'errors/explorer/facets': 'site-scoped',
  'errors/explorer/query': 'site-scoped',
  // CMP revalidation
  'cmprevalidation/[dataType]/[[...slugs]]': 'site-scoped',
  // Post-validation queries
  postvalidation: 'site-scoped',
  'postvalidationbyquery/[schema]/[plotID]/[censusID]/[queryID]': 'site-scoped',
  // Validation run management and procedures
  'validations/procedures/[validationType]': 'site-scoped',
  'validations/procedures/shared-cross-census-location': 'site-scoped',
  'validations/procedures/shared-dbh': 'site-scoped',
  'validations/run': 'site-scoped',
  'validations/updatepassedvalidations': 'site-scoped',
  'validations/validate-query': 'site-scoped',
  'validations/validationerrordisplay': 'site-scoped',
  'validations/validationlist': 'site-scoped',
  // Failed measurement management
  'validatefailed/[schema]/[plotID]/[censusID]': 'site-scoped',
  'reingest/[schema]/[plotID]/[censusID]': 'site-scoped',
  'reingestsinglefailure/[schema]/[targetRowID]': 'site-scoped',
  // View refresh
  'refreshviews/[view]/[schema]': 'site-scoped',
  // Row edits
  'edits/apply': 'site-scoped',
  'edits/preview': 'site-scoped',
  'edits/revert': 'site-scoped',
  // Export
  'export/ctfs-sql/[schema]/[plotID]/[censusID]': 'site-scoped',
  'export/ctfs-rebuild-view/[schema]': 'site-scoped',
  // File management
  'files/[operation]': 'site-scoped',
  // Census rollover (currently a no-op stub, but operates on site data)
  'rollover/[primaryKey]/[schema]/[plotIDParam]/[censusIDParam]/[newCensusIDParam]': 'site-scoped',

  // ── Async upload (background-job) routes ─────────────────────────────────
  // Feature-flag probe: requireSession, returns enablement for the schema; no
  // per-site mutation, so 'authed' (mirrors the 'query' posture).
  'features/async-upload': 'authed',
  // Create/list upload jobs: POST gates on assertCanEditMeasurementScope (DB
  // schema/plot/census scope check; 403 via ScopeAccessError) — site-scoped.
  uploadjobs: 'site-scoped',
  // Job status by id (jobId-only URL, no declared schema); requireSession with
  // per-user ownership enforced inside the handler — 'authed' (like 'query').
  'uploadjobs/[jobId]': 'authed'
} satisfies Record<string, RoutePolicy>;

/** Compile-time union of every declared route key. Adoption sites use this so a
 * typo'd or stale routeKey is a build error, not a runtime authz downgrade. */
export type RouteKey = keyof typeof ROUTE_POLICIES;

/**
 * Site-scoped routes that do NOT yet reference a recognised authz signal in
 * their source (validateContextualValues, assertSchemaAccess, validatedSchema,
 * validateSchemaOrThrow with auth, or requireSession with schema ownership
 * check).
 *
 * These are KNOWN REMEDIATION DEBT — explicitly enumerated so the gate stays
 * green while preventing new unprotected routes from being added silently.
 *
 * Remediation: add a proper authz signal to each route below and remove it
 * from this set.
 */
export const UNVERIFIED_SCHEMA_ACCESS: ReadonlySet<string> = new Set([]);
