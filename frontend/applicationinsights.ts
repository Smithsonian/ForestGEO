// applicationinsights.ts
import { ApplicationInsights } from '@microsoft/applicationinsights-web';
import { ReactPlugin } from '@microsoft/applicationinsights-react-js';

let appInsights: ApplicationInsights | null = null;
const reactPlugin = new ReactPlugin();

// The Application Insights connection string is a public browser-telemetry
// identifier (not a secret), so it is exposed via NEXT_PUBLIC_ and inlined at
// build time. Two spellings drifted into the codebase:
//   - NEXT_PUBLIC_APP_INSIGHTS_CONNECTION_STRING  (canonical; the root provider
//     and the .env templates use this one)
//   - NEXT_PUBLIC_APPINSIGHTS_CONNECTION_STRING   (legacy; only the user-sync
//     hook read it, so telemetry user context silently never attached whenever
//     only the canonical var was configured)
// This accessor is the single source of truth: canonical wins, the legacy name
// is a deprecated fallback that logs a one-time warning.
let warnedLegacyAppInsightsVar = false;

export function getAppInsightsConnectionString(): string | undefined {
  const canonical = process.env.NEXT_PUBLIC_APP_INSIGHTS_CONNECTION_STRING;
  if (canonical) return canonical;

  const legacy = process.env.NEXT_PUBLIC_APPINSIGHTS_CONNECTION_STRING;
  if (legacy) {
    if (!warnedLegacyAppInsightsVar) {
      warnedLegacyAppInsightsVar = true;
      console.warn('NEXT_PUBLIC_APPINSIGHTS_CONNECTION_STRING is deprecated; rename it to NEXT_PUBLIC_APP_INSIGHTS_CONNECTION_STRING.');
    }
    return legacy;
  }
  return undefined;
}

export function initializeAppInsights(connectionString: string) {
  if (appInsights) return appInsights;

  const config = {
    connectionString,
    enableAutoRouteTracking: true,
    extensions: [reactPlugin],
    disableFetchTracking: false,
    samplingPercentage: 100,
    enableDebug: process.env.NODE_ENV !== 'production',
    name: 'forestgeo-client',
    // Increase limits for bulk upload operations
    // Large CSV files (10MB+) can generate 2000+ AJAX calls during upload/processing
    maxAjaxCallsPerView: 5000, // Increased from 1000 to handle large bulk uploads (default is 500)
    maxBatchSize: 100,
    maxBatchInterval: 15000
  };

  appInsights = new ApplicationInsights({ config });
  appInsights.loadAppInsights();

  return appInsights;
}

export function getAppInsights(): ApplicationInsights | null {
  return appInsights;
}

export function setUserContext(userId: string, accountId?: string, isAuthenticated = true) {
  if (!appInsights) return;
  // setAuthenticatedUserContext takes (authenticatedUserId, accountId?, storeInCookie?)
  appInsights.setAuthenticatedUserContext(userId, accountId, true);
}

export function clearUserContext() {
  if (!appInsights) return;
  appInsights.clearAuthenticatedUserContext();
}

export { reactPlugin };
