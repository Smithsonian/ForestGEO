import "@/styles/globals.css";
import {Providers} from "./providers";
import React from "react";
import {ContextsProvider} from "@/app/plotcontext";
import {Box} from "@mui/joy";

export default function RootLayout({children,}: { children: React.ReactNode; }) {
  return (
    <>
      <html lang="en" suppressContentEditableWarning suppressHydrationWarning className={"dark"}>
      <head>
        <title>ForestGEO Data Entry</title>
      </head>
      <ContextsProvider>
        <Providers>
          {/*<DrawerNav />*/}
          <Box sx={{display: 'flex', minHeight: '100vh', minWidth: '100vh'}}>
            {/*<DrawerNav />*/}
            {children}
          </Box>
        </Providers>
      </ContextsProvider>
      </html>
    </>
  );
}
