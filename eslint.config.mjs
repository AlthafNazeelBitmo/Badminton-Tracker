import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

/**
 * Lint rules.
 *
 * Deliberately narrow: rules that catch real defects, not rules that enforce a house
 * style Prettier already handles. A lint suite that mostly reports formatting noise
 * gets switched off, and then the useful rules go with it.
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/node_modules/**',
      '**/coverage/**',
      'apps/api/prisma/migrations/**',
      '**/*.config.{js,mjs,ts}',
      '**/next-env.d.ts',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,

  {
    rules: {
      // Unused variables are usually a leftover or a typo; an underscore prefix is the
      // documented escape hatch for a deliberately ignored argument.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // `any` disables the type checker exactly where it is most needed.
      '@typescript-eslint/no-explicit-any': 'error',
      //
      // `consistent-type-imports` is deliberately NOT enabled.
      //
      // This codebase uses decorators for dependency injection. NestJS resolves a
      // constructor parameter from the *runtime value* of its type, emitted by
      // `emitDecoratorMetadata`. Rewriting `import { PrismaService }` to
      // `import type { PrismaService }` erases that value, and the framework can no
      // longer resolve the dependency — the application compiles, passes type checking,
      // and then fails to start. The rule's autofix does exactly this, so it is off
      // rather than merely unenforced.
      //
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-implicit-coercion': 'warn',
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },

  {
    // Seeds, CLI tools and tests legitimately write to the console and use loose types
    // for fixtures.
    files: [
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/*.spec.ts',
      '**/test/**',
      '**/e2e/**',
      'apps/api/prisma/seed.ts',
      'apps/api/src/cli/**',
      'apps/mobile/jest.setup.js',
    ],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  {
    // Jest injects its globals rather than requiring an import, so they have to be
    // declared or every `describe` reads as an undefined variable. The API and web
    // suites use Vitest, which is imported explicitly and needs none of this.
    files: ['apps/mobile/**/*.{test,spec}.{ts,tsx}', 'apps/mobile/jest.setup.js'],
    languageOptions: {
      globals: {
        jest: 'readonly',
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeAll: 'readonly',
        beforeEach: 'readonly',
        afterAll: 'readonly',
        afterEach: 'readonly',
      },
    },
  },
);
