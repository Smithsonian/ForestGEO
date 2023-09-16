"use client";
import * as React from "react";
import {NextUIProvider} from "@nextui-org/react";
import {ThemeProvider as NextThemesProvider} from "next-themes";
import {ThemeProviderProps} from "next-themes/dist/types";
import {SessionProvider} from "next-auth/react";
import {PlotsProvider} from "@/app/plotcontext";
import {Navbar} from "@/components/navbar";

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
      <SessionProvider>
        <NextUIProvider>
          <NextThemesProvider {...themeProps}>
            <PlotsProvider>
              <body>
              <div className={`relative flex flex-col h-screen w-screen`}>
                <Navbar>
                  {children}
                </Navbar>
              </div>
              </body>
            </PlotsProvider>
          </NextThemesProvider>
        </NextUIProvider>
      </SessionProvider>
    </>
  );
}
