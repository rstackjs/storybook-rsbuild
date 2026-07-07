import { dirname, isAbsolute, join, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mergeRsbuildConfig } from '@rsbuild/core'
import { logger } from 'storybook/internal/node-logger'
import type { PresetProperty } from 'storybook/internal/types'
import { applyWebpackAddonsWebpackFinal } from 'storybook-builder-rsbuild'
import type { FrameworkOptions, StorybookConfig } from './types'
import { checkRspackInvariant } from './utils/check-rspack-invariant'
import { extractNextRspackConfig, getNextVersion } from './utils/next-config'
import {
  analyzeNextLoaderChain,
  buildAliasLayers,
  buildNextLoaderChain,
  dedupProvidePluginKeys,
  type FallbackMap,
  filterNextPlugins,
  makeBarrelRule,
  makeFontRule,
  mergeFallback,
  NODE_BUILTINS_FALLBACK,
  partitionDefinePlugins,
  replaceSwcRules,
  resolveNodeProtocolRequest,
  ruleLoaderNames,
  rulesCongruentForDedup,
  rulesHandleLess,
  rulesHandleSass,
  ruleTestSignature,
  SWC_RULE_TIERS,
  type SwcRuleTier,
  TARGET_CSS_RE,
  withRuntimeUrlFilter,
} from './utils/preset-helpers'

const resolve = (id: string) => fileURLToPath(import.meta.resolve(id))

// Rank an SWC tier by its position in `SWC_RULE_TIERS` (best → worst). Dev
// targets `refresh`, prod targets `bare`; a selected tier ranking below the
// mode's target triggers a mode-branched degradation warning. `null` (no rule)
// ranks below every tier.
const swcRuleTierRank = (tier: SwcRuleTier | null): number =>
  tier == null ? -1 : SWC_RULE_TIERS.length - SWC_RULE_TIERS.indexOf(tier)

const BUILDER_PATH = resolve('storybook-builder-rsbuild')
const RENDERER_PATH = resolve('@storybook/react/preset')
const PREVIEW_PATH = resolve('storybook-next-rsbuild/preview')
const LEGACY_PREVIEW_PATH = resolve('storybook-next-rsbuild/config/preview')
const NEXT_IMAGE_MOCK = resolve('storybook-next-rsbuild/next-image-mock')
const NEXT_LEGACY_IMAGE_MOCK = resolve(
  'storybook-next-rsbuild/next-legacy-image-mock',
)
const NEXT_IMAGE_LOADER_STUB = resolve(
  'storybook-next-rsbuild/next-image-loader-stub',
)
const SWC_SHIM = resolve('storybook-next-rsbuild/swc-loader-shim')
const REFRESH_ENTRY = resolve('storybook-next-rsbuild/react-refresh-entry')
const FONT_LOADER = resolve(
  'storybook-next-rsbuild/storybook-nextjs-font-loader',
)
const EMPTY_MODULE = resolve('storybook-next-rsbuild/empty-module')
const STYLED_JSX_DIR = dirname(resolve('styled-jsx/package.json'))

export const core: PresetProperty<'core'> = async (config, options) => {
  const framework = await options.presets.apply('framework')
  return {
    ...config,
    builder: {
      name: BUILDER_PATH,
      options:
        typeof framework === 'string' ? {} : framework.options.builder || {},
    },
    renderer: RENDERER_PATH,
  }
}

// Declare to `storybook-builder-rsbuild` that this framework runs the
// `webpackFinal` chain itself (in `rsbuildFinal`'s `tools.rspack`, against the
// fully-assembled rspack config). The builder then skips its own dummy-config
// `webpackAddons` pass, so an addon's `webpackFinal` runs exactly once. See F6.
export const webpackFinalOwnership = true

export const previewAnnotations: PresetProperty<'previewAnnotations'> = (
  entry = [],
) => {
  const annotations = [...entry, PREVIEW_PATH]

  // Next.js 16 removed `next/config` from package exports; gate the legacy annotation.
  const version = getNextVersion()
  if (version && version[0] < 16) {
    annotations.push(LEGACY_PREVIEW_PATH)
  }

  return annotations
}

