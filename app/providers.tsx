"use client";
import * as React from "react";
import {ThemeProvider as NextThemesProvider} from "next-themes";
import {ThemeProviderProps} from "next-themes/dist/types";
import {SessionProvider} from "next-auth/react";
import {
  experimental_extendTheme as materialExtendTheme,
  Experimental_CssVarsProvider as MaterialCssVarsProvider,
  THEME_ID as MATERIAL_THEME_ID,
} from '@mui/material/styles';
import { CssVarsProvider as JoyCssVarsProvider } from '@mui/joy/styles';
import {CssBaseline} from "@mui/joy";

const materialTheme = materialExtendTheme();
export interface ProvidersProps {
  children: React.ReactNode;
  themeProps?: ThemeProviderProps;
}

export function Providers({children, themeProps}: ProvidersProps) {
  return (
    <>
      <CssBaseline />
      <SessionProvider>
        <NextThemesProvider {...themeProps}>
          <MaterialCssVarsProvider defaultColorScheme={"dark"} defaultMode={"dark"} theme={{ [MATERIAL_THEME_ID]: materialTheme }}>
            <JoyCssVarsProvider defaultColorScheme={"dark"} defaultMode={"dark"}>
              <body>
              {children}
              </body>
            </JoyCssVarsProvider>
          </MaterialCssVarsProvider>
        </NextThemesProvider>
      </SessionProvider>
    </>
  );
}
