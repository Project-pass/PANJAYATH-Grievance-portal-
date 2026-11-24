import js from '@eslint/js';
import globals from 'globals';
import firebaseRulesPlugin from '@firebase/eslint-plugin-security-rules';

export default [
  {
    ignores: [
      'dist/**/*',
      'node_modules/**/*',
      'backend/**/*',
      'playwright-report/**/*',
      'test-results/**/*',
    ],
  },
  {
    files: ['src/**/*.js', 'src/**/*.mjs'],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-script-url': 'error',
      'no-alert': 'error',
      'no-var': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-restricted-globals': [
        'error',
        { name: 'localStorage', message: 'Browser storage is forbidden for session/sensitive state.' },
        { name: 'sessionStorage', message: 'Browser storage is forbidden for session/sensitive state.' },
        { name: 'alert', message: 'Use accessible inline status messages instead of window.alert.' },
        { name: 'confirm', message: 'Use in-app confirmation UI instead of window.confirm.' },
        { name: 'prompt', message: 'Use in-app form UI instead of window.prompt.' },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'window', property: 'localStorage', message: 'Do not use window.localStorage.' },
        { object: 'window', property: 'sessionStorage', message: 'Do not use window.sessionStorage.' },
        { object: 'globalThis', property: 'localStorage', message: 'Do not use localStorage.' },
        { object: 'globalThis', property: 'sessionStorage', message: 'Do not use sessionStorage.' },
      ],
    },
  },
  {
    files: [
      'eslint.config.js',
      'vite.config.js',
      'playwright.config.js',
      'firestore.rules.test.mjs',
      'tests/**/*.js',
      'tests/**/*.mjs',
    ],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  firebaseRulesPlugin.configs['flat/recommended'],
];
