import { dirname, isAbsolute, join, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mergeRsbuildConfig } from '@rsbuild/core'
import { logger } from 'storybook/internal/node-logger'
import type { PresetProperty } from 'storybook/internal/types'
import type { FrameworkOptions, StorybookConfig } from './types'
import { checkRspackInvariant } from './utils/check-rspack-invariant'
import { extractNextRspackConfig, getNextVersion } from './utils/next-config'
import {
  buildNextLoaderChain,
  dedupProvidePluginKeys,
  type FallbackMap,
  filterNextAliases,
  filterNextPlugins,
  makeBarrelRule,
  makeFontRule,
  mergeFallback,
  NODE_BUILTINS_FALLBACK,
  replaceSwcRules,
  resolveNodeProtocolRequest,
  ruleTestSignature,
  TARGET_CSS_RE,
  withRuntimeUrlFilter,
} from './utils/preset-helpers'

const resolve = (id: string) => fileURLToPath(import.meta.resolve(id))

const BUILDER_PATH = resolve('storybook-builder-rsbuild')
const RENDERER_PATH = resolve('@storybook/react/preset')
const PREVIEW_PATH = resolve('storybook-next-rsbuild/preview')
const LEGACY_PREVIEW_PATH = resolve('storybook-next-rsbuild/config/preview')
const NEXT_IMAGE_MOCK = resolve('storybook-next-rsbuild/next-image-mock')
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

