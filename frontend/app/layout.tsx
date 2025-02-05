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

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  console.log('root layout encountered. loading...');
  return (
    <html lang="en" suppressContentEditableWarning suppressHydrationWarning className={'dark'}>
      <head>
        <title>ForestGEO Census</title>
        <link rel="icon" href="icon.jpg" />
      </head>
      <body>
        <Providers>
          <LoadingProvider>
            <GlobalLoadingIndicator />
            <ListSelectionProvider>
              <UserSelectionProvider>
                <DataValidityProvider>
                  <LockAnimationProvider>
                    <Box sx={{ display: 'flex', width: '100%', height: '100%' }}>{children}</Box>
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
