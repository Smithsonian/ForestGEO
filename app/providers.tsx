"use client";
import * as React from "react";
import {SessionProvider} from "next-auth/react";
import Themeregistry from "@/components/themeregistry/themeregistry";

export interface ProvidersProps {
  children: React.ReactNode;
}

export function Providers({children}: ProvidersProps) {
  return (
    <>
      <SessionProvider>
        <Themeregistry>
          <body>
          {children}
          </body>
        </Themeregistry>
      </SessionProvider>
    </>
  );
}
