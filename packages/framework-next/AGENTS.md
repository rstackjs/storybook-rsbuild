# packages/framework-next/AGENTS.md

Storybook framework integration for Next.js, powered by `next-rspack`. This document is a design guide, not a code walkthrough — the source is the ground truth for *what*; this document is for *why*.

## Architectural Principle: Bridge, Don't Simulate

The existing Storybook Next.js integrations (`@storybook/nextjs`, `@storybook/nextjs-vite`) both **manually reconstruct** Next.js's webpack/Vite config — they don't call Next.js's own config generator, they reimplement it. As a result, every Next.js release (even patches) can break them, and they each track 35+ `next/dist/*` internal paths just for the build pipeline.

`framework-next` takes a fundamentally different approach: it **invokes Next.js's own `getBaseWebpackConfig()`** with `NEXT_RSPACK=true` and cherry-picks the emitted rspack config into Rsbuild's config via `rsbuildFinal`. The loader chain, aliases, SWC options, and define-plugin values are all produced by Next.js itself and follow Next.js releases automatically.

This bridging strategy is structurally possible only on the Rspack side:

- Next.js is built on webpack; `getBaseWebpackConfig()` emits a `webpack.Configuration`.
- Rspack is webpack-API-compatible and consumes that output natively.
- Vite has an entirely different API shape — bridging is architecturally impossible.
- Turbopack is Next.js-internal and not exposed.

The upshot: maintenance load shifts from "track 35+ internal paths for build logic" to "adapt one function signature (`getBaseWebpackConfig`) + maintain ~940 LOC of runtime decorators (shared with upstream `@storybook/nextjs-vite`)."

## High-Level Flow

```mermaid
flowchart TD
    subgraph P1["1 — Extract from Next.js (utils/next-config.ts)"]
        direction LR
        LC[loadConfig] --> LP[loadProjectInfo] --> FP[findPagesDir] --> GB["getBaseWebpackConfig<br/>NEXT_RSPACK=true"]
    end

    P1 -->|"alias, fallback, defines,<br/>resolveLoader, rawRules, rawPlugins"| P2

    subgraph P2["2 — Cherry-pick (preset.ts)"]
        direction TB
        FNA["filterNextAliases<br/>drop react/react-dom"]
        SOA["getStorybookOverrideAliases<br/>next/image, styled-jsx"]
        BLC["buildNextLoaderChain<br/>next-swc-loader → shim"]
        PNC["prepareNextCssRules<br/>+ font URL rewrite"]
        FNP["filterNextPlugins<br/>allowlist"]
    end

    P2 --> P3

    subgraph P3["3 — Inject into Rsbuild (rsbuildFinal)"]
        direction LR
        BC["tools.bundlerChain<br/>strip Rsbuild CSS / HMR"] --> RS["tools.rspack<br/>merge Next.js config"]
    end
```

## The Four-Party Contract

This package only exists to mediate between four codebases that each own part of the picture and don't know about each other. Understanding which party is allowed to dictate what is the single best mental model for why things are shaped the way they are.

| Party | Owns | Assumes |
|---|---|---|
| **Next.js** | config generation, SWC, CSS/font pipeline, runtime contexts | that it controls the entire build and the runtime `<head>` (via `_document.js`) and a dev server at `/_next/*` |
| **Rspack** | low-level bundling, loader execution, `NormalModule` hooks | webpack-compatible config semantics |
| **Rsbuild** | opinionated defaults (CSS pipeline, SWC, HMR), plugin orchestration via `CHAIN_ID` | that it's the sole config author; that user-side `rsbuild.config.ts` is load-bearing |
| **Storybook** | story discovery, preview iframe, virtual entry modules, decorators, React runtime identity | that addons own their rules/plugins; that React is a singleton provided by `storybook/internal` |

Conflicts and who wins:

