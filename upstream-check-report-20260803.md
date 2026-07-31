# Storybook Upstream Drift Check

- **Generated**: 2026-08-03
- **Upstream**: storybookjs/storybook@next (`3e12dfc040`)
- **Packages audited**: 5 — **Findings**: 26 missing behaviors (6 high, 12 medium, 8 low) after cross-package dedup
- **Manifest coverage**: complete (no `UNMAPPED` / `MISSING-*` / `UNLISTED-LOCAL` entries)

## Findings

### Cross-package (affects all four `framework-*` packages)

| Severity | Behavior | Upstream evidence | Local evidence | Disposition |
| --- | --- | --- | --- | --- |
| medium | `FrameworkName` / `BuilderName` not wrapped in `CompatibleString<T>` (`T \| (string & {})`), so the documented `getAbsolutePath(...)` / `dirname(require.resolve(...))` pattern fails type-check in `main.ts` | `code/frameworks/*/src/types.ts`; helper at `code/core/src/types/modules/core-common.ts:897-911` | `framework-{html,web-components,vue3,react}/src/types.ts:11-12` — plain literals. Already worked around in `sandboxes/lit/.storybook/main.ts:5` with `: any` | pending |
| low | Framework options read as `framework.options.builder` without the upstream `framework.options ?? {}` guard — `framework: { name: '...' }` (no `options`) throws `TypeError` at config time | `code/frameworks/vue3-vite/src/preset.ts` — `viteFinal` frameworkOptions resolution | `framework-vue3/src/preset.ts:13-14`, `framework-react/src/preset.ts:20`, `framework-html/src/preset.ts:11`, `framework-web-components/src/preset.ts:13` | pending |

### packages/builder-rsbuild

12 missing behaviors (2 high, 6 medium, 4 low).

| Severity | Behavior | Upstream evidence | Local evidence | Disposition |
| --- | --- | --- | --- | --- |
| high | Storybook resolve conditions (`storybook`, `stories`, `test`) never added to the preview resolver — a cross-builder contract (builder-vite does it too), so mock/test export-condition variants silently never load | `builder-webpack5/src/preview/base-webpack.config.ts:96-104`; `builder-vite/src/plugins/storybook-config-plugin.ts:40-44` | `src/preview/iframe-rsbuild.config.ts:376-404` — resolve block sets `symlinks`/`extensions`/`fallback`, no `conditionNames` | pending |
| high | `build.test.disableBlocks` externalizes `@storybook/blocks`, a package name that no longer exists (renamed to `@storybook/addon-docs/blocks` upstream in `75df3c88e`); docs blocks get bundled into `--test` builds and the injected `__STORYBOOK_BLOCKS_EMPTY_MODULE__` global is dead | `builder-webpack5/src/preview/iframe-webpack.config.ts:106-108` | `src/preview/iframe-rsbuild.config.ts:197-200` (global still injected at `:501`) | pending |
| medium | Module-mocking perf hardening not ported (`ce88eed3b`, `105f75052`): preview-config mtime cache, `mockMap.size === 0` early bail, `candidateSpecifiers` pre-filter. Costs a resolve + try/catch per module request even with zero mocks | `builder-webpack5/src/plugins/webpack-mock-plugin.ts:66-118, 130-140` | `src/plugins/rspack-mock-plugin.ts:56-89` | pending |
| medium | Mocker-runtime injection not idempotent and re-reads the runtime each compilation (upstream caches `cachedRuntime` and guards on `compilation.getAsset('mocker-runtime-injected.js')`) | `builder-webpack5/src/plugins/webpack-inject-mocker-runtime-plugin.ts:55-72` | `src/plugins/rspack-inject-mocker-runtime-plugin.ts:41-57` | pending |
| medium | `features.developmentModeForBuild` ignored — built preview always gets production `NODE_ENV` | `builder-webpack5/src/preview/iframe-webpack.config.ts:182-186`; flag at `core/src/types/modules/core-common.ts:578` | `src/preview/iframe-rsbuild.config.ts:311-316`; flag absent repo-wide | pending |
| medium | `process.env` object not defined (only per-key `process.env.X` via `stringifyProcessEnvs`). Code doing `const { X } = process.env` / `Object.keys(process.env)` gets the empty `process/browser.js` shim. Upstream's parenthesised form is itself a bugfix (`1cbf505e`) | `builder-webpack5/src/preview/iframe-webpack.config.ts:180-186` | `src/preview/iframe-rsbuild.config.ts:311-316` | pending |
| medium | No `PREVIEW_BUILDER_PROGRESS` reporting to the manager — progress bar never advances, and the cached `modulesCount` heuristic is read but never written back | `builder-webpack5/src/index.ts` — `starter()` ProgressPlugin block | `src/index.ts:157-224`; `iframe-rsbuild.config.ts:125,140` reads `modulesCount` into `_modulesCount` and discards it | pending |
| medium | `storybook dev` does not surface compilation errors/warnings — upstream logs warnings and throws `WebpackCompilationError`; local returns first-compile stats unchecked, so a failed preview reports a successful start | `builder-webpack5/src/index.ts` — `starter()` + `getWebpackStats()` | `src/index.ts:186-224` (`waitFirstCompileDone`); only `WebpackInvocationError` imported | pending |
| medium | Production minifier does not preserve function names — upstream swaps in Terser with `mangle: false, keep_fnames: true` (plus `build.test.esbuildMinify` / `disableSourcemaps` / `disableTreeShaking` handling) | `builder-webpack5/src/preview/iframe-webpack.config.ts:238-268` | No minifier config in `packages/builder-rsbuild/src`; Rsbuild's default mangling SWC minifier applies | pending |
| low | `features.babelRemoveBugfixes` opt-out not honoured — `env.bugfixes = true` set unconditionally | `builder-webpack5/src/presets/custom-webpack-preset.ts:16-45` | `src/preview/iframe-rsbuild.config.ts:350-355` | pending |
| low | No `.md` → `asset/source` rule (only the `?raw` resourceQuery fallback), so `import readme from './README.md'` fails | `builder-webpack5/src/preview/iframe-webpack.config.ts:214-217` | `src/preview/iframe-rsbuild.config.ts:467-470` | pending |
| low | `NODE_PATH` (`resolve.modules`) and `resolve.fallback.crypto` not handled | `iframe-webpack.config.ts:226`; `base-webpack.config.ts:105-109` | `src/preview/iframe-rsbuild.config.ts:395-404` | pending |

