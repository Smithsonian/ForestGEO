"use client";
import * as React from "react";
import {SessionProvider} from "next-auth/react";
import {NextUIProvider} from "@nextui-org/react";

export interface ProvidersProps {
  children: React.ReactNode;
}

export function Providers({children}: ProvidersProps) {
  return (
    <>
      <SessionProvider>
        <NextUIProvider>
          <body>
          {children}
          </body>
        </NextUIProvider>
        {/*<NextThemesProvider>*/}
        {/*  <MaterialCssVarsProvider defaultColorScheme={"dark"} defaultMode={"dark"} theme={{ [MATERIAL_THEME_ID]: materialTheme }}>*/}
        {/*    <JoyCssVarsProvider defaultColorScheme={"dark"} defaultMode={"dark"}>*/}
        {/*    */}
        {/*    </JoyCssVarsProvider>*/}
        {/*  </MaterialCssVarsProvider>*/}
        {/*</NextThemesProvider>*/}
      </SessionProvider>
    </>
  );
}
