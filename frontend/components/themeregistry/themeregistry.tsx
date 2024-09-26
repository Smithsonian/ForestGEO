'use client';
import '@/styles/globals.css';
import * as React from 'react';
import CssBaseline from '@mui/joy/CssBaseline';
import { createTheme, THEME_ID as MATERIAL_THEME_ID, ThemeProvider as MaterialCssVarsProvider } from '@mui/material/styles';
import { CssVarsProvider as JoyCssVarsProvider } from '@mui/joy/styles';
import NextAppDirEmotionCacheProvider from './emotioncache';

// Define the dark mode for the Material theme
const darkTheme = createTheme({
  palette: {
    mode: 'dark'
  }
});

export default function ThemeRegistry({ children }: { children: React.ReactNode }) {
  return (
    <NextAppDirEmotionCacheProvider options={{ key: 'joy' }}>
      <MaterialCssVarsProvider theme={{ [MATERIAL_THEME_ID]: darkTheme }}>
        <JoyCssVarsProvider defaultMode="dark" defaultColorScheme="dark">
          <CssBaseline />
          {children}
        </JoyCssVarsProvider>
      </MaterialCssVarsProvider>
    </NextAppDirEmotionCacheProvider>
  );
}