### packages/framework-react

8 missing behaviors (3 high, 3 medium, 2 low).

| Severity | Behavior | Upstream evidence | Local evidence | Disposition |
| --- | --- | --- | --- | --- |
| high | tsconfig lookup has no fallback chain (`tsconfig.json` → `tsconfig.base.json` → `tsconfig.app.json`, upstream `07edf14e`). In monorepos / Vite-style projects `matchPath` stays `undefined` and aliased-import prop tables come out empty | `presets/react-webpack/src/loaders/react-docgen-loader.ts`; `react-vite/src/plugins/react-docgen.ts:48-52` | `src/loaders/react-docgen-loader.ts:116` — bare `findUp('tsconfig.json')` | pending |
| high | `reactDocgen: 'react-docgen-typescript'` no longer runs react-docgen on non-TS files — upstream keeps the react-docgen loader for `/\.(cjs\|mjs\|jsx?)$/` alongside the RDT plugin. Locally the vendored plugin's filter is `**/**.tsx` only, so JS/JSX components get zero docgen | `presets/react-webpack/src/framework-preset-react-docs.ts` — `webpackFinal` RDT branch; `react-vite/src/preset.ts` — `plugins.unshift(reactDocgen({ include: /\.(mjs\|jsx?)$/ }))` | `src/react-docs.ts:65-77`; vendored filter at `src/plugins/react-docgen-typescript/index.ts:117-120` | pending |
| high | `typescriptPresent` guard is inert — the check is computed but the `if` body is **empty** (`src/react-docs.ts:54-63`) and the RDT plugin is added unconditionally. `typescript` is an optional peer dep, so a JS-only project setting `reactDocgen: 'react-docgen-typescript'` hard-fails at startup instead of degrading | `react-vite/src/preset.ts` — `viteFinal` `typescriptPresent` gate | `src/react-docs.ts:54-77` | pending |
| medium | `features.developmentModeForBuild` not honored — no `DefinePlugin({ NODE_ENV: 'development' })` injection | `frameworks/react-webpack5/src/preset.ts` — `webpack` hook | `src/preset.ts:1-24`; flag absent repo-wide | pending |
| medium | No `@storybook/react` resolve alias — under pnpm / multi-copy monorepos the preview can load a second renderer instance (duplicated React context, broken decorators) | `frameworks/react-webpack5/src/preset.ts` — `config.resolve.alias['@storybook/react']` | `src/preset.ts`; builder `storybookPaths` at `builder-rsbuild/src/preview/iframe-rsbuild.config.ts:76-79` holds only `@storybook/global` | pending |
| medium | tsconfig `find-up` unbounded by project root (upstream passes `last: getProjectRoot()`) — a stray `tsconfig.json` above the project is picked up | `presets/react-webpack/src/loaders/react-docgen-loader.ts` | `src/loaders/react-docgen-loader.ts:116`; `getProjectRoot` unused repo-wide | pending |
| low | react-native → react-native-web importer remap missing (vite-only upstream) — RN-web projects hit `ReactDocgenResolveError` | `react-vite/src/plugins/react-docgen.ts` — `getReactDocgenImporter` RN branch | `src/loaders/react-docgen-loader.ts:187-207` | pending |
| low | `features.experimentalTestSyntax` not declared in the framework's `StorybookConfig` (vite-only upstream) — type error in `main.ts` for CSF Next `.test` syntax | `react-vite/src/types.ts` — `StorybookConfigFramework.features` | `src/types.ts:44-62` | pending |