// Every value is a module-load-time constant, so build the map once.
const STORYBOOK_OVERRIDE_ALIASES = {
  'next/image$': NEXT_IMAGE_MOCK,
  'next/legacy/image$': NEXT_LEGACY_IMAGE_MOCK,
  // Public-entry indirection (mirrors upstream @storybook/nextjs): the mock
  // reaches the real component through `sb-original/next/image` so it never
  // deep-imports `next/dist/*`. Not user-facing; excluded from
  // isProtectedFrameworkAliasKey / filterNextAliases by construction.
  'sb-original/next/image': resolve('next/image'),
  'styled-jsx': STYLED_JSX_DIR,
  'styled-jsx/style': join(STYLED_JSX_DIR, 'style'),
  'styled-jsx/style.js': join(STYLED_JSX_DIR, 'style'),
}

/**
 * Next.js loaders call `this.currentTraceSpan.traceChild()`, normally injected
 * by `RspackProfilingPlugin`. We can't reuse that plugin: it resolves
 * `NormalModule` via `next-rspack/rspack-core`, while Storybook's compilation
 * runs on `@rspack/core` shipped with `@rsbuild/core` — the two `NormalModule`
 * classes are distinct and the tap would never fire.
 */
const noopSpan = {
  traceChild: () => noopSpan,
  traceFn: <T>(fn: () => T): T => fn(),
  traceAsyncFn: async <T>(fn: () => Promise<T>): Promise<T> => fn(),
  setAttribute() {},
  stop() {},
}

class NoopTraceSpanPlugin {
  apply(compiler: any) {
    compiler.hooks.compilation.tap(
      'NoopTraceSpanPlugin',
      (compilation: any) => {
        const NormalModule = compiler.webpack?.NormalModule
        if (!NormalModule?.getCompilationHooks) return
        NormalModule.getCompilationHooks(compilation).loader.tap(
          'NoopTraceSpanPlugin',
          (ctx: any) => {
            ctx.currentTraceSpan ??= noopSpan
          },
        )
      },
    )
  }
}

const NODE_PROTOCOL_RE = /^node:/

/**
 * Normalizes `node:`-prefixed imports in the browser bundle by stripping the
 * scheme before resolution, mirroring upstream `@storybook/nextjs`
 * (`nodePolyfills/webpack.ts`).
 *
 * Why not `IgnorePlugin({ resourceRegExp: /^node:/ })` (the previous approach):
 * it *does* match, but it codegens a `__rspack_missing_module()` stub that
 * THROWS `Cannot find module 'node:path'` the moment the namespace is touched —
 * so a story importing `node:path` crashes at render even though the build
 * succeeds. And `resolve.fallback['node:path'] = false` doesn't help either:
 * rspack's native `node:` scheme handler runs *before* the fallback table, so
 * the scheme errors as "Unhandled scheme" first. Both verified against the
 * pinned `@rspack/core` (see `e2e/tests/nextjs.spec.ts` node: probe).
 *
 * `NormalModuleReplacementPlugin`'s callback rewrites `resource.request` ahead
 * of scheme handling, so:
 *   - `node:path` → `path`: an ordinary bare builtin, caught by the existing
 *     `NODE_BUILTINS_FALLBACK` floor (→ rspack's real empty module) or, where
 *     Next.js supplies one, its polyfill.
 *   - `node:sqlite` / `node:test` (no bare-builtin counterpart, so plain
 *     stripping would surface "Can't resolve 'sqlite'") → an empty shim, so a
 *     dead server-only import never breaks the browser build.
 *
 * `compiler.webpack.NormalModuleReplacementPlugin` reaches the rspack class
 * without importing `@rspack/core` directly (framework-next doesn't declare it).
 */
class StripNodeProtocolPlugin {
  apply(compiler: any) {
    const NormalModuleReplacementPlugin =
      compiler.webpack?.NormalModuleReplacementPlugin
    if (!NormalModuleReplacementPlugin) return
    new NormalModuleReplacementPlugin(NODE_PROTOCOL_RE, (resource: any) => {
      resource.request = resolveNodeProtocolRequest(
        resource.request,
        EMPTY_MODULE,
      )
    }).apply(compiler)
  }
}

const SASS_RE = /\.s[ac]ss(\?|$)/
const LESS_RE = /\.less(\?|$)/

// Static image extensions routed to the next-image-loader stub so `import img
// from './x.png'` yields `StaticImageData` (`{ src, height, width, blurDataURL
// }`), matching upstream `@storybook/nextjs`. Deliberately EXCLUDES `.svg`:
// user SVGR delta rules share the rules array, and claiming `.svg` here would
// break the documented SVGR flow. Mirrors upstream's two-rule (JS-issuer /
// CSS-issuer) shape (`@storybook/nextjs/src/images/webpack.ts`).
const STATIC_IMAGE_RE = /\.(png|jpe?g|gif|webp|avif|ico|bmp)$/i
const CSS_ISSUER_RE = /\.(css|scss|sass|less)$/
// Upstream's default when the asset rule's generator filename can't be read.
const STATIC_IMAGE_FILENAME = 'static/media/[path][name][ext]'

