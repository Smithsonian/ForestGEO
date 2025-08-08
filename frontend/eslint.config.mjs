// @ts-check
import prettierPlugin from 'eslint-plugin-prettier';
import typescriptParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import reactPlugin from 'eslint-plugin-react';
import eslintPluginImport from 'eslint-plugin-import';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import jsxA11yPlugin from 'eslint-plugin-jsx-a11y';
import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({
  // import.meta.dirname is available after Node.js v20.11.0
  baseDirectory: import.meta.dirname
});

export default [
  // Ignored directories
  {
    ignores: ['.cache/', '.git/', '.github/', 'node_modules/']
  },

  // TypeScript and Prettier configurations
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        project: ['./tsconfig.json', './tsconfig.app.json', './tsconfig.spec.json']
      }
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      prettier: prettierPlugin,
      react: reactPlugin,
      import: eslintPluginImport,
      'jsx-a11y': jsxA11yPlugin
    },
    settings: {
      react: { version: 'detect' },
      'jsx-a11y': {
        // map JoyUI & MUI wrappers to their underlying HTML elements
        components: {
          // layout
          Box: 'div',
          Stack: 'div',
          Grid: 'div',
          Container: 'div',
          // card
          Card: 'section',
          CardContent: 'div',
          CardActions: 'div',
          CardOverflow: 'div',
          // surfaces
          Paper: 'section',
          Accordion: 'section',
          AccordionGroup: 'div',
          AccordionSummary: 'button',
          AccordionDetails: 'div',
          // data display
          List: 'ul',
          ListItem: 'li',
          ListItemButton: 'button',
          ListItemContent: 'div',
          ListItemDecorator: 'span',
          Table: 'table',
          TableHead: 'thead',
          TableBody: 'tbody',
          TableRow: 'tr',
          TableCell: 'td',
          Chip: 'span',
          Avatar: 'img',
          Badge: 'span',
          Tooltip: 'div',
          Divider: 'hr',
          Alert: 'section',
          AlertTitle: 'h2',
          // form controls
          Button: 'button',
          IconButton: 'button',
          Link: 'a',
          TextField: 'input',
          Input: 'input',
          FilledInput: 'input',
          OutlinedInput: 'input',
          Textarea: 'textarea',
          Select: 'select',
          Option: 'option',
          Checkbox: 'input',
          Radio: 'input',
          Switch: 'input',
          Slider: 'input',
          FormControl: 'fieldset',
          FormLabel: 'label',
          FormHelperText: 'p',
          InputLabel: 'label',
          FormGroup: 'div',
          FormControlLabel: 'label',
          // dialog / modal
          Dialog: 'div',
          DialogTitle: 'h2',
          DialogContent: 'div',
          DialogActions: 'div',
          // navigation
          AppBar: 'nav',
          Toolbar: 'div',
          Menu: 'ul',
          MenuItem: 'button'
          // any others you use…
        },
        linkComponents: [
          { name: 'NextLink', linkAttribute: 'href' }
          // e.g. if you alias `<Link as={...}>`
        ]
      }
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      ...prettierPlugin.configs?.rules,
      'import/order': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/member-ordering': 'off',
      '@typescript-eslint/naming-convention': 'off',
      '@typescript-eslint/ban-types': 'off',
      '@typescript-eslint/no-inferrable-types': 'off',
      '@typescript-eslint/no-unused-vars': [
        'off',
        {
          vars: 'all',
          args: 'after-used',
          ignoreRestSiblings: true
        }
      ],
      '@typescript-eslint/no-unused-expressions': 'off'
    }
  },

  // Prettier recommended settings
  eslintPluginPrettierRecommended,

  // Next.js ESLint configurations, integrating Next.js rules while retaining custom ones
  ...compat.config({
    extends: ['next/core-web-vitals', 'next/typescript', 'plugin:jsx-a11y/strict'],
    rules: {
      'react/no-unescaped-entities': 'off',
      '@next/next/no-page-custom-font': 'off',
      // Retaining custom rules that are relevant to Next.js projects
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/member-ordering': 'off',
      '@typescript-eslint/naming-convention': 'off',
      '@typescript-eslint/ban-types': 'off',
      '@typescript-eslint/no-inferrable-types': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      'react-hooks/exhaustive-deps': 'off',
      'react-hooks/rules-of-hooks': 'off',
      'import/no-anonymous-default-export': 'off',
      'jsx-a11y/control-has-associated-label': [
        'error',
        {
          ignoreElements: [],
          ignoreRoles: [],
          includeRoles: ['button', 'link', 'checkbox', 'switch'],
          labelAttributes: ['aria-label', 'aria-labelledby', 'alt']
        }
      ]
    }
  }),
  {
    files: ['cypress/**/*.js', 'cypress.config.cjs', 'webpack.config.js', '*.cjs'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-var-requires': 'off'
    }
  }
];
