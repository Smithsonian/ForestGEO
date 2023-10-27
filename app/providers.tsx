"use client";
import * as React from "react";
import {SessionProvider} from "next-auth/react";
import ThemeRegistry from "@/components/themeregistry/themeregistry";

export interface ProvidersProps {
  children: React.ReactNode;
}

export function Providers({children}: ProvidersProps) {
  return (
    <>
      <SessionProvider>
        <ThemeRegistry>
          <body>
          {children}
          </body>
        </ThemeRegistry>
      </SessionProvider>
    </>
  );
}
