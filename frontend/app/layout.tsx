import '@/styles/globals.css';
import React from 'react';
import { ListSelectionProvider } from '@/app/contexts/listselectionprovider';
import { Box } from '@mui/joy';
import UserSelectionProvider from '@/app/contexts/userselectionprovider';
import { LoadingProvider } from '@/app/contexts/loadingprovider';
import { GlobalLoadingIndicator } from '@/styles/globalloadingindicator';
import { DataValidityProvider } from '@/app/contexts/datavalidityprovider';

import { Providers } from './providers';
import { LockAnimationProvider } from './contexts/lockanimationcontext';
import ClearCookiesOnUnload from '@/components/client/clearcookiesonunload';

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressContentEditableWarning suppressHydrationWarning className={'dark'}>
      <head>
        <title>ForestGEO Census</title>
        <link rel="icon" href="icon.jpg" />
      </head>
      <body>
        <a href="#main-content" className="skip-to-main">
          Skip to main content
        </a>
        <ClearCookiesOnUnload />
        <Providers>
          <LoadingProvider>
            <GlobalLoadingIndicator />
            <ListSelectionProvider>
              <UserSelectionProvider>
                <DataValidityProvider>
                  <LockAnimationProvider>
                    <div id="app-root" role="application" aria-label="ForestGEO Census Application">
                      <Box sx={{ display: 'flex', width: '100%', height: '100%' }}>{children}</Box>
                    </div>
                  </LockAnimationProvider>
                </DataValidityProvider>
              </UserSelectionProvider>
            </ListSelectionProvider>
          </LoadingProvider>
        </Providers>
      </body>
    </html>
  );
}