### packages/framework-vue3

5 missing behaviors (2 medium, 3 low — one counted under Cross-package).

| Severity | Behavior | Upstream evidence | Local evidence | Disposition |
| --- | --- | --- | --- | --- |
| medium | `docgen` framework option absent — no way to disable docgen or pick a backend (`false \| true \| 'vue-docgen-api' \| 'vue-component-meta' \| { plugin, tsconfig }`). `vue-docgen-loader` is always injected. Inconsistent with `framework-react`'s `reactDocgen: false` | `vue3-vite/src/types.ts` — `FrameworkOptions.docgen`; `vue3-vite/src/preset.ts` — `resolveDocgenOptions` | `src/types.ts:14-16`; `src/framework-preset-vue3.ts:62-71` | pending |
| medium | `vue-component-meta` (Volar) docgen backend not ported — components in `.ts`/`.tsx`/`.js`/`.jsx` get no docgen at all, and SFC docs lack slots/exposed/resolved complex types. Upstream documents it as the future default | `vue3-vite/src/plugins/vue-component-meta.ts` (whole file); wired in `vue3-vite/src/preset.ts` | No counterpart; `src/framework-preset-vue3.ts:20-44` only registers `vue-docgen-loader` on `/\.vue$/`; dep absent from `package.json:47-52` | pending |
| low | Public docgen types (`VueDocgenPlugin`, `VueDocgenInfo<T>`, `VueDocgenInfoEntry<T, TKey>`) not exported | `vue3-vite/src/types.ts` | `src/types.ts:1-44` — only `FrameworkOptions` / `StorybookConfig` | pending |
| low | No exported helper carrying the `vue` → `vue/dist/vue.esm-bundler.js` alias outside Storybook's own build (upstream ships `storybookVuePlugin()` on a `./vite-plugin` entry) — portable stories under Rstest silently get the runtime-only Vue build, so string-template stories fail | `vue3-vite/src/vite-plugin.ts`; `vue3-vite/src/plugins/vue-template.ts` — `templateCompilation` | `src/framework-preset-vue3.ts:47-60` (alias applied only via `rsbuildFinal`); `package.json:22-33` exposes only `.`, `./node`, `./preset` | pending |

### packages/framework-html

2 missing behaviors (1 high, 1 counted under Cross-package).

| Severity | Behavior | Upstream evidence | Local evidence | Disposition |
| --- | --- | --- | --- | --- |
| high | `StorybookConfig` type not re-exported from the `/node` entrypoint (upstream bugfix `4ae17109`). **Isolated port miss** — `framework-react`, `framework-vue3` and `framework-web-components` all have it | `html-vite/src/node/index.ts` — `export type { StorybookConfig };` | `src/node/index.ts:1-5` — imported for `defineMain`'s signature, never re-exported | pending |

### packages/framework-web-components

1 missing behavior, counted under Cross-package (`CompatibleString`). Otherwise behaviorally aligned with upstream `web-components-vite`.

## Undocumented divergences

Differences that look deliberate but are not recorded in `manifest.json`. Each needs a decision: record as intentional, or treat as drift.

### packages/builder-rsbuild
- `findMockRedirect` imported from `@vitest/mocker/redirect` with a pinned `"@vitest/mocker": "3.2.7"` dep (`src/plugins/rspack-mock-plugin.ts:5`, `package.json:53`); upstream now re-exports it from `storybook/internal/mocking-utils` (`1ae1134c3`). Couples the builder to a specific mocker version rather than the one core ships.
- Import-pipeline gating: local uses `lazyCompilation !== false && !isProd` (`src/preview/virtual-module-mapping.ts:121-122`) and defaults lazy compilation on in dev (`iframe-rsbuild.config.ts:161-182`). Upstream now enables the pipeline only when `lazyCompilation` is explicitly truthy **and** `semver.lt(webpackVersion, '5.101.3')` — no equivalent Rspack-version gate locally.
- Change detection classifies add-vs-change from `compilation.fileDependencies` (`src/change-detection-adapter/index.ts:49-85`) rather than upstream's `firstRun` flag. Justified in-file, but not in the manifest.
- `webpackFinal` applied only to presets opted into via the local `webpackAddons` main-config field (`src/index.ts:61-98`, type at `src/types.ts:36`); upstream applies it across all presets/addons. Third-party addons implementing only `webpackFinal` are inert here unless explicitly listed.

