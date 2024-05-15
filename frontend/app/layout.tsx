import "@/styles/globals.css";
import { Providers } from "./providers";
import React from "react";
import { ListSelectionProvider } from "@/app/contexts/listselectionprovider";
import { Box } from "@mui/joy";
import { CoreDataProvider } from "./contexts/coredataprovider";
import UserSelectionProvider from "@/app/contexts/userselectionprovider";
import { LoadingProvider } from "@/app/contexts/loadingprovider";
import { GlobalLoadingIndicator } from "@/styles/globalloadingindicator";
import { DataValidityProvider } from "@/app/contexts/datavalidityprovider";
import { RefreshFixedDataProvider } from "./contexts/refreshfixeddataprovider";

export default function RootLayout({ children, }: Readonly<{ children: React.ReactNode; }>) {
  return (
    <html lang="en" suppressContentEditableWarning suppressHydrationWarning className={"dark"}>
      <head>
        <title>ForestGEO Data Entry</title>
      </head>
      <body>
        <Providers>
          <LoadingProvider>
            <GlobalLoadingIndicator />
            <CoreDataProvider>
              <ListSelectionProvider>
                <UserSelectionProvider>
                  <RefreshFixedDataProvider>
                    <DataValidityProvider>
                      <Box sx={{ display: 'flex', width: '100%', height: '100%' }}>
                        {children}
                      </Box>
                    </DataValidityProvider>
                  </RefreshFixedDataProvider>
                </UserSelectionProvider>
              </ListSelectionProvider>
            </CoreDataProvider>
          </LoadingProvider>
        </Providers>
      </body>
    </html>
  );
}