- **React identity**: Storybook wins. Next.js aliases `react`/`react-dom` to its own `next/dist/compiled/*` copies; we strip those (`filterNextAliases`) so Storybook's runtime React wins. Double-copy breaks hooks and context.
- **CSS pipeline**: Next.js wins. Both Rsbuild and Next.js register CSS rules + extract plugins. We delete Rsbuild's and inject Next.js's — the only way `next/font` target.css works.
- **JS compilation**: Next.js wins. Rsbuild's `builtin:swc-loader` gets rewritten to Next.js's loader chain so `'use client'`, `server-only`, JSX runtime, and `next/dynamic` behave natively.
- **HMR**: split. Keep Next.js's `ReactRefreshRspackPlugin` (provides `$ReactRefreshRuntime$`) but add `ReactRefreshInitPlugin` for the `injectIntoGlobalHook()` bootstrap Next.js expects a separate entry to do.
- **Runtime DOM**: Next.js assumes it; we shim it. Next.js's client code expects DOM elements that `_document.js` normally renders; we never render `_document.js`, so `preview.tsx` inserts them manually (see Shim Catalogue).
- **Entries**: Storybook wins. Next.js wants `main-app` / `pages/_app` entries; we pass a stub purely so `getBaseWebpackConfig` doesn't throw, then discard the entry portion of its output.

If you're adding a feature, the first question to answer is: which of the four parties are in conflict, and which one should win?

## Design Trade-offs

### Cherry-pick, don't mirror

