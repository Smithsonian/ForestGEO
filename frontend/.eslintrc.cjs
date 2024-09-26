module.exports = {
  parser: '@typescript-eslint/parser',
  extends: ['next', 'plugin:@typescript-eslint/recommended', 'plugin:prettier/recommended'],
  settings: {
    next: {
      rootDir: '.'
    }
  },
  plugins: ['@typescript-eslint', 'unused-imports', 'prettier', 'import'],
  rules: {
    'react-hooks/exhaustive-deps': 'off',
    semi: ['error', 'always'],
    'unused-imports/no-unused-imports': 'error',
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-unused-vars': 'off',
    '@typescript-eslint/no-var-requires': 'off',
    'unused-imports/no-unused-vars': 'off',
    'react-hooks/rules-of-hooks': 'off',
    'no-case-declarations': 'off',
    'prettier/prettier': 'error'
  }
};
