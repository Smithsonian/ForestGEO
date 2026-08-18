import { describe, expect, it, vi } from 'vitest';

// theme.ts loads next/font/google at module scope; the real loader needs the Next.js
// build pipeline, which vitest doesn't run, so it's stubbed with the shape callers use.
vi.mock('next/font/google', () => ({
  Inter: () => ({ style: { fontFamily: 'Inter' } }),
  Source_Code_Pro: () => ({ style: { fontFamily: 'Source Code Pro' } })
}));

import theme from './theme';
import {
  DATAGRID_BODY_TEXT_COLOR,
  DATAGRID_CONTAINER_BACKGROUND,
  DATAGRID_FOOTER_TEXT_COLOR,
  DATAGRID_HEADER_TEXT_COLOR,
  materialDarkTheme
} from './themeregistry';
import { contrastRatio, ContrastPair, PROJECT_DISABLED_FLOOR, WCAG_AA_NORMAL_TEXT } from './contrast';

const dark = theme.colorSchemes.dark.palette;
const backgrounds: Array<[string, string]> = [
  ['body', dark.background.body],
  ['surface', dark.background.surface],
  ['level1', dark.background.level1],
  ['level2', dark.background.level2],
  ['level3', dark.background.level3]
];

function textPairs(): ContrastPair[] {
  const pairs: ContrastPair[] = [];
  for (const [bgName, bg] of backgrounds) {
    for (const token of ['primary', 'secondary', 'tertiary', 'icon'] as const) {
      pairs.push({ label: `joy text.${token} on ${bgName}`, foreground: dark.text[token], background: bg, minimum: WCAG_AA_NORMAL_TEXT });
    }
  }
  pairs.push(
    { label: 'joy neutral.plainColor on body', foreground: dark.neutral.plainColor, background: dark.background.body, minimum: WCAG_AA_NORMAL_TEXT },
    {
      label: 'joy neutral.plainDisabledColor on body (project floor)',
      foreground: dark.neutral.plainDisabledColor,
      background: dark.background.body,
      minimum: PROJECT_DISABLED_FLOOR
    },
    {
      label: 'material text.primary on body',
      foreground: materialDarkTheme.palette.text.primary,
      background: dark.background.body,
      minimum: WCAG_AA_NORMAL_TEXT
    },
    {
      label: 'material text.secondary on body',
      foreground: materialDarkTheme.palette.text.secondary,
      background: dark.background.body,
      minimum: WCAG_AA_NORMAL_TEXT
    },
    {
      label: 'material text.disabled on body (project floor)',
      foreground: materialDarkTheme.palette.text.disabled,
      background: dark.background.body,
      minimum: PROJECT_DISABLED_FLOOR
    },
    {
      label: 'datagrid header text (columnHeaderTitle) on container background',
      foreground: DATAGRID_HEADER_TEXT_COLOR,
      background: DATAGRID_CONTAINER_BACKGROUND,
      minimum: WCAG_AA_NORMAL_TEXT
    },
    {
      label: 'datagrid body text (root) on container background',
      foreground: DATAGRID_BODY_TEXT_COLOR,
      background: DATAGRID_CONTAINER_BACKGROUND,
      minimum: WCAG_AA_NORMAL_TEXT
    },
    {
      label: 'datagrid footer text (footerContainer) on container background',
      foreground: DATAGRID_FOOTER_TEXT_COLOR,
      background: DATAGRID_CONTAINER_BACKGROUND,
      minimum: WCAG_AA_NORMAL_TEXT
    }
  );
  return pairs;
}

describe('dark theme contrast pairs', () => {
  it.each(textPairs())('$label meets its minimum', pair => {
    const ratio = contrastRatio(pair.foreground, pair.background);
    expect(ratio, `${pair.foreground} on ${pair.background} = ${ratio.toFixed(2)}:1, needs ${pair.minimum}:1`).toBeGreaterThanOrEqual(pair.minimum);
  });
});
