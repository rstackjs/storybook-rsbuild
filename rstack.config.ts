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

// TODO: `--no-cache` on the format script and nano-staged entries in package.json works around a
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
