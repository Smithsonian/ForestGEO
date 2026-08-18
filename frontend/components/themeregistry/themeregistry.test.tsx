import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

// theme.ts loads next/font/google at module scope; the real loader needs the Next.js
// build pipeline, which vitest doesn't run, so it's stubbed with the shape callers use.
vi.mock('next/font/google', () => ({
  Inter: () => ({ style: { fontFamily: 'Inter' } }),
  Source_Code_Pro: () => ({ style: { fontFamily: 'Source Code Pro' } })
}));

import Typography from '@mui/joy/Typography';
import MaterialTypography from '@mui/material/Typography';
import ThemeRegistry from './themeregistry';
import theme from './theme';
import { designTokens } from '@/config/design-tokens';

function hexToRgb(hex: string): string {
  const normalized = hex.replace('#', '');
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return `rgb(${r}, ${g}, ${b})`;
}

// jsdom has no matchMedia implementation; MUI's color-scheme detection (used by both the
// Joy and Material CssVarsProviders even when defaultMode/defaultColorScheme are pinned)
// calls it during mount. This project's shared test setup (setup.ts) does not stub it, so
// it is stubbed here, local to this file.
// Plain functions (not vi.fn) so this survives the project's global mockReset/restoreMocks
// config, which would otherwise strip the mockImplementation back to a no-op between tests.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false
  })) as unknown as typeof window.matchMedia;
}

/**
 * This suite renders the REAL ThemeRegistry composition and reads the emitted <style>
 * text, so it fails if `theme={theme}` is dropped from JoyCssVarsProvider or if
 * `materialDarkTheme` stops being passed to MaterialCssVarsProvider - failures a
 * token-level theme.ts test cannot see, because the theme objects themselves would
 * still be correct even if the running app never wires them in.
 */
function collectEmittedCss(): string {
  return Array.from(document.querySelectorAll('style'))
    .map(styleTag => styleTag.textContent ?? '')
    .join('\n');
}

describe('ThemeRegistry runtime composition', () => {
  it('emits the custom Joy dark text tokens as CSS variables', () => {
    render(
      <ThemeRegistry>
        <Typography level="body-sm">probe</Typography>
      </ThemeRegistry>
    );
    const css = collectEmittedCss();

    // These declarations only exist when the custom theme (components/themeregistry/theme.ts)
    // actually reaches JoyCssVarsProvider via the `theme={theme}` prop; Joy's built-in dark
    // text.primary default is a different value entirely, so this line is absent unless the
    // custom theme is wired in.
    expect(css, `expected --joy-palette-text-primary to be ${designTokens.colors.earthBrown[100]}; emitted CSS was:\n${css.slice(0, 2000)}`).toContain(
      `--joy-palette-text-primary:${designTokens.colors.earthBrown[100]}`
    );
    expect(css, `expected --joy-palette-text-tertiary to be ${designTokens.colors.earthBrown[300]}; emitted CSS was:\n${css.slice(0, 2000)}`).toContain(
      `--joy-palette-text-tertiary:${designTokens.colors.earthBrown[300]}`
    );
    expect(
      css,
      `expected --joy-palette-background-body to be ${theme.colorSchemes.dark.palette.background.body}; emitted CSS was:\n${css.slice(0, 2000)}`
    ).toContain(`--joy-palette-background-body:${theme.colorSchemes.dark.palette.background.body}`);
  });

  it('emits the extended Material dark text palette', () => {
    // Asserted via getComputedStyle on a real @mui/material component rather than a raw
    // substring scan of every <style> tag in the document: the Joy provider's own CssBaseline
    // also injects `--joy-palette-text-primary:#f5f5f4` on :root (see the test above), and that
    // tag is never removed between tests in this file (testing-library's cleanup() unmounts
    // components but does not strip injected <style> tags). A substring check for the earthBrown
    // hex value would therefore keep "passing" purely off Joy's leftover CSS even if
    // materialDarkTheme were disconnected from MaterialCssVarsProvider entirely - a cheater
    // test. Reading the actually-applied color off a rendered Material component ties the
    // assertion to the Material composition specifically.
    const { getByTestId } = render(
      <ThemeRegistry>
        <MaterialTypography color="textSecondary" data-testid="material-probe">
          material probe
        </MaterialTypography>
      </ThemeRegistry>
    );
    const probe = getByTestId('material-probe');
    const computedColor = getComputedStyle(probe).color;
    const expectedColor = hexToRgb(designTokens.colors.earthBrown[200]);

    // MUI's DEFAULT dark-mode text.secondary is rgba(255, 255, 255, 0.7) - a different value -
    // so this fails both if materialDarkTheme is disconnected and if it reverts to MUI defaults.
    expect(
      computedColor,
      `expected Material text.secondary to render as ${expectedColor} (earthBrown[200]); the rendered probe computed color:"${computedColor}" instead. ` +
        `This is the value materialDarkTheme.palette.text.secondary supplies via MaterialCssVarsProvider in themeregistry.tsx.`
    ).toBe(expectedColor);
  });
});
