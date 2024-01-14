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
      <ThemeRegistry>
        <SessionProvider>
          <body>
          {children}
          </body>
        </SessionProvider>
      </ThemeRegistry>
    </>
  );
}
