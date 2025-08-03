// hooks/useAppInsightsUserSync.ts
'use client';

import { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { clearUserContext, getAppInsights, initializeAppInsights, setUserContext } from '@/applicationinsights';

export function useAppInsightsUserSync() {
  const { data: session, status } = useSession();

  useEffect(() => {
    const connectionString = process.env.NEXT_PUBLIC_APPINSIGHTS_CONNECTION_STRING;
    if (!connectionString) return;

    // ensure initialized
    initializeAppInsights(connectionString);

    if (status === 'authenticated' && session?.user) {
      // Choose a stable user identifier. Avoid raw email if you consider it PII; you can hash it.
      const userEmail = session.user.email ?? 'unknown';
      // Optionally hash it if you want to avoid storing raw email:
      // e.g., import sha256 from 'crypto-js/sha256'; const hashed = sha256(userEmail).toString();

      setUserContext(userEmail);

      // Enrich every telemetry item with custom properties (e.g., sites, userStatus)
      const ai = getAppInsights();
      ai?.addTelemetryInitializer(item => {
        item.ext = item.ext || {};
        // Attach custom properties under customDimensions if desired:
        const custom: Record<string, any> = {};
        if (session.user.userStatus) custom.userStatus = session.user.userStatus;
        if (session.user.sites) custom.allowedSites = session.user.sites.map((s: any) => s.schemaName).join(',');
        if (session.user.allsites) custom.allSites = session.user.allsites.map((s: any) => s.schemaName).join(',');
        // Avoid too large payloads; prune as needed.
        if ((item as any).data) {
          (item as any).data = {
            ...(item as any).data,
            customDimensions: {
              ...((item as any).data.customDimensions || {}),
              ...custom
            }
          };
        }
      });
    } else if (status === 'unauthenticated') {
      clearUserContext();
    }
  }, [status, session]);
}
