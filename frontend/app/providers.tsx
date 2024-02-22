"use client";
import * as React from "react";
import {SessionProvider} from "next-auth/react";
import ThemeRegistry from "@/components/themeregistry/themeregistry";

export interface ProvidersProps {
  children: React.ReactNode;
}

export function Providers({children}: Readonly<ProvidersProps>) {
  return (
    <ThemeRegistry>
      <SessionProvider>
        {children}
      </SessionProvider>
    </ThemeRegistry>
  );
}