// Preflight arms, one per opt-in stylesheet flavor. Each pairs the request
// matcher with the structural rule probe and the plugin the user must wire.
const STYLE_PREFLIGHTS = [
  {
    label: 'Sass',
    re: SASS_RE,
    rulesHandle: rulesHandleSass,
    plugin: '@rsbuild/plugin-sass',
    call: 'pluginSass()',
  },
  {
    label: 'Less',
    re: LESS_RE,
    rulesHandle: rulesHandleLess,
    plugin: '@rsbuild/plugin-less',
    call: 'pluginLess()',
  },
] as const

/**
 * Preflight hint for the most common "works in `next dev`, not in Storybook"
 * surprise. Rsbuild owns the CSS pipeline here, so Sass/Less are opt-in via
 * `@rsbuild/plugin-sass` / `@rsbuild/plugin-less` — but a project that imports
 * `.scss`/`.less` and never wired the plugin only learns that from a cryptic
 * "Module parse failed" deep in the build. When a `.scss`/`.sass`/`.less`
 * request appears and no rule (including a user `.less`/`.scss` rule forwarded
 * via the next.config delta) handles it, emit one actionable warning per flavor
 * pointing at the docs.
 */
class StylePreflightPlugin {
  apply(compiler: any) {
    // Warn at most once per flavor per boot, not per request.
    const checked = new Set<string>()
    compiler.hooks.normalModuleFactory.tap(
      'StorybookStylePreflight',
      (nmf: any) => {
        nmf.hooks.beforeResolve.tap('StorybookStylePreflight', (data: any) => {
          const request = data?.request ?? ''
          for (const arm of STYLE_PREFLIGHTS) {
            if (checked.has(arm.label) || !arm.re.test(request)) continue
            // Scanned lazily so the rules array is fully assembled (the style
            // plugin registers its rule via Rsbuild's chain before this fires).
            checked.add(arm.label)
            // This is a diagnostics helper: a failure of the probe must NEVER
            // affect module resolution. Swallow any throw (a pathological rule
            // shape, etc.) so the tap only ever returns undefined.
            try {
              if (arm.rulesHandle(compiler.options?.module?.rules)) continue
              logger.warn(
                `Found a ${arm.label} import ("${request}") but no ${arm.label} ` +
                  'loader is configured. storybook-next-rsbuild delegates the CSS ' +
                  `pipeline to Rsbuild, so ${arm.label} is opt-in: install ` +
                  `\`${arm.plugin}\` and add \`${arm.call}\` via \`rsbuildFinal\` in ` +
                  '.storybook/main.ts. See ' +
                  'https://storybook.rsbuild.rs/guide/framework/next#sass--less',
              )
            } catch {
              // Probe failed — stay silent rather than break the build.
            }
          }
        })
      },
    )
  }
}

/**
 * Injects `react-refresh/runtime.injectIntoGlobalHook()` as a global entry.
 * Next.js's simplified `ReactRefreshRspackPlugin` only provides
 * `$ReactRefreshRuntime$` via ProvidePlugin — without this entry,
 * `__REACT_DEVTOOLS_GLOBAL_HOOK__` is never set up and `performReactRefresh()`
 * silently no-ops.
 */
class ReactRefreshInitPlugin {
  constructor(private entryPath: string) {}
  apply(compiler: any) {
    // `name: undefined` is rspack/webpack's "global entry" semantic — attaches
    // the bootstrap to every entry rather than a named one. Not a publicly
    // documented contract; if rspack breaks this, pass an explicit name and
    // add the entry to each Storybook chunk via compilation.addEntry.
    new compiler.webpack.EntryPlugin(compiler.context, this.entryPath, {
      name: undefined,
    }).apply(compiler)
  }
}

export const rsbuildFinal: NonNullable<
  StorybookConfig['rsbuildFinal']
