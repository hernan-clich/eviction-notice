import js from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import importPlugin from 'eslint-plugin-import';
import promise from 'eslint-plugin-promise';
import unicorn from 'eslint-plugin-unicorn';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/.next/**',
      'docs/temp/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  // Type-aware parser config + project-wide rules.
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['eslint.config.js', '*.config.js'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      import: importPlugin,
      promise,
      unicorn,
    },
    rules: {
      // TypeScript
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-ignore': true,
          'ts-nocheck': true,
          'ts-expect-error': 'allow-with-description',
        },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',

      // import order + cycles
      'import/order': [
        'error',
        {
          'newlines-between': 'always',
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      'import/no-cycle': 'error',
      'import/no-duplicates': 'error',

      // promise (flat/recommended subset)
      ...promise.configs['flat/recommended'].rules,

      // unicorn (recommended subset, with project opt-outs)
      ...unicorn.configs['flat/recommended'].rules,
      'unicorn/prevent-abbreviations': 'off',
      'unicorn/no-null': 'off',
      'unicorn/prefer-module': 'off',
      'unicorn/filename-case': ['error', { cases: { kebabCase: true, pascalCase: true } }],
    },
    settings: {
      'import/resolver': {
        typescript: {
          alwaysTryTypes: true,
          project: ['apps/*/tsconfig.json', 'packages/*/tsconfig.json'],
        },
      },
    },
  },

  // Node runtime packages: the worker daemon, the skill endpoint, and shared libs
  // all run on Node (Railway / Vercel functions), so Node globals are available.
  {
    files: ['apps/**/*.ts', 'packages/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  // Config files: relax filename-case (dotted config names).
  {
    files: ['**/*.config.{js,mjs,ts}', 'eslint.config.js'],
    rules: { 'unicorn/filename-case': 'off' },
  },

  // Plain JS config files: disable type-aware rules (no tsconfig coverage).
  {
    files: ['**/*.{js,mjs,cjs}'],
    ...tseslint.configs.disableTypeChecked,
  },

  // Prettier: must be last to disable formatting-related rules.
  prettierConfig,
);
