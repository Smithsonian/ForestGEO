import React from 'react';
import CssBaseline from '@mui/joy/CssBaseline';
import { CssVarsProvider as JoyCssVarsProvider } from '@mui/joy/styles';
import { THEME_ID as MATERIAL_THEME_ID, ThemeProvider as MaterialCssVarsProvider } from '@mui/material/styles';
import { materialDarkTheme } from '@/components/themeregistry/themeregistry';
import appTheme from '@/components/themeregistry/theme';

export function mountInAppTheme(node: React.ReactNode) {
  cy.mount(
    <MaterialCssVarsProvider theme={{ [MATERIAL_THEME_ID]: materialDarkTheme }}>
      <JoyCssVarsProvider theme={appTheme} defaultMode="dark" defaultColorScheme="dark">
        <CssBaseline />
        {node}
      </JoyCssVarsProvider>
    </MaterialCssVarsProvider>
  );
}
