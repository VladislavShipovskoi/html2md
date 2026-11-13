import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default [
  ...tseslint.configs.recommended,
  { ignores: ['dist/**', 'node_modules/**'] },
  {
    ...js.configs.recommended,
    files: ['**/*.ts'],
    rules: {
      ...js.configs.recommended.rules,
      'no-undef': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      curly: ['error', 'all'],
      'padding-line-between-statements': [
        'error',
        { blankLine: 'always', prev: '*', next: ['if', 'for'] },
        { blankLine: 'always', prev: ['if', 'for'], next: '*' },
      ],
    },
  },
  {
    files: ['extension/**/*.ts'],
    languageOptions: {
      globals: { ...globals.browser, chrome: 'readonly' },
    },
  },
  {
    files: ['core/**/*.ts'],
    languageOptions: {
      globals: { URL: 'readonly', AbortSignal: 'readonly', FormData: 'readonly', Blob: 'readonly' },
    },
    rules: {
      'no-restricted-globals': [
        'error',
        'document',
        'window',
        'chrome',
        'navigator',
        'fetch',
        'setTimeout',
      ],
    },
  },
  {
    files: ['scripts/**/*.ts', 'tests/**/*.ts', 'eslint.config.ts'],
    languageOptions: { globals: globals.node },
  },
];
