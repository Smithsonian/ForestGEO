import type { SitesResult } from '@/lib/db/definitions/zones';

// The one identity the e2e credentials provider seeds in real-DB runs —
// mirrors cypress/support/commands.ts loginViaCredentials defaults.
export const E2E_AUTH_POLL_EMAIL = 'e2e-admin@forestgeo.si.edu';
export const E2E_AUTH_POLL_USER_STATUS = 'global';

// The harness site advertised by app/e2e-upload-harness / app/e2e-errors-harness,
// in the SitesResult wire shape the sites mapper consumes.
export const E2E_AUTH_POLL_ALLOWED_SITES: SitesResult[] = [
  {
    SiteID: '1',
    SiteName: 'E2E Harness Site',
    SchemaName: 'forestgeo_testing',
    SQDimX: null,
    SQDimY: null,
    DoubleDataEntry: null
  }
];
