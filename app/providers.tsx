"use client";
import * as React from "react";
import {SessionProvider} from "next-auth/react";
import {NextUIProvider} from "@nextui-org/react";
import {createTheme, ThemeProvider} from "@mui/material/styles";
import type {} from '@mui/lab/themeAugmentation';

export interface ProvidersProps {
  children: React.ReactNode;
}
const darkTheme = createTheme({
  palette: {
    mode: 'dark',
  },
  components: {
    MuiTimeline: {
      styleOverrides: {
        root: {
          backgroundColor: 'darkgray',
        },
      },
    },
  },
});

export function Providers({children}: ProvidersProps) {
  return (
    <>
      <SessionProvider>
        <NextUIProvider>
          <ThemeProvider theme={darkTheme}>
            <body>
            {children}
            </body>
          </ThemeProvider>
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
