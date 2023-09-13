"use client";
import * as React from "react";
import {NextUIProvider} from "@nextui-org/react";
import {ThemeProvider as NextThemesProvider} from "next-themes";
import {ThemeProviderProps} from "next-themes/dist/types";
import {Navbar} from "@/components/navbar";
import {SessionProvider} from "next-auth/react";
import clsx from "clsx";
import {fontSans} from "@/config/fonts";
import {PlotsProvider} from "@/app/plotcontext";

export interface ProvidersProps {
  children: React.ReactNode;
  themeProps?: ThemeProviderProps;
}

export function Providers({children, themeProps}: ProvidersProps) {
  return (
    <>
      <head>
        <title>ForestGEO Data Entry</title>
      </head>
      <body
        className={clsx(
          "min-h-screen bg-background font-sans antialiased",
          fontSans.variable
        )}
      >
      <SessionProvider>
        <NextUIProvider>
          <NextThemesProvider {...themeProps}>
            <PlotsProvider>
              <Navbar>
                {children}
              </Navbar>
            </PlotsProvider>
          </NextThemesProvider>
        </NextUIProvider>
      </SessionProvider>
      </body>
    </>
  );
}
