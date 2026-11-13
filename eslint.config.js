import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['dist/**', 'node_modules/**'] },
  {
    ...js.configs.recommended,
    files: ['**/*.js'],
    rules: {
      ...js.configs.recommended.rules,
      curly: ['error', 'all'],
      'padding-line-between-statements': [
        'error',
        { blankLine: 'always', prev: '*', next: ['if', 'for'] },
        { blankLine: 'always', prev: ['if', 'for'], next: '*' },
      ],
    },
  },
  {
    files: ['extension/**/*.js'],
    languageOptions: {
      globals: { ...globals.browser, chrome: 'readonly' },
    },
  },
  {
    files: ['core/**/*.js'],
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
    files: ['scripts/**/*.js', 'tests/**/*.js', 'eslint.config.js'],
    languageOptions: { globals: globals.node },
  },
];
