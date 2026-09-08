import js from '@eslint/js';
import tseslint from 'typescript-eslint';
// `eslint-config-next` (v15) only shipped a legacy eslintrc entry that called
// `@rushstack/eslint-patch`, which throws under ESLint 9 flat config. It has been
// removed; the Next plugin it wrapped exposes first-class flat configs directly.
import next from '@next/eslint-plugin-next';

export default tseslint.config(
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'next-env.d.ts',
      'src/db/migrations/**',
      // Historical Phase 3F standalone verification scripts (standalone Node
      // utilities, not application code; Node globals are out of scope here).
      '3f4-*.mjs',
      'paypal-e2e.mjs',
      'ui-e2e.mjs',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  next.flatConfig.coreWebVitals,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      eqeqeq: ['error', 'always'],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // One boundary rule, deliberately simple: domain modules stay framework-free
    // so they remain testable without rendering React (master prompt section 35).
    files: ['src/modules/**/*.ts'],
    ignores: ['src/modules/**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['react', 'react-dom', 'next', 'next/*', 'server-only', 'client-only'],
              message:
                'Domain modules must not depend on the framework. Keep React/Next usage in src/app and src/ui.',
            },
          ],
        },
      ],
    },
  },
);
