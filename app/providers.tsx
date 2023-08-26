"use client";

import * as React from "react";
import {NextUIProvider} from "@nextui-org/system";
import {ThemeProvider as NextThemesProvider} from "next-themes";
import {ThemeProviderProps} from "next-themes/dist/types";
import {Navbar, Plot} from "@/components/navbar";
import {useState} from "react";
import {subtitle, title} from "@/components/primitives";
import {Snippet} from "@nextui-org/snippet";

export interface ProvidersProps {
  children: React.ReactNode;
  themeProps?: ThemeProviderProps;
}

export function Providers({children, themeProps}: ProvidersProps) {
  const initialState: Plot = {key: '', num: 0};
  const [localPlot, setLocalPlot] = useState(initialState);
  return (
    <NextUIProvider>
      <NextThemesProvider {...themeProps}>
        <div className="relative flex flex-col h-screen">
          <Navbar plot={localPlot} setPlot={setLocalPlot}/>
          <main className="container mx-auto max-w-7xl pt-16 px-6 flex-grow">
            <section className="flex flex-col items-center justify-center gap-4 py-8 md:py-10">
              <div className="inline-block max-w-lg text-center justify-center">
                <h1 className={title()}>Welcome to &nbsp;</h1>
								<br />
                <h1 className={title({color: "violet"})}>ForestGEO&nbsp;</h1>
                <br/>
                <h2 className={subtitle({class: "mt-4"})}>
                  A data entry and validation system for your convenience.
                </h2>
              </div>
              
              <div className="mt-8">
                {children}
              </div>
            </section>
          </main>
          <footer className="w-full flex items-center justify-center py-3">
          </footer>
        </div>
      </NextThemesProvider>
    </NextUIProvider>
  );
}
