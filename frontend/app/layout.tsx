import "@/styles/globals.css";
import { Providers } from "./providers";
import React from "react";
import { ListSelectionProvider } from "@/app/contexts/listselectionprovider";
import { Box } from "@mui/joy";
import UserSelectionProvider from "@/app/contexts/userselectionprovider";
import { LoadingProvider } from "@/app/contexts/loadingprovider";
import { GlobalLoadingIndicator } from "@/styles/globalloadingindicator";
import { DataValidityProvider } from "@/app/contexts/datavalidityprovider";
import { LockAnimationProvider } from "./contexts/lockanimationcontext";
import Head from "next/head";

export default function RootLayout({ children, }: Readonly<{ children: React.ReactNode; }>) {
  return (
    <html lang="en" suppressContentEditableWarning suppressHydrationWarning className={"dark"}>
      <Head>
        <title>ForestGEO Census</title>
        <link rel="icon" href="/favicon.ico"/>
      </Head>
      <body>
        <Providers>
          <LoadingProvider>
            <GlobalLoadingIndicator />
            <ListSelectionProvider>
              <UserSelectionProvider>
                <DataValidityProvider>
                  <LockAnimationProvider>
                    <Box sx={{ display: 'flex', width: '100%', height: '100%' }}>
                      {children}
                    </Box>
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
