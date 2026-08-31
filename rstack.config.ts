import { define } from 'rstack'

define.lint(({ globalIgnores, globals, js, ts }) => [
  globalIgnores([
    'scripts/**',
    '**/*.vue',
    '**/.rslib/**',
    '**/compiled/**',
    '**/coverage/**',
    '**/dist/**',
    '**/storybook-static/**',
  ]),
  js.configs.recommended,
  // TODO: lint is not type-aware yet (parity with the former Biome setup). Evaluate
  // ts.configs.recommendedTypeChecked with languageOptions.parserOptions.project (e.g.
  // ["./packages/*/tsconfig.json"]) or parserOptions.projectService once the diagnostics volume is known. Once
  // rs check --type-check proves equivalent across the package tsconfigs, delete
  // scripts/check/check-package.ts and the per-package type-check scripts.
  ts.configs.recommended,
  {
    languageOptions: {
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
    },
  },
])

define.test({
  projects: [
    './packages/*/rstest.config.ts',
    './sandboxes/*/rstest.config.ts',
    './tests/rstest.config.ts',
  ],
})

define.staged({
  '*.{json,css,less,scss}': 'rstack fmt --no-cache',
  '*.{js,jsx,ts,tsx,mjs,cjs}': 'rstack fmt --no-cache',
})

// TODO: `--no-cache` on the format script in package.json and define.staged() entries above works around a
// Prettier idempotency regression fixed by prettier/prettier#19725 but not yet released as of
// Prettier 3.9.6. Once a release containing the fix ships and Prettier is bumped, drop the flag.
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
