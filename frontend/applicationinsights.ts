// applicationinsights.ts
import { ApplicationInsights } from '@microsoft/applicationinsights-web';
import { ReactPlugin } from '@microsoft/applicationinsights-react-js';

let appInsights: ApplicationInsights | null = null;
const reactPlugin = new ReactPlugin();

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
    maxAjaxCallsPerView: 1000, // Default is 500
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