function getStorybookOverrideAliases() {
  return {
    'next/image$': NEXT_IMAGE_MOCK,
    'styled-jsx': STYLED_JSX_DIR,
    'styled-jsx/style': join(STYLED_JSX_DIR, 'style'),
    'styled-jsx/style.js': join(STYLED_JSX_DIR, 'style'),
  }
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

  const { nextConfigPath, forwardNextConfigPlugins = false } =
    await options.presets.apply<FrameworkOptions>('frameworkOptions')

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
    { dev: isDev },
  )

  // Layering: Next.js base aliases (filtered) → Storybook overrides
  // (next/image, styled-jsx) → user delta. User aliases win over Next.js,
  // but `filterNextAliases` runs on the BASE only, so the React/RSC singletons
  // we strip there cannot be re-introduced via the user delta path either.
  // If user delta carries `react`/`react-dom` we drop them with a warn so the
  // React identity invariant (AGENTS.md) stays intact.
  const userAliasDelta = filterNextAliases(extraction.userDelta.alias)
  for (const k of Object.keys(extraction.userDelta.alias)) {
    if (!(k in userAliasDelta)) {
      logger.warn(
        `next.config.webpack() set resolve.alias["${k}"]; ignoring to preserve ` +
          'Storybook React singleton.',
      )
    }
  }
  const allAliases: Record<string, string | string[] | false> = {
    ...filterNextAliases(extraction.alias),
    ...getStorybookOverrideAliases(),
    ...userAliasDelta,
  }

  const nextLoaderChain = buildNextLoaderChain(extraction.rawRules, SWC_SHIM)
  if (nextLoaderChain) {
    logger.info('Using Next.js SWC loader for JS/TS compilation')
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

        // See `dedupProvidePluginKeys` doc — Rsbuild's pre-registered
        // ProvidePlugin already covers `process`; we strip overlapping keys
        // from Next.js's instance so only the additive entries (notably
        // `Buffer`, which `next-auth` / `openid-client` rely on) remain.
        const dedupedNextPlugins = dedupProvidePluginKeys(
          rspackConfig.plugins,
          nextPlugins,
        )
        rspackConfig.plugins.push(
          new NoopTraceSpanPlugin(),
          ...dedupedNextPlugins,
        )
        if (nextLoaderChain && isDev) {
          rspackConfig.plugins.push(new ReactRefreshInitPlugin(REFRESH_ENTRY))
        }

        rspackConfig.plugins.push(new StripNodeProtocolPlugin())

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
          if (forwardNextConfigPlugins) {
            rspackConfig.plugins.push(...userDelta.plugins)
          } else {
            const names = userDelta.plugins
              .map((p: any) => p?.constructor?.name || typeof p)
              .join(', ')
            logger.info(
              `Dropping ${userDelta.plugins.length} next.config.webpack() plugin(s) ` +
                `[${names}]. Most webpack-only plugins (CopyPlugin, source-map ` +
                `uploaders, stats writers) crash rspack's IPC channel during ` +
                `processAssets. Set framework option ` +
                `\`forwardNextConfigPlugins: true\` to opt in.`,
            )
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

        // Invoke user `.storybook/main.*` `webpackFinal` against the assembled
        // rspack config. `storybook-builder-rsbuild` only chains `webpackFinal`
        // from presets registered under `webpackAddons`; top-level main-config
        // hooks would otherwise silently disappear. We run it here, AFTER the
        // Next.js delta has been applied, so user code that introspects/mutates
        // existing rules (e.g. `imageRule.exclude = /\.svg$/` to take SVGs
        // away from the asset-image loader before adding @svgr/webpack) sees
        // the same rule set that will actually ship — empty-config probing
        // would render those mutations no-ops.
        const rulesSnapshotBeforeUserFinal = new Set(rspackConfig.module.rules)
        const userWebpackResult: any = await options.presets.apply(
          'webpackFinal',
          rspackConfig,
          options,
        )
        if (userWebpackResult && userWebpackResult !== rspackConfig) {
          // User returned a fresh object. Field-merge instead of wholesale
          // `Object.assign`: a blanket overwrite would replace
          // `rspackConfig.module` and lose the Next.js CSS rules we unshifted
          // above. Most main-config webpackFinal hooks mutate-and-return; the
          // fresh-object path here protects the few that build a new config
          // from scratch.
          for (const key of Object.keys(userWebpackResult)) {
            if (key === 'module') {
              rspackConfig.module = {
                ...rspackConfig.module,
                ...userWebpackResult.module,
                rules:
                  userWebpackResult.module?.rules ?? rspackConfig.module.rules,
              }
            } else if (
              key === 'plugins' &&
              Array.isArray(userWebpackResult.plugins)
            ) {
              rspackConfig.plugins = userWebpackResult.plugins
            } else {
              ;(rspackConfig as any)[key] = userWebpackResult[key]
            }
          }
        }

        // Narrow dedup: when the user's `.storybook/main.* webpackFinal` adds
        // a rule whose `test` matches one that came in via the
        // `next.config.webpack` delta, drop the next.config one. Without
        // this, two passes of @svgr against the same .svg produce a
        // SvgoParserError. Dedup only spans (next.config delta) ↔ (storybook
        // webpackFinal additions); Next.js/Rsbuild CSS rules that
        // legitimately share `/\.css$/` (e.g. via `oneOf` branches) stay
        // untouched. `ruleTestSignature` returns `null` for non-RegExp tests
        // so `{ and: [...] }` / `{ or: [...] }` shapes never cross-match.
        const userFinalAddedTests = new Set<string>()
        for (const r of rspackConfig.module.rules as any[]) {
          if (rulesSnapshotBeforeUserFinal.has(r)) continue
          const sig = ruleTestSignature(r)
          if (sig) userFinalAddedTests.add(sig)
        }
        if (userFinalAddedTests.size > 0 && nextConfigDeltaRules.size > 0) {
          rspackConfig.module.rules = (
            rspackConfig.module.rules as any[]
          ).filter((r: any) => {
            if (!nextConfigDeltaRules.has(r)) return true
            const sig = ruleTestSignature(r)
            if (sig && userFinalAddedTests.has(sig)) {
              logger.info(
                `Dropping next.config.webpack rule for ${sig} — superseded by .storybook/main webpackFinal rule.`,
              )
              return false
            }
            return true
          })
        }

        return rspackConfig
      },
    },
  })
}