> = async (config, options) => {
  checkRspackInvariant(options.configDir ?? process.cwd())

  const {
    nextConfigPath,
    forwardNextConfigPlugins = false,
    allowMissingNextBridge = false,
  } = await options.presets.apply<FrameworkOptions>('frameworkOptions')

  // Resolve `nextConfigPath` against `configDir` when relative — users commonly
  // write `../next.config.ts` in `.storybook/main.ts`, expecting it relative to
  // the Storybook config dir, not cwd.
  const resolvedNextConfigPath = nextConfigPath
    ? isAbsolute(nextConfigPath)
      ? nextConfigPath
      : resolvePath(options.configDir ?? process.cwd(), nextConfigPath)
    : undefined

  // Storybook builds in two modes: dev server (`storybook dev`) and static
  // build (`build-storybook`). We extract Next.js's config in the MATCHING mode
  // (`getBaseWebpackConfig({ dev })`), so the emitted loaders/plugins/defines
  // already reflect the target — no post-hoc stripping of React Refresh, the
  // `NODE_ENV` define, or `next-swc-loader.dev` is needed.
  const isDev = options.configType !== 'PRODUCTION'

  const extraction = await extractNextRspackConfig(
    resolvedNextConfigPath ? dirname(resolvedNextConfigPath) : undefined,
    { dev: isDev, allowMissingNextBridge },
  )

  // Layering: Storybook overrides (next/image mock, styled-jsx singleton) →
  // Next.js base aliases (filtered) → user delta. `buildAliasLayers` owns the
  // full policy (strip react/RSC from both; strip next/image + styled-jsx from
  // the user delta and silently from the base; spread overrides FIRST so
  // insertion order can't let a surviving key shadow the mock/singleton) and
  // returns the dropped user-delta keys to warn about.
  const {
    alias: allAliases,
    droppedReactKeys,
    droppedProtectedKeys,
  } = buildAliasLayers(
    extraction.alias,
    extraction.userDelta.alias,
    STORYBOOK_OVERRIDE_ALIASES,
  )
  for (const k of droppedReactKeys) {
    logger.warn(
      `next.config.webpack() set resolve.alias["${k}"]; ignoring to preserve ` +
        'Storybook React singleton.',
    )
  }
  for (const k of droppedProtectedKeys) {
    logger.warn(
      `next.config.webpack() set resolve.alias["${k}"]; ignoring to preserve ` +
        "Storybook's next/image mock / styled-jsx singleton.",
    )
  }

  const nextLoaderChain = buildNextLoaderChain(extraction.rawRules, SWC_SHIM)
  const {
    tier: swcRuleTier,
    clientIssuerLayer,
    sawBuiltinSwcLoader,
  } = analyzeNextLoaderChain(extraction.rawRules)
  if (nextLoaderChain) {
    logger.info('Using Next.js SWC loader for JS/TS compilation')
    // Dev and prod select the client rule by the same criterion, and each mode
    // has a known-good target tier: dev = `refresh` (carries the Fast Refresh
    // footer), prod = `bare` (Next.js's pages catch-all). A lower-ranked tier
    // means Next.js's emitted rules drifted and we fell back to a degraded rule.
    // `extractNextRspackConfig` already logs the null-chain case; this covers
    // "chain built, but from a degraded rule".
    const expectedTier: SwcRuleTier = isDev ? 'refresh' : 'bare'
    if (swcRuleTierRank(swcRuleTier) < swcRuleTierRank(expectedTier)) {
      if (isDev) {
        logger.warn(
          'No next-swc-loader rule paired with a react-refresh loader was found in ' +
            "Next.js's dev config; Fast Refresh will degrade to remount-on-edit " +
            '(React state is lost on save). The likely cause is Next.js renaming ' +
            "'builtin:react-refresh-loader' — see buildNextLoaderChain's loader-name " +
            'match in preset-helpers.ts.',
        )
      } else {
        const layer =
          typeof clientIssuerLayer === 'string'
            ? ` (issuerLayer '${clientIssuerLayer}')`
            : typeof clientIssuerLayer === 'function'
              ? ' (issuerLayer function)'
              : ''
        logger.warn(
          "Could not find Next.js's pages catch-all next-swc-loader rule in the " +
            `production config; selected a '${swcRuleTier}'-tier rule${layer} instead. ` +
            'This rule may target a server layer, so RSC / `server-only` ' +
            'import-validation semantics can differ from `next build` — modules that ' +
            'poison the client bundle may compile silently here. The likely cause is ' +
            "Next.js reshaping its emitted rules — see buildNextLoaderChain's rule " +
            'selection in preset-helpers.ts.',
        )
      }
    }
  } else if (extraction.rawRules.length > 0) {
    // Extraction succeeded but no shimmable next-swc-loader rule was found, so
    // Rsbuild's built-in SWC silently takes over. Name the exact break point;
    // stay silent when rawRules is empty (extractNextRspackConfig already logged
    // the loud failure for that case — double-logging would misattribute).
    logger.warn(
      "No next-swc-loader rule found in Next.js's emitted rules; falling back to " +
        "Rsbuild's built-in SWC — next/font, transpilePackages, " +
        "optimizePackageImports and 'use client' semantics will not work." +
        (sawBuiltinSwcLoader
          ? ' A `builtin:next-swc-loader` rule was seen: unset the ' +
            '`BUILTIN_SWC_LOADER` env var so Next.js emits its JS next-swc-loader.'
          : ''),
    )
  }

  const nextPlugins = filterNextPlugins(extraction.rawPlugins)

  // Rsbuild owns all real CSS (.css/.module.css/.scss/...). The only Next.js
  // CSS concern we keep is `next/font`: `next-swc` rewrites `next/font/*` calls
  // into a synthetic `target.css` module, which we hand to a dedicated loader
  // (ported from `@storybook/nextjs`) instead of pulling Next.js's whole CSS
  // rule chain. See `makeFontRule` and `loaders/storybook-nextjs-font-loader.cjs`.
  const nextFontRule = makeFontRule(FONT_LOADER)

  // `optimizePackageImports` (default-on for many libs in Next 15+, e.g.
  // lucide-react, @mui/material) makes `next-swc` rewrite barrel imports into
  // `__barrel_optimize__?names=…!=!<pkg>` requests that bypass Rsbuild's
  // `.tsx?`/`.js` rule; `makeBarrelRule` routes them through the SWC shim chain
  // so the real (often TS) barrel source compiles instead of being parsed as raw
  // JS and throwing. `null` when the Next.js bridge is unavailable.
  const nextBarrelRule = makeBarrelRule(nextLoaderChain)

  // Rsbuild owns `process.env.NODE_ENV` — it always defines the value matching
  // its build mode. Drop Next.js's copy so there's a single source of truth and
  // no duplicate-define divergence.
  const nextDefines: Record<string, string> = { ...extraction.defines }
  delete nextDefines['process.env.NODE_ENV']

  return mergeRsbuildConfig(config, {
    source: {
      define: nextDefines,
    },
    resolve: {
      alias: allAliases,
    },
    tools: {
      /**
       * Match Next.js's lenient URL handling: leave root-absolute / external
       * `url()` and `@import` targets untouched instead of resolving them as
       * modules (see `isRuntimeCssUrl`). Relative paths still resolve normally.
       */
      cssLoader: (config) => {
        config.url = withRuntimeUrlFilter(config.url)
        config.import = withRuntimeUrlFilter(config.import)
        return config
      },
      /**
       * Keep Rsbuild's CSS pipeline intact and only carve out `next/font`'s
       * synthetic `target.css`, which our dedicated font loader handles. Without
       * this exclude, css-loader would also try to process `target.css` and
       * collide with the font loader. `CHAIN_ID` isn't exported from
       * `@rsbuild/core`'s public entry, so this hook is the only stable access.
       */
      bundlerChain: (chain, { CHAIN_ID }) => {
        if (chain.module.rules.has(CHAIN_ID.RULE.CSS)) {
          chain.module.rule(CHAIN_ID.RULE.CSS).exclude.add(TARGET_CSS_RE)
        }
        // Take the static-image extensions away from Rsbuild's default asset
        // rule (which yields bare URL strings) so the next-image-loader stub
        // rules added in `tools.rspack` own them and produce `StaticImageData`.
        if (chain.module.rules.has(CHAIN_ID.RULE.IMAGE)) {
          chain.module.rule(CHAIN_ID.RULE.IMAGE).exclude.add(STATIC_IMAGE_RE)
        }
      },
      rspack: async (rspackConfig) => {
        rspackConfig.resolve ??= {}
        rspackConfig.module ??= {}
        rspackConfig.module.rules ??= []
        rspackConfig.plugins ??= []
        rspackConfig.ignoreWarnings ??= []

        // Layer resolve.fallback: builtin floor → Rsbuild/user-tools.rspack →
        // Next.js polyfills (only over `false`/unset) → next.config.webpack
        // delta (final word). See `mergeFallback` for the full precedence
        // rationale (notably why Next.js's `stream-browserify` must win over
        // Rsbuild's `stream: false` so libs like Victory keep working).
        rspackConfig.resolve.fallback = mergeFallback(
          NODE_BUILTINS_FALLBACK,
          // rspack types `fallback` loosely (per-key boolean); we only ever read
          // string/false entries from it, so narrow to the webpack-classic shape.
          rspackConfig.resolve.fallback as FallbackMap | undefined,
          extraction.fallback,
          extraction.userDelta.fallback,
        )
        if (extraction.resolveLoader) {
          // Field-level merge: scalars follow "Next.js wins" (last spread), but
          // `modules` concatenate and `alias` unions so user-supplied loader
          // search paths / aliases from `tools.rspack` aren't silently dropped.
          // Always include the consumer project's `node_modules` so loaders
          // declared via bare specifier in `next.config.webpack()` rules
          // (e.g. `@svgr/webpack`) resolve from the user's install, not from
          // Next.js's vendored loader path.
          const userRL = rspackConfig.resolveLoader ?? {}
          const nextRL = extraction.resolveLoader
          const cwdNodeModules = resolvePath(
            options.configDir ?? process.cwd(),
            '../node_modules',
          )
          const fallbackModules = ['node_modules', cwdNodeModules]
          rspackConfig.resolveLoader = {
            ...userRL,
            ...nextRL,
            modules: [
              ...(nextRL.modules ?? []),
              ...(userRL.modules ?? []),
              ...fallbackModules.filter(
                (m) =>
                  !(nextRL.modules ?? []).includes(m) &&
                  !(userRL.modules ?? []).includes(m),
              ),
            ],
            alias: {
              ...(userRL.alias ?? {}),
              ...(nextRL.alias ?? {}),
            },
          }
        }
        // Next.js compiled modules use __dirname, mocked in browser builds.
        // Wording differs across rspack versions — match both.
        rspackConfig.ignoreWarnings.push(
          /(has been used, it will be mocked|is used and has been mocked)/,
        )

        if (
          nextLoaderChain &&
          !replaceSwcRules(rspackConfig.module.rules, nextLoaderChain)
        ) {
          logger.warn(
            'Could not find builtin:swc-loader rules to replace. ' +
              'Next.js SWC integration may not work correctly.',
          )
        }
        // Unshift so the `target.css` matcher beats any generic `.css` rule
        // still in the chain. Harmless when no `next/font` is used — the rule
        // only matches the synthetic `…/next/font/*/target.css` module.
        rspackConfig.module.rules.unshift(nextFontRule)
        if (nextBarrelRule) {
          rspackConfig.module.rules.unshift(nextBarrelRule)
        }

        // Static image imports → `StaticImageData`. Two rules mirroring upstream
        // `@storybook/nextjs`: a JS-issuer rule runs the stub loader (emits the
        // file + returns `{ src, height, width, blurDataURL }`), while a
        // CSS-issuer rule keeps `url()` references resolving to plain asset URLs.
        // These extensions are excluded from Rsbuild's default asset rule in
        // `tools.bundlerChain` above so the stub owns them.
        rspackConfig.module.rules.push(
          {
            test: STATIC_IMAGE_RE,
            issuer: { not: CSS_ISSUER_RE },
            use: [
              {
                loader: NEXT_IMAGE_LOADER_STUB,
                options: {
                  filename: STATIC_IMAGE_FILENAME,
                  disableStaticImages: extraction.imagesDisableStaticImports,
                },
              },
            ],
          },
          {
            test: STATIC_IMAGE_RE,
            issuer: CSS_ISSUER_RE,
            type: 'asset/resource',
            generator: { filename: STATIC_IMAGE_FILENAME },
          },
        )

        // See `dedupProvidePluginKeys` doc — Rsbuild's pre-registered
        // ProvidePlugin already covers `process`; we strip overlapping keys
        // from Next.js's instance so only the additive entries (notably
        // `Buffer`, which `next-auth` / `openid-client` rely on) remain.
        let providePluginUnreadableWarned = false
        const dedupedNextPlugins = dedupProvidePluginKeys(
          rspackConfig.plugins,
          nextPlugins,
          (plugin, side) => {
            // Warn once per boot (not per plugin) so the internal-shape break is
            // attributable — mirrors the DefinePlugin extraction warn.
            if (providePluginUnreadableWarned) return
            providePluginUnreadableWarned = true
            logger.warn(
              `Found a ${plugin?.constructor?.name} (${side} side) but could not ` +
                'read its provide map (rspack plugin internal `_args[0]` shape may ' +
                'have changed). ProvidePlugin dedup was skipped, so rspack may ' +
                "report duplicate provide keys and Next.js's `process` entry may " +
                "shadow Rsbuild's resolved path. See storybook-next-rsbuild Shim " +
                'Catalogue.',
            )
          },
        )
        rspackConfig.plugins.push(
          new NoopTraceSpanPlugin(),
          ...dedupedNextPlugins,
        )
        if (nextLoaderChain && isDev) {
          rspackConfig.plugins.push(new ReactRefreshInitPlugin(REFRESH_ENTRY))
        }

        rspackConfig.plugins.push(
          new StripNodeProtocolPlugin(),
          new StylePreflightPlugin(),
        )

        // User delta from `next.config.webpack(config, opts)` — appended last
        // so it lands AFTER both Rsbuild's defaults and Next.js's base. Bypasses
        // the KEEP_PLUGIN_NAMES allowlist by design: user-authored plugins
        // (e.g. `SriManifestWebpackPlugin`) are user intent, not Next.js
        // implementation detail. Plugins are pushed regardless of dev/prod —
        // the user's hook receives Next.js's real `{ dev, isServer, ... }` opts
        // and gates internally if needed.
        const { userDelta } = extraction
        // Identity-track next.config.webpack delta rules so the post-
        // webpackFinal dedup below only touches them — Next.js/Rsbuild rules
        // with overlapping `test` (notably CSS `oneOf` chains that share
        // `/\.css$/`) MUST stay untouched.
        const nextConfigDeltaRules = new Set<any>(userDelta.rules)
        if (userDelta.rules.length > 0) {
          rspackConfig.module.rules.push(...userDelta.rules)
        }
        if (userDelta.plugins.length > 0) {
          // DefinePlugin definitions are already harvested wholesale into
          // `source.define` at extraction time, so their instances are bridged
          // regardless of the gate. Never re-push them (double-apply); log them
          // truthfully instead of claiming they were dropped/forwarded.
          const { definePlugins, rest } = partitionDefinePlugins(
            userDelta.plugins,
          )
          if (definePlugins.length > 0) {
            logger.info(
              `${definePlugins.length} next.config.webpack() DefinePlugin(s) ` +
                'left in place — their definitions are already bridged via ' +
                '`source.define`.',
            )
          }
          if (rest.length > 0) {
            if (forwardNextConfigPlugins) {
              rspackConfig.plugins.push(...rest)
            } else {
              const names = rest
                .map((p: any) => p?.constructor?.name || typeof p)
                .join(', ')
              logger.info(
                `Dropping ${rest.length} next.config.webpack() plugin(s) ` +
                  `[${names}]. Most webpack-only plugins (CopyPlugin, source-map ` +
                  `uploaders, stats writers) crash rspack's IPC channel during ` +
                  `processAssets. Set framework option ` +
                  `\`forwardNextConfigPlugins: true\` to opt in.`,
              )
            }
          }
        }
        if (Object.keys(userDelta.experiments).length > 0) {
          rspackConfig.experiments = {
            ...rspackConfig.experiments,
            ...userDelta.experiments,
          }
        }
        if (userDelta.externals.length > 0) {
          if (!rspackConfig.externals) {
            rspackConfig.externals = userDelta.externals
          } else if (Array.isArray(rspackConfig.externals)) {
            rspackConfig.externals.push(...userDelta.externals)
          } else {
            // Rsbuild may set externals as an object — coerce to mixed array
            // so the user-added entries (typically functions or regex maps)
            // land alongside without overriding the object form.
            rspackConfig.externals = [
              rspackConfig.externals,
              ...userDelta.externals,
            ]
          }
        }

        // Run every addon/user `webpackFinal` hook against the assembled rspack
        // config, exactly once. Because we set `webpackFinalOwnership`, the
        // builder skips its own dummy-config `webpackAddons` pass, so we own the
        // whole chain here — AFTER the Next.js delta has been applied, so user
        // code that introspects/mutates existing rules (e.g. `imageRule.exclude =
        // /\.svg$/` to take SVGs away from the asset-image loader before adding
        // @svgr/webpack) sees the same rule set that will actually ship.
        //
        // Snapshot BEFORE any apply so addon-added rules also count as
        // storybook-side additions for the dedup below.
        const rulesSnapshotBeforeUserFinal = new Set(rspackConfig.module.rules)

        // Field-merge a possibly-fresh webpackFinal result back into
        // `rspackConfig` (a blanket `Object.assign` would replace
        // `rspackConfig.module` and lose the Next.js CSS rules we unshifted).
        // Most hooks mutate-and-return; this protects the few that build a new
        // config from scratch. Applied to BOTH the webpackAddons and main-chain
        // results.
        const mergeWebpackFinalResult = (result: any) => {
          if (!result || result === rspackConfig) return
          for (const key of Object.keys(result)) {
            if (key === 'module') {
              rspackConfig.module = {
                ...rspackConfig.module,
                ...result.module,
                rules: result.module?.rules ?? rspackConfig.module.rules,
              }
            } else if (key === 'plugins' && Array.isArray(result.plugins)) {
              rspackConfig.plugins = result.plugins
            } else {
              ;(rspackConfig as any)[key] = result[key]
            }
          }
        }

        // 1. `webpackAddons`-registered presets, against the REAL config (the
        //    builder used to run these against a dummy empty base). Presets also
        //    present in the main chain (below) are skipped there to avoid a
        //    double run; `options.presetsList` enumerates the main chain when
        //    Storybook invokes this preset as a function (undefined defensively
        //    → no dedup, i.e. no worse than the historical double run).
        //    `presetsList` is a public field on Storybook's `Options` type (via
        //    `StorybookConfigOptions`), so no cast is needed to read it.
        const mainChainPresetNames = new Set<string>(
          (options.presetsList ?? [])
            .map((p: any) => p?.name)
            .filter((n: unknown): n is string => typeof n === 'string'),
        )
        const { config: afterAddons, skipped: skippedAddonPresets } =
          await applyWebpackAddonsWebpackFinal(
            options,
            rspackConfig,
            mainChainPresetNames,
          )
        mergeWebpackFinalResult(afterAddons)
        if (skippedAddonPresets.length > 0) {
          logger.warn(
            `Addon(s) listed in both \`addons\` and \`webpackAddons\` — their ` +
              `webpackFinal runs once via the main chain under this framework; ` +
              `\`webpackAddons\` is unnecessary here. Skipped duplicate ` +
              `webpackAddons run for: ${skippedAddonPresets.join(', ')}.`,
          )
        }

        // 2. Main preset chain: `addons`-registered presets' webpackFinal plus
        //    the user's `.storybook/main.*` hook (which runs LAST and can
        //    introspect addon-added rules).
        const userWebpackResult: any = await options.presets.apply(
          'webpackFinal',
          rspackConfig,
          options,
        )
        mergeWebpackFinalResult(userWebpackResult)

        // Narrow, condition-aware dedup: when the user's `.storybook/main.*
        // webpackFinal` adds a rule that would genuinely double-process the same
        // modules as a `next.config.webpack` delta rule — same `test` AND
        // identical narrowing conditions (`rulesCongruentForDedup`) — drop the
        // next.config one. Without this, two passes of @svgr against the same
        // .svg produce a SvgoParserError. But a scoped webpackFinal rule (e.g.
        // `test:/\.svg$/, resourceQuery:/raw/`) must NOT kill a differently-
        // scoped next.config rule (`test:/\.svg$/, include:/icons/`): they never
        // overlap, so we keep both and warn. Dedup only spans (next.config delta)
        // ↔ (storybook webpackFinal additions); Next.js/Rsbuild CSS `oneOf`
        // chains that share `/\.css$/` stay untouched via the identity guard.
        const userFinalAddedRules = (rspackConfig.module.rules as any[]).filter(
          (r) => !rulesSnapshotBeforeUserFinal.has(r),
        )
        if (userFinalAddedRules.length > 0 && nextConfigDeltaRules.size > 0) {
          rspackConfig.module.rules = (
            rspackConfig.module.rules as any[]
          ).filter((r: any) => {
            if (!nextConfigDeltaRules.has(r)) return true
            const sig = ruleTestSignature(r)
            // Only user rules with the SAME `test` can double-process r's
            // modules; everything else is trivially disjoint.
            const sameTest = sig
              ? userFinalAddedRules.filter((u) => ruleTestSignature(u) === sig)
              : []
            const congruentUser = sameTest.find((u) =>
              rulesCongruentForDedup(r, u),
            )
            if (congruentUser) {
              logger.warn(
                `Dropping next.config.webpack rule for ${sig} ` +
                  `[${ruleLoaderNames(r)}] — superseded by a congruent ` +
                  `.storybook/main webpackFinal rule [${ruleLoaderNames(congruentUser)}].`,
              )
              return false
            }
            // Same `test` but non-congruent conditions → the two rules target
            // disjoint module sets; keep both. Warn since they *could* overlap
            // at runtime in ways that are statically undecidable.
            if (sameTest.length > 0) {
              logger.warn(
                `next.config.webpack rule for ${sig} and a .storybook/main ` +
                  'webpackFinal rule share the same test but differ in narrowing ' +
                  'conditions (include/exclude/issuer/resourceQuery/…); keeping ' +
                  'both. They may double-process modules if their conditions ' +
                  'overlap at runtime.',
              )
            }
            return true
          })
        }

        return rspackConfig
      },
    },
  })
}
