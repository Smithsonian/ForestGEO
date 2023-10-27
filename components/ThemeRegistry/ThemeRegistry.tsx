'use client';
import * as React from 'react';
import CssBaseline from '@mui/joy/CssBaseline';
import NextAppDirEmotionCacheProvider from './EmotionCache';
import theme from './theme';
import {
  Experimental_CssVarsProvider as MaterialCssVarsProvider,
  THEME_ID as MATERIAL_THEME_ID,
} from '@mui/material/styles';
import { CssVarsProvider as JoyCssVarsProvider } from '@mui/joy/styles';
export default function ThemeRegistry({ children }: { children: React.ReactNode }) {
  return (
    <NextAppDirEmotionCacheProvider options={{ key: 'joy' }}>
      <MaterialCssVarsProvider theme={{ [MATERIAL_THEME_ID]: theme }} defaultMode={"dark"} defaultColorScheme={"dark"}>
        <JoyCssVarsProvider theme={theme} defaultMode={"dark"} defaultColorScheme={"dark"}>
          <CssBaseline />
          {children}
        </JoyCssVarsProvider>
      </MaterialCssVarsProvider>
    </NextAppDirEmotionCacheProvider>
  );
}
