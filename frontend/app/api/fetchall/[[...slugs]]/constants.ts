// Shared constants for the fetchall route. These live in a sibling module rather
// than route.ts because Next.js route modules may only export recognized fields
// (GET, runtime, ...); a bare `export const` in route.ts fails the production
// route type-check. Keeping them here lets the route and its tests share one
// source of truth.

// Error code returned when a requested dataType is not servable by this endpoint.
export const INVALID_DATATYPE_CODE = 'INVALID_DATATYPE';

// Per-site schema tables/views fetchall may serve via the generic branch. Derived
// from the MapperFactory registry (config/datamapper.ts); excludes the cross-site
// catalog tables (sites/users/usersiterelations) and the types already
// special-cased in the handler (stems/trees/plots/personnel/census/species).
// `roles` is a per-site table (FK'd by personnel) served via the generic branch.
export const FETCHALL_ALLOWED_TABLES: ReadonlySet<string> = new Set([
  'alltaxonomiesview',
  'attributes',
  'coremeasurements',
  'coremeasurements_staging',
  'cmattributes',
  'failedmeasurements',
  'measurementssummary',
  'measurementssummaryview',
  'postvalidationqueries',
  'quadratpersonnel',
  'quadrats',
  'roles',
  'family',
  'genus',
  'reference',
  'speciesinventory',
  'specieslimits',
  'specimens',
  'unifiedchangelog',
  'validationchangelog',
  'sitespecificvalidations',
  'viewfulltable',
  'viewfulltableview'
]);