### packages/framework-react
- `react-docgen-typescript` path uses a locally vendored Rsbuild plugin (`src/plugins/react-docgen-typescript/`, fork of `@joshwooding/vite-plugin-react-docgen-typescript`) instead of `@storybook/react-docgen-typescript-plugin`. In-file `TODO` explains Rspack lacks the needed hooks. Note `@storybook/react-docgen-typescript-plugin` is still a runtime dependency while only its *types* are used (`src/types.ts:1`).
- `src/react-docs.ts:80-118` — ~40 lines of commented-out "webpack flavor" implementation left in shipped source.
- `src/loaders/react-docgen-loader.ts:120` uses `logger.info` where upstream uses `logger.debug` (`77a6e572`), so it prints on every startup at default log level.

### packages/framework-vue3
- `src/framework-preset-vue3.ts:56` aliases `vue$` (exact-match) to an absolute `require.resolve` path; upstream aliases bare `vue` → bare `vue/dist/vue.esm-bundler.js`, which also rewrites `vue/*` deep imports. The in-file comment references a 2023 webpack preset commit, not current upstream.
- `src/preset.ts:20-23` sets `typescript.skipCompiler = true`; upstream `vue3-vite/src/preset.ts` exports no `typescript` preset property.

### packages/framework-html / framework-web-components (shared shape)
- `core` is an async preset function forwarding `framework.options.builder` into `core.builder.options` (`framework-html/src/preset.ts:4-15`, `framework-web-components/src/preset.ts:5-19`); upstream's `core` is a static object. Needed so `BuilderOptions` reach `storybook-builder-rsbuild`, but unrecorded.
- `import.meta.resolve(...)` results unwrapped with `fileURLToPath` locally; upstream passes the raw `file://` URL.
- `StorybookConfigFramework.typescript?: Partial<TypescriptOptions* & TypescriptOptionsBuilder>` added in all four local frameworks with no upstream counterpart. In `framework-web-components/src/types.ts:33-35` the alias `TypescriptOptions as TypescriptOptionsWebComponents` is a misnomer — it is the base `storybook/internal/types` `TypescriptOptions`.

## Notable local-only behaviors

Present locally with no upstream counterpart; recorded for context, not drift.

- **builder-rsbuild**: `excludeNodeModulesFromStoryContext` (`src/preview/virtual-module-mapping.ts:23-83`) works around Rspack's `ContextModule` enumerating `node_modules`; automatic lazy-compilation disable when MSW is detected in `staticDirs` (`iframe-rsbuild.config.ts:158-182`, `src/preview/detect-msw.ts`); Rspack/Rsbuild version-compat guards (`rspackMajorVersion === 1` branches, hard error when `VirtualModulesPlugin` is unavailable); user `rsbuild.config.*` loading with `environments` resolution (`iframe-rsbuild.config.ts:205-245`); flat preview output layout + `htmlLang` template parameter.
- **framework-react**: three-state promise gate around tsconfig init in the docgen loader (`src/loaders/react-docgen-loader.ts:85-133`) — a genuine improvement over upstream's plain boolean, given Rspack's parallel loader execution; vendored RDT plugin with a TS watch program and module-invalidation queue; `src/requirer.ts` indirection over `require.resolve` for test mockability.
- **framework-vue3**: `addon-docs` preset scan merging `options.vueDocgenOptions` (`src/framework-preset-vue3.ts:10-18`, legacy `@storybook/preset-vue3-webpack` extension point, dereferences `preset.options` unguarded); forwards Rspack `resolve.alias` into `vue-docgen-api`'s `alias` option (`:34`) so docgen resolves build aliases — upstream calls `parse(id)` with no options.
- **framework-web-components**: `rsbuildFinal` deleting `config.html` (`src/preset.ts:21-27`), unique to this package since `92bce06`.

## Deferred

_(none yet — dispositions pending)_

## Mapping changes

None this run. `--coverage` reported complete coverage against `3e12dfc040`; no manifest entries were added or updated.
