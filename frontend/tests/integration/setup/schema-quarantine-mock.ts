/**
 * Default `@/lib/schema-quarantine` mock for the integration run.
 *
 * Every site-scoped route passes through `withRouteAuthz` or
 * `validateContextualValues`, both of which now consult
 * `catalog.schema_contract_gate` on each request (see #429). The route
 * integration suites stub ConnectionManager with a QUEUE of `executeQuery`
 * responses, so a real lookup would consume the first queued row and shift
 * every later assertion — a test failure that says nothing about the route.
 *
 * Default here is "no schema is quarantined". A suite that needs the
 * enforcement path overrides `findSchemaQuarantine` itself; the CLI side is
 * proven against real MySQL in schema-gate-quarantine.integration.test.ts, and
 * the chokepoint behavior in lib/route-authz.test.ts and
 * lib/contextvalidation.test.ts.
 *
 * Mirrors the unit-side default in tests/mocks/db-mocks.ts.
 */

import { vi } from 'vitest';

vi.mock('@/lib/schema-quarantine', async origImport => {
  const actual = await origImport<typeof import('@/lib/schema-quarantine')>();
  return {
    ...actual,
    findSchemaQuarantine: vi.fn(async () => null)
  };
});
