"use client";
import * as React from "react";
import {NextUIProvider} from "@nextui-org/react";
import {ThemeProvider as NextThemesProvider} from "next-themes";
import {ThemeProviderProps} from "next-themes/dist/types";
import {SessionProvider} from "next-auth/react";

export interface ProvidersProps {
  children: React.ReactNode;
  themeProps?: ThemeProviderProps;
}

export function Providers({children, themeProps}: ProvidersProps) {
  return (
    <>
      <SessionProvider>
        <NextUIProvider>
          <NextThemesProvider {...themeProps}>
            <body>
            {children}
            </body>
          </NextThemesProvider>
        </NextUIProvider>
      </SessionProvider>
    </>
  );
}
