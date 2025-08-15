'use client';
import * as React from 'react';
import { useEffect } from 'react';
import { SessionProvider } from 'next-auth/react';
import ThemeRegistry from '@/components/themeregistry/themeregistry';
import { LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterMoment } from '@mui/x-date-pickers/AdapterMoment';
import { initializeAppInsights } from '@/applicationinsights';

export interface ProvidersProps {
  children: React.ReactNode;
}

export function Providers({ children }: Readonly<ProvidersProps>) {
  useEffect(() => {
    const connectionString = process.env.APP_INSIGHTS_CONNECTION_STRING;
    if (!connectionString) {
      console.warn('Application Insights connection string not set.');
      return;
    }
    const appInsights = initializeAppInsights(connectionString);

    // Optional: track route changes manually if needed (Next.js App Router does not expose history)
    // For simplicity, you can call trackPageView on navigation events you control.
    appInsights?.trackPageView();

    // Example: attach user context if you have session info
    // appInsights?.setAuthenticatedUserContext('user-id', undefined, true);
  }, []);

  return (
    <ThemeRegistry>
      <SessionProvider>
        <LocalizationProvider dateAdapter={AdapterMoment}>{children}</LocalizationProvider>
      </SessionProvider>
    </ThemeRegistry>
  );
}