`getBaseWebpackConfig()` emits ~80 rules, 18 plugins, 30+ aliases, full `externals`/`optimization` blocks, and an entry/output configuration tuned for a real `.next/` build. Using it whole-cloth would break Storybook in a hundred small ways. So we take exactly six fields: `alias`, `fallback`, `defines`, `resolveLoader`, `rawRules`, `rawPlugins` — everything else (Storybook's entry, output, HMR transport, dev server) stays with Rsbuild/Storybook.

The extraction is therefore intentionally *narrow*. Resist forwarding more fields "just in case" — each one adds a coupling point to `getBaseWebpackConfig`'s output shape, and that shape drifts across versions.

### Allowlist, not denylist, for plugins

`rawPlugins` contains 18 entries, most of which are actively harmful in Storybook (`BuildManifestPlugin` writes to `.next/`, `NextExternalsPlugin` excludes modules we need bundled, etc.). A denylist would silently leak any new plugin Next.js adds. `KEEP_PLUGIN_NAMES` is a two-item allowlist; if Next.js adds something genuinely needed at story-time, we explicitly opt in. This has kept churn at ~0 across `15.3 → 16.2`. The same rule applies to `CSS_LOADER_MARKERS`.

### Bridge at the config boundary, not the plugin boundary

An alternative would be to write an Rsbuild plugin that hooks `modifyBundlerChain` and mirrors Next.js feature-by-feature. We rejected this: it keeps us on the simulation treadmill (every Next.js feature = one new hook). Extracting from `getBaseWebpackConfig()` means features we didn't know existed — `.module.css` variables-only mode, `next/font/local` target.css, `transpilePackages` — come along for free.

### Mutate rspack config imperatively, not declaratively merge

`mergeRsbuildConfig` only works for Rsbuild-shaped data (`source.define`, `resolve.alias`). For rspack-shaped injection (rules, fallbacks, plugins) we use `tools.rspack: (rspackConfig) => {...}` and mutate. Declarative merging there would duplicate rules (arrays don't merge by key) and fight Rsbuild's own rule placement. Mutation lets us `unshift` CSS rules so they beat generic matchers and `push` plugins after everything is wired.

### `CHAIN_ID` over post-hoc filtering

Rsbuild's default plugins are registered at `modifyBundlerChain` time with stable `CHAIN_ID` keys. Deleting via the chain API (`chain.module.rules.delete(CHAIN_ID.RULE.CSS)`) is robust across Rsbuild versions. Filtering post-hoc on plugin class names would race against plugins that wrap/subclass.

### Keep `next-style-loader` even though it requires a shim

Pages Router dev mode uses `next-style-loader` (not `CssExtractRspackPlugin`) for CSS. Its `options.insert` callback queries `#__next_css__DO_NOT_USE__`, an anchor `_document.js` normally renders. We could filter the rule and force everything through `CssExtractRspackPlugin` — but that diverges from Next.js's dev-mode behavior and would hide whole classes of ordering bugs. The smaller blast radius is to inject the anchor in `preview.tsx` (six lines, zero loader-chain changes).

### Ship loader shims as uncompiled CJS/JS

`loaders/*.cjs|js` are listed in `package.json#files` but *not* bundled. They're loaded at the user's Storybook build time, so they need to resolve `next` from the user's project, not from ours. Bundling them would freeze `require('next/dist/...')` against our `next` version and recreate the "track every `next/dist/*` path" problem.

### JS `next-swc-loader`, not `builtin:next-swc-loader`

`builtin:next-swc-loader` is registered only in Next.js's vendored `@next/rspack-binding` fork. Standard `@rspack/core` panics on it. The JS loader is slower (~0.16ms/file) but universal; in dev mode the overhead is invisible.

## Shim Catalogue

Every shim here exists because one of the four parties makes an assumption that doesn't hold. Each entry states the *smallest possible reason you'd remove it* — if that reason goes away, delete the shim.

| Shim | Assumption it plugs | Remove when |
|---|---|---|
| `process.env.NEXT_RSPACK = 'true'` | `withRspack()` normally sets this; we're bypassing `withRspack()` | never (it *is* the bridge) |
| `process.env.RSPACK_CONFIG_VALIDATE = 'loose-silent'` | Next.js emits config with fields Rspack's schema doesn't know | Rspack loosens its validator or Next.js stops emitting webpack-only keys |
| `process.env.__NEXT_PRIVATE_RENDER_WORKER = 'defined'` | `loadConfig()` throws if unset in some contexts | Next.js drops the check |
| Dummy `encryptionKey` / `previewModeEncryptionKey` / `buildId` | `getBaseWebpackConfig` validates these but the code path that uses them is dead in our case | Next.js splits the validator from `getBaseWebpackConfig` |
| `meta[name="next-head-count"]` injection | Next.js Head component reads this counter; `_document.js` renders it | we render a synthetic `_document.js` equivalent in `preview.tsx` |
| `noscript#__next_css__DO_NOT_USE__` injection | `next-style-loader.options.insert` queries it; `_document.js` renders it | same as above, or we filter `next-style-loader` rules |
| `NoopTraceSpanPlugin` | `next-swc-loader` reads `this.currentTraceSpan`; `RspackProfilingPlugin` would set it but resolves `NormalModule` from Next.js's vendored rspack-core (distinct class from Rsbuild's rspack instance) | Next.js decouples tracing from `NormalModule` identity |
| `ReactRefreshInitPlugin` | Next.js's `ReactRefreshRspackPlugin` only wires `$ReactRefreshRuntime$`; the `injectIntoGlobalHook()` bootstrap normally lives in a separate entry Next.js injects via its own orchestration | Next.js moves the bootstrap into the plugin or exposes a helper |
| `swc-loader-shim.cjs` (strips `pitch`) | `next-swc-loader.pitch` reads source from disk; Storybook's virtual entry modules only exist in memory via `VirtualModulesPlugin` | `next-swc-loader.pitch` gains a memory-source fallback |
| `next-font-url-rewrite.cjs` | `next-font-loader` emits `url(/_next/static/media/…)` but `emitFile`s to `static/media/…`; real Next.js bridges via dev-server alias `/_next/* → output root` | Storybook dev server gains the same alias, or Next.js drops the `/_next/` prefix |
| `next-image-mock.js` | `next/image` expects a `/_next/image` optimization endpoint | Storybook gains an image-optimization dev endpoint |
| `NODE_BUILTINS_FALLBACK` | user/transitive code imports `fs`, `path`, etc. in browser builds; Next.js's own `resolve.fallback` covers some but not all | Next.js's browser-build fallback covers all Node builtins |
| `filterNextAliases` (drop react/react-dom) | Next.js aliases react to `next/dist/compiled/react`; Storybook needs the real react | Next.js and Storybook agree on a shared React resolution |
| `filterNextPlugins` (allowlist) | `rawPlugins` contains build-time, runtime-harmful plugins | Next.js splits "build" vs "render-time" plugins in its output |
| `styled-jsx` alias pointing at resolved dir | dual-package resolution + singletons across `styled-jsx` / `styled-jsx/style` | styled-jsx ships a modern `exports` map |
| `ignoreWarnings: [/has been used, it will be mocked/]` | Next.js compiled modules use `__dirname`, which Rspack mocks in browser builds | never (quality-of-life filter) |

**When something breaks, triage in this order:** (1) `getBaseWebpackConfig` signature drift — extend `buildWebpackConfigParams`, don't leak version checks elsewhere; (2) `next/dist/*` path renames — one edit in `next-internals.ts` or `utils/next-config.ts`; (3) new DOM expectations from Next.js runtime — check `next/dist/pages/_document.js`, add a shim in `preview.tsx`.

## Upstream Sync Workflow

Runtime decorators (`preview.tsx`, `routing/`, `head-manager/`, `images/`, `styled-jsx/`, `export-mocks/`) are bundler-agnostic React components ported from `@storybook/nextjs-vite`. Each sourced file carries a marker on the first line:

- `// Port: <upstream-path>` — near-verbatim copy; only mechanical rewrites (imports, semicolons) differ.
- `// Adapted from <upstream-path>` — shape/pattern kept, but enough logic differs that a straight `diff` won't be useful.

The sync index is a single grep:

```
grep -rnE "^(// |\s+\* )(Port|Adapted from):? @storybook/" src/ loaders/
```

Port sources in this package:

| Where we sourced from | How many files |
|---|---|
| `@storybook/nextjs-vite/src/**` | 19 files (runtime decorators, export-mocks, types, entrypoints) |
| `@storybook/nextjs/src/images/**` | `loaders/next-image-mock.js` (merges `next-image.tsx` + `next-image-default-loader.tsx`; nextjs-vite has no direct equivalent) |

Syncing a change: run the grep, diff against upstream, apply the meaningful change, keep the marker pointing to the same upstream path. Expected local-only diffs: semicolons removed (Biome); shared `next/dist/*` imports rewired through `src/next-internals.ts` (the one place build-time and runtime `next/dist/*` paths are centralized); singleton mocks imported via package name `storybook-next-rsbuild/*` (module identity matters — `export *` re-exports must keep direct paths).

## Known Operational Quirks

- **Injected dep sync**: `storybook-builder-rsbuild` is consumed via `dependenciesMeta.injected: true` because this package pins `@rsbuild/core@1.x` while siblings use `2.x`. After rebuilding the builder, you **must** run `pnpm install` at the repo root to re-sync the injected artifact; `pnpm build` alone won't propagate.
- **`next-rspack` phantom dep**: Next.js internally `require('next-rspack/rspack-core')` without declaring it. The monorepo's `pnpm-workspace.yaml` adds `next-rspack` to `hoistPattern` so the resolver finds it.

## References

- Upstream `@storybook/nextjs-vite`: https://github.com/storybookjs/storybook/tree/next/code/frameworks/nextjs-vite
- Upstream `@storybook/nextjs` (webpack, for comparison): https://github.com/storybookjs/storybook/tree/next/code/frameworks/nextjs
- `next-rspack`: https://github.com/vercel/next.js/tree/canary/packages/next-rspack
- Rsbuild `CHAIN_ID`: https://rsbuild.rs/plugins/dev/#chain-id

## Testing & Sandboxes

- Sandbox: `sandboxes/nextjs`. Run `pnpm --filter @sandboxes/nextjs storybook` to start Storybook against the bridged config, or `pnpm --filter @sandboxes/nextjs dev` to run the underlying Next.js app on its own (useful for confirming the base project builds before debugging Storybook issues).
- E2E: `pnpm e2e nextjs.spec.ts` (add stories to sandbox when introducing a new feature).
- When porting a change from upstream `nextjs-vite`, verify both App Router (stories using `next/navigation`) and Pages Router (stories using `next/router`) code paths still render.
