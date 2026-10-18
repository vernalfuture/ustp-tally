import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// The library must be a pure function of its inputs: no I/O, no clock, no randomness.
// Only src/cli (the verifier) and tests may touch Node built-ins.
const nodeBuiltins = {
  group: ['node:*', 'fs', 'fs/*', 'path', 'crypto', 'os', 'child_process', 'http', 'https', 'net'],
  message: 'The tally library does no I/O. Node built-ins belong in src/cli or tests.',
};
const impureGlobals = [
  'Date',
  'fetch',
  'process',
  'performance',
  'crypto',
  'setTimeout',
  'setInterval',
  'setImmediate',
  'queueMicrotask',
  'globalThis',
  'Intl',
  'eval',
  'WebAssembly',
].map((name) => ({ name, message: 'The tally library must be deterministic and do no I/O.' }));
// Locale-dependent methods give different answers in the worker, the CLI, and each browser.
const localeMethods = [
  'localeCompare',
  'toLocaleString',
  'toLocaleLowerCase',
  'toLocaleUpperCase',
  'toLocaleDateString',
  'toLocaleTimeString',
].map((property) => ({ property, message: 'Compare by UTF-16 code units, never by locale.' }));

export default defineConfig([
  globalIgnores(['dist/**', 'coverage/**', 'fixtures/**']),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['src/**/*.ts'],
    extends: [tseslint.configs.recommendedTypeCheckedOnly],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['src/**/*.ts'],
    ignores: ['src/cli/**', 'src/**/*.test.ts', 'src/test-support/**'],
    languageOptions: { globals: {} },
    rules: {
      'no-restricted-imports': ['error', { patterns: [nodeBuiltins] }],
      'no-restricted-globals': ['error', ...impureGlobals],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Ties use the seeded draw.' },
        ...localeMethods,
      ],
      'no-restricted-syntax': [
        'error',
        { selector: 'ImportExpression', message: 'The tally library loads no code at run time.' },
      ],
      'no-console': 'error',
    },
  },
  prettier,
]);
