'use client';
import '@/styles/globals.css';
import * as React from 'react';
import CssBaseline from '@mui/joy/CssBaseline';
import { createTheme, THEME_ID as MATERIAL_THEME_ID, ThemeProvider as MaterialCssVarsProvider } from '@mui/material/styles';
import { CssVarsProvider as JoyCssVarsProvider } from '@mui/joy/styles';
import type {} from '@mui/x-data-grid/themeAugmentation';
import NextAppDirEmotionCacheProvider from './emotioncache';
import theme from './theme';
import { designTokens } from '@/config/design-tokens';

const joyDarkBackground = theme.colorSchemes.dark.palette.background;

/** DataGrid style-override values, exported so the contrast test reads the same values the runtime paints. */
export const DATAGRID_CONTAINER_BACKGROUND = joyDarkBackground.level1;
export const DATAGRID_HEADER_TEXT_COLOR = designTokens.colors.earthBrown[100];
export const DATAGRID_BODY_TEXT_COLOR = designTokens.colors.earthBrown[100];
export const DATAGRID_FOOTER_TEXT_COLOR = designTokens.colors.earthBrown[200];

/** Material components (Data Grid included) take nothing from the Joy theme; this is their dark palette. */
export const materialDarkTheme = createTheme({
  palette: {
    mode: 'dark',
    background: { default: joyDarkBackground.body, paper: joyDarkBackground.level1 },
    text: {
      primary: designTokens.colors.earthBrown[100],
      secondary: designTokens.colors.earthBrown[200],
      disabled: designTokens.colors.earthBrown[400]
    },
    divider: designTokens.colors.earthBrown[700]
  },
  components: {
    MuiDataGrid: {
      styleOverrides: {
        root: {
          color: DATAGRID_BODY_TEXT_COLOR,
          '--DataGrid-containerBackground': DATAGRID_CONTAINER_BACKGROUND
        },
        columnHeaderTitle: { color: DATAGRID_HEADER_TEXT_COLOR },
        footerContainer: { color: DATAGRID_FOOTER_TEXT_COLOR }
      }
    }
  }
});

export default function ThemeRegistry({ children }: { children: React.ReactNode }) {
  return (
    <NextAppDirEmotionCacheProvider options={{ key: 'joy' }}>
      <MaterialCssVarsProvider theme={{ [MATERIAL_THEME_ID]: materialDarkTheme }}>
        <JoyCssVarsProvider theme={theme} defaultMode="dark" defaultColorScheme="dark">
          <CssBaseline />
          {children}
        </JoyCssVarsProvider>
      </MaterialCssVarsProvider>
    </NextAppDirEmotionCacheProvider>
  );
}
