import React from 'react';
import theme from '../src/theme';
import { ThemeProvider, StylesProvider } from '@mui/material/styles';

const withThemeProvider = (Story, context) => {
  const ourThemeProvider = (
    <ThemeProvider theme={theme}>
      <Story {...context} />
    </ThemeProvider>
  );
  if (process.env.NODE_ENV !== 'test') {
    return ourThemeProvider;
  } else {
    const generateClassName = (rule, styleSheet) =>
      `${styleSheet?.options.classNamePrefix}-${rule.key}`;

    return (
      <StylesProvider generateClassName={generateClassName}>
        {ourThemeProvider}
      </StylesProvider>
    );
  }
};

export const decorators = [withThemeProvider];

export const parameters = {
  actions: { argTypesRegex: '^on[A-Z].*' },
  controls: {
    matchers: {
      color: /(background|color)$/i,
      date: /Date$/,
    },
  },
};
