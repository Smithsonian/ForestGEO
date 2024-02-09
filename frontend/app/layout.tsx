import "@/styles/globals.css";
import {Providers} from "./providers";
import React from "react";
import {ListSelectionProvider} from "@/app/contexts/listselectionprovider";
import {Box} from "@mui/joy";
import {CoreDataProvider} from "./contexts/coredataprovider";
import UserSelectionProvider from "@/app/contexts/userselectionprovider";

export default function RootLayout({children,}: Readonly<{ children: React.ReactNode; }>) {
  return (
    <html lang="en" suppressContentEditableWarning suppressHydrationWarning className={"dark"}>
    <head>
      <title>ForestGEO Data Entry</title>
    </head>
    <body>
    <Providers>
      <CoreDataProvider>
        <ListSelectionProvider>
          <UserSelectionProvider>
            <Box sx={{display: 'flex', width: '100%', height: '100%'}}>
              {children}
            </Box>
          </UserSelectionProvider>
        </ListSelectionProvider>
      </CoreDataProvider>
    </Providers>
    </body>
    </html>
  );
}
