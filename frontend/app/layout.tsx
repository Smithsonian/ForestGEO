import "@/styles/globals.css";
import {Providers} from "./providers";
import React from "react";
import {ContextsProvider} from "@/app/contexts/generalcontext";
import {Box} from "@mui/joy";
import {FixedDataProvider} from "./contexts/fixeddatacontext";

export default function RootLayout({children,}: { children: React.ReactNode; }) {
  return (
    <>
      <html lang="en" suppressContentEditableWarning suppressHydrationWarning className={"dark"}>
      <head>
        <title>ForestGEO Data Entry</title>
      </head>
      <body>
      <ContextsProvider>
        <FixedDataProvider>
          <Providers>
            <Box sx={{display: 'flex', width: '100%', height: '100%'}}>
              {children}
            </Box>
          </Providers>
        </FixedDataProvider>
      </ContextsProvider>
      </body>
      </html>
    </>
  );
}
