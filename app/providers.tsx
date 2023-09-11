"use client";
import * as React from "react";
import {NextUIProvider} from "@nextui-org/system";
import {ThemeProvider as NextThemesProvider} from "next-themes";
import {ThemeProviderProps} from "next-themes/dist/types";
import {Navbar} from "@/components/navbar";
import {SessionProvider} from "next-auth/react";
import clsx from "clsx";
import {fontSans} from "@/config/fonts";

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
            <div className="relative flex flex-col h-screen">
              <Navbar/>
              <main className="container mx-auto max-w-7xl pt-16 px-6 flex-grow">
                {children}
                {/*<section className="flex flex-col items-center justify-center gap-4 py-8 md:py-10">*/}
                {/*  <div className="inline-block max-w-lg text-center justify-center">*/}
                {/*  */}
                {/*  </div>*/}
                {/*</section>*/}
              </main>
              <footer className="w-full flex items-center justify-center py-3">
              </footer>
            </div>
          </NextThemesProvider>
        </NextUIProvider>
      </SessionProvider>
      </body>
    </>
  );
}
