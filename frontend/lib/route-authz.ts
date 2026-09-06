import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { assertSchemaAccess } from '@/lib/authz';
import { requireAdmin, requireSession } from '@/lib/auth-helpers';
import { isValidSchema } from '@/lib/db/sqlsecurity';
import { ROUTE_POLICIES, type RouteKey } from '@/lib/route-policy';
import { HTTPResponses } from '@/config/macros';
import { findSchemaQuarantine, schemaGateUnavailableResponse, schemaQuarantinedResponse } from '@/lib/schema-quarantine';
import ailogger from '@/ailogger';

export interface RouteContext {
  params: Promise<Record<string, string | string[] | undefined>>;
}

export type SchemaResolver = (request: NextRequest, context: RouteContext) => Promise<string | null> | string | null;

const EMPTY_ROUTE_CONTEXT: RouteContext = { params: Promise.resolve({}) };

export const fromQuery =
  (param = 'schema'): SchemaResolver =>
  request =>
    request.nextUrl.searchParams.get(param);

export const fromPath =
  (param = 'schema'): SchemaResolver =>
  async (_request, context) => {
    const params = await context.params;
    const value = params[param];
    return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
  };

export const fromPathSegment =
  (param: string, index: number): SchemaResolver =>
  async (_request, context) => {
    const params = await context.params;
    const value = params[param];
    if (!Array.isArray(value)) return null;
    return value[index] ?? null;
  };

/**
 * Resolve the schema from the JSON request body. Clones and fully parses the
 * body, so prefer {@link fromPath}/{@link fromQuery} on large-payload routes
 * (e.g. bulk upload) to avoid parsing the whole body twice.
 */
export const fromBody =
  (key = 'schema'): SchemaResolver =>
  async request => {
    try {
      const body = await request.clone().json();
      const value = body?.[key];
      return typeof value === 'string' ? value : null;
    } catch {
      return null;
    }
  };

interface AuthzOptions {
  schema?: SchemaResolver;
}

type Handler = (request: NextRequest, context: RouteContext) => Promise<Response> | Response;

/**
 * Node-runtime authorization wrapper for an app/api route handler.
 *
 * CONTRACT: `routeKey` MUST equal the route's folder path under `app/api`
 * (i.e. the exact key under which the route is registered in ROUTE_POLICIES,
 * without leading slash or trailing `/route.ts`). It is typed as
 * {@link RouteKey}, so a typo or stale key is a compile error rather than a
 * silent runtime authz downgrade.
 *
 * Enforcement by policy:
 *   - `public`      → handler runs; `auth()` is never called.
 *   - `authed`      → requires a valid session (401/503 otherwise).
 *   - `admin`       → requires an admin session (403 otherwise).
 *   - `site-scoped` → resolves a schema via `options.schema` and enforces
 *                     per-site access (400 on missing/invalid schema, 403 on
 *                     out-of-scope, 503 when permissions are unavailable), then
 *                     503 SCHEMA_QUARANTINED when the schema is quarantined by
 *                     the deploy contract gate (see lib/schema-quarantine.ts).
 *
 * The schema is resolved by an EXPLICIT per-route resolver
 * ({@link fromQuery}/{@link fromPath}/{@link fromBody}), never inferred from
 * the pathname.
 */
export function withRouteAuthz(routeKey: RouteKey, handler: Handler, options: AuthzOptions = {}) {
  return async (request: NextRequest, context: RouteContext): Promise<Response> => {
    const routeContext = context ?? EMPTY_ROUTE_CONTEXT;
    const policy = ROUTE_POLICIES[routeKey];
    if (!policy) {
      ailogger.error(`[route-authz] No policy for route key '${routeKey}' — refusing request.`);
      return NextResponse.json({ error: 'route authorization misconfigured', code: 'ROUTE_MISCONFIGURED' }, { status: HTTPResponses.INTERNAL_SERVER_ERROR });
    }

    if (policy === 'public') return handler(request, routeContext);

    const session = await auth();
    const sessionError = requireSession(session);
    // requireSession returns a response for a null/degraded session, so past this
    // point session is non-null; the `!session` guard narrows the type for TS.
    if (sessionError || !session) return sessionError ?? NextResponse.json({ error: 'unauthorized' }, { status: HTTPResponses.UNAUTHORIZED });

    if (policy === 'authed') return handler(request, routeContext);

    if (policy === 'admin') {
      const denied = requireAdmin(session);
      if (denied) return denied;
      return handler(request, routeContext);
    }

    // site-scoped
    if (!options.schema) {
      ailogger.error(`[route-authz] site-scoped route '${routeKey}' has no schema resolver — refusing request.`);
      return NextResponse.json({ error: 'route authorization misconfigured', code: 'ROUTE_MISCONFIGURED' }, { status: HTTPResponses.INTERNAL_SERVER_ERROR });
    }
    const schema = await options.schema(request, routeContext);
    if (!schema || !isValidSchema(schema)) {
      return NextResponse.json({ error: 'missing or invalid schema', code: 'INVALID_SCHEMA' }, { status: HTTPResponses.BAD_REQUEST });
    }
    const denied = assertSchemaAccess(session, schema);
    if (denied) return denied;

    // Quarantine is a schema-integrity state, not a permission: it is checked only
    // after authz so an out-of-scope caller learns nothing, and admins are not exempt.
    let quarantine;
    try {
      quarantine = await findSchemaQuarantine(schema);
    } catch (error) {
      ailogger.error(`[route-authz] schema quarantine lookup failed for '${schema}' on '${routeKey}'`, error instanceof Error ? error : undefined);
      return schemaGateUnavailableResponse(error);
    }
    if (quarantine) return schemaQuarantinedResponse(quarantine);

    return handler(request, routeContext);
  };
}
