import { define } from 'rstack'

define.lint(({ globalIgnores, globals, js, ts }) => [
  // `compiled/`, `coverage/`, `dist/` and `storybook-static/` are covered by
  // `.gitignore`, which Rslint reads.
  globalIgnores(['**/*.vue', '**/.rslib/**']),
  js.configs.recommended,
  ts.configs.recommendedTypeChecked,
  {
    languageOptions: {
      // Type-aware rules and `--type-check` apply to the files included by these
      // tsconfigs. Files outside them (per-package build-config.ts / rstack.config.ts
      // and root rstack.config.ts) only get rules that need no type information.
      parserOptions: {
        project: [
          './packages/*/tsconfig.json',
          './sandboxes/*/tsconfig.json',
          './sandboxes/*/*/tsconfig.json',
          './website/tsconfig.json',
          './tests/tsconfig.json',
          './e2e/tsconfig.json',
          './scripts/tsconfig.json',
        ],
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.rstest,
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      'no-cond-assign': 'off',
      'no-undef-init': 'warn',
      'no-useless-assignment': 'off',
      'no-unused-vars': [
        'warn',
        {
          args: 'all',
          argsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
          varsIgnorePattern: '^_',
        },
      ],
      'dot-notation': 'warn',
      // Presets, loaders, and test doubles implement async signatures without
      // awaiting. Kept in this block because the rule also reports `.js` files.
      '@typescript-eslint/require-await': 'off',
    },
  },
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          args: 'all',
          argsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
          varsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-dynamic-delete': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-invalid-void-type': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/prefer-optional-chain': 'off',
      // `any` is allowed (no-explicit-any is off), so the rules that flag values
      // flowing out of `any` are off as well.
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
])

define.test({
  projects: [
    './packages/*/rstack.config.ts',
    './sandboxes/*/rstack.config.ts',
    './tests/rstack.config.ts',
  ],
})

define.staged({
  '*.{json,css,less,scss}': 'rs fmt',
  '*.{js,jsx,ts,tsx,mjs,cjs}': 'rs fmt',
})

define.fmt({
  semi: false,
  singleQuote: true,
  plugins: ['prettier-plugin-organize-imports'],
  sortPackageJson: true,
  // organize-imports wraps Prettier's parsers, not Rstack's default Yuku parsers.
  overrides: [
    {
      files: '*.{js,jsx,mjs,cjs}',
      options: { parser: 'babel' },
    },
    {
      files: '*.{ts,tsx,mts,cts}',
      options: { parser: 'typescript' },
    },
  ],
  ignorePatterns: [
    '**/*.vue',
    '**/.rslib/**',
    '**/__snapshots__/**',
    '.codex/environments/environment.toml',
  ],
})
