import { builtinModules } from 'node:module'
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
  filterNextAliases,
  filterNextPlugins,
  prepareNextCssRules,
  replaceSwcRules,
  sanitizeReactRefreshForProd,
} from './utils/preset-helpers'

const resolve = (id: string) => fileURLToPath(import.meta.resolve(id))

const BUILDER_PATH = resolve('storybook-builder-rsbuild')
const RENDERER_PATH = resolve('@storybook/react/preset')
const PREVIEW_PATH = resolve('storybook-next-rsbuild/preview')
const LEGACY_PREVIEW_PATH = resolve('storybook-next-rsbuild/config/preview')
const NEXT_IMAGE_MOCK = resolve('storybook-next-rsbuild/next-image-mock')
const SWC_SHIM = resolve('storybook-next-rsbuild/swc-loader-shim')
const REFRESH_ENTRY = resolve('storybook-next-rsbuild/react-refresh-entry')
const FONT_URL_REWRITE = resolve('storybook-next-rsbuild/next-font-url-rewrite')
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

/**
 * Node.js builtins floor — merged *under* Next.js's `resolve.fallback`, so
 * Next.js-supplied polyfills (e.g. `process`) still win.
 *
 * Sourced from `node:module`'s `builtinModules` so every builtin is covered
 * (`querystring`, `punycode`, `url`, `events`, ...). A hand-written allowlist
 * inevitably drifts behind Node releases and creates "module not found" errors
 * for transitive deps that import obscure builtins.
 */
const NODE_BUILTINS_FALLBACK: Record<string, false> = Object.fromEntries(
  builtinModules.flatMap((m) => [
    [m, false as const],
    [`node:${m}`, false as const],
  ]),
)

/**
 * Aliases for `node:`-protocol builtins. Rsbuild ships a pre-resolve guard
 * that errors on bare `node:*` requests *before* webpack's `resolve.fallback`
 * fires, so `fallback` alone can't suppress the build error. Mapping each
 * `node:foo` to `false` via `resolve.alias` short-circuits resolution at the
 * point Rsbuild checks. The non-prefixed forms stay in `fallback` only —
 * adding them to alias would also intercept legitimate `import { ... } from 'fs'`
 * before webpack's fallback layer has a chance to provide a polyfill (e.g.
 * Next.js's `buffer`, `process`, `stream-browserify`).
 */
const NODE_PROTOCOL_ALIAS: Record<string, false> = Object.fromEntries(
  builtinModules.map((m) => [`node:${m}`, false as const]),
)

/**
 * Suppresses all `node:`-prefixed imports in the browser bundle.
 *
 * Rspack hard-errors on bare `node:foo` with "need an additional plugin to
 * handle 'node:' URIs". The check fires at module-build stage, *after* both
 * `resolve.alias` and `resolve.fallback`, so neither layer alone suppresses
 * it.
 *
 * Stripping the prefix (NormalModuleReplacementPlugin: `node:foo` → `foo`)
 * works for builtins listed in `node:module.builtinModules`, but newer
 * deps (e.g. undici importing `node:sqlite`, Node 22.5+ only) reach modules
 * that *aren't* in builtinModules on older Node releases — the strip then
 * surfaces a "Can't resolve 'sqlite'" error.
 *
 * The Storybook preview is a browser bundle, so any `node:*` import is dead
 * code by definition. `IgnorePlugin` replaces them with empty modules,
 * matching the webpack idiom for "blocked imports."
 *
 * `compiler.webpack.IgnorePlugin` is the version-stable way to reach the
 * rspack class without importing `@rspack/core` directly (framework-next
 * doesn't declare it as a dep).
 */
class IgnoreNodeProtocolPlugin {
  apply(compiler: any) {
    const IgnorePlugin = compiler.webpack?.IgnorePlugin
    if (!IgnorePlugin) return
    new IgnorePlugin({ resourceRegExp: /^node:/ }).apply(compiler)
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

  const extraction = await extractNextRspackConfig(
    resolvedNextConfigPath ? dirname(resolvedNextConfigPath) : undefined,
  )

  // Storybook builds in two modes: dev server (`storybook dev`) and static
  // build (`build-storybook`). Next.js's `getBaseWebpackConfig()` is always
  // invoked in dev mode by `extractNextRspackConfig` (see utils/next-config.ts),
  // so its output carries dev-only artefacts (React Refresh plugin/loader,
  // `process.env.NODE_ENV: "development"` define, `next-swc-loader.dev=true`).
  // We strip those when Storybook is building for production, otherwise the
  // resulting bundle is broken (`$RefreshSig$` ReferenceError) and ships React's
  // dev path.
  const isDev = options.configType !== 'PRODUCTION'

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
    ...NODE_PROTOCOL_ALIAS,
    ...filterNextAliases(extraction.alias),
    ...getStorybookOverrideAliases(),
    ...userAliasDelta,
  }

  const nextLoaderChain = buildNextLoaderChain(extraction.rawRules, SWC_SHIM, {
    isDev,
  })
  if (nextLoaderChain) {
    logger.info('Using Next.js SWC loader for JS/TS compilation')
  }

  const nextPlugins = filterNextPlugins(extraction.rawPlugins, { isDev })

  const nextCssRules = prepareNextCssRules(
    extraction.rawRules,
    FONT_URL_REWRITE,
  )
  if (nextCssRules.length > 0) {
    logger.info(
      `Using Next.js CSS pipeline (${nextCssRules.length} rules injected)`,
    )
  }

  // `process.env.NODE_ENV` is extracted from Next.js's dev DefinePlugin and
  // would override Rsbuild's correct prod value. Drop it in prod and let
  // Rsbuild's own define provide the canonical value.
  const nextDefines: Record<string, string> = { ...extraction.defines }
  if (!isDev) delete nextDefines['process.env.NODE_ENV']

  return mergeRsbuildConfig(config, {
    source: {
      define: nextDefines,
    },
    resolve: {
      alias: allAliases,
    },
    tools: {
      /**
       * Strip Rsbuild's CSS pipeline only when we have Next.js's CSS rules to
       * replace it — otherwise (e.g. when bridge extraction fails and falls
       * back to `EMPTY_EXTRACTION`) we'd leave Storybook with no CSS handling
       * at all, breaking even plain `.css` imports. Running both is not an
       * option: it double-extracts and breaks `next/font` target.css.
       * `CHAIN_ID` isn't exported from `@rsbuild/core`'s public entry, so this
       * hook is the only stable access.
       */
      bundlerChain: (chain, { CHAIN_ID }) => {
        if (nextCssRules.length === 0) return
        if (chain.module.rules.has(CHAIN_ID.RULE.CSS)) {
          chain.module.rules.delete(CHAIN_ID.RULE.CSS)
        }
        if (chain.plugins.has(CHAIN_ID.PLUGIN.MINI_CSS_EXTRACT)) {
          chain.plugins.delete(CHAIN_ID.PLUGIN.MINI_CSS_EXTRACT)
        }
      },
      rspack: async (rspackConfig) => {
        rspackConfig.resolve ??= {}
        rspackConfig.module ??= {}
        rspackConfig.module.rules ??= []
        rspackConfig.plugins ??= []
        rspackConfig.ignoreWarnings ??= []

        // Fallback precedence: user delta (from next.config.webpack) > rsbuild
        // user (via tools.rspack) > Next.js polyfills > our builtin floor.
        // The user delta wins over Rsbuild's own `tools.rspack` fallback only
        // when the same key is set in both — that mirrors what would happen
        // inside Next.js itself, since the user `webpack()` hook runs last.
        // Fallback merge — order matters:
        //   1. Our builtin floor (every Node builtin → false)
        //   2. Rsbuild's defaults / user `tools.rspack` overrides
        //   3. Next.js's polyfills (only for keys still at `false` or unset) —
        //      Rsbuild defaults `fs`/`stream`/`assert`/... to `false` even on
        //      the browser build, which would suppress Next.js's polyfills
        //      (`stream-browserify`, `buffer`, `util`) and break libs like
        //      Victory that import `readable-stream`. Letting Next.js win over
        //      a `false` is restorative, not destructive: Rsbuild's `false`
        //      means "no opinion" for builtins, while a user-supplied non-false
        //      entry is real intent we must preserve.
        //   4. User `next.config.webpack` delta has the final word.
        // Rspack types `fallback` values as `string | string[] | false |
        // (string | false)[]`; we narrow back to the webpack-classic shape
        // because every entry we put in is either a literal `false` or a
        // resolved string. The `(string | false)[]` variant only appears in
        // user-supplied configs we don't construct.
        const fallback: Record<
          string,
          string | string[] | false | (string | false)[]
        > = {
          ...NODE_BUILTINS_FALLBACK,
          ...rspackConfig.resolve.fallback,
        }
        for (const [k, v] of Object.entries(extraction.fallback)) {
          if (fallback[k] === false || fallback[k] === undefined) {
            fallback[k] = v
          }
        }
        Object.assign(fallback, extraction.userDelta.fallback)
        rspackConfig.resolve.fallback = fallback
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
        // Unshift so Next.js's specific matchers (e.g. `next/font/google/target.css`)
        // beat any generic file rules remaining in the chain.
        if (nextCssRules.length > 0) {
          rspackConfig.module.rules.unshift(...nextCssRules)
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

        rspackConfig.plugins.push(new IgnoreNodeProtocolPlugin())

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
        // untouched.
        //
        // Signature is `RegExp.toString()` — only RegExp `test` values are
        // dedup-comparable. `{ and: [...] }` / `{ or: [...] }` shapes
        // collapse to `[object Object]` and would cross-match unrelated
        // rules, so we skip them.
        const ruleTestSignature = (r: any): string | null =>
          r?.test instanceof RegExp ? r.test.toString() : null
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

        // Run prod sanitization LAST so it covers every rule introduced
        // above — Rsbuild's, replaceSwcRules' shim chain, Next.js CSS rule's
        // `oneOf` (which embeds `__barrel_optimize__` branches with raw
        // `next-swc-loader`), Next.js plugins, AND any user-delta rules.
        // Running this earlier misses the unshift'd CSS-block barrel rules
        // and leaks `$ReactRefreshRuntime$.refresh(...)` into prod bundles.
        if (!isDev) {
          // `rspackConfig.module.rules` was defaulted to `[]` at the top of
          // this `tools.rspack` handler; the union type still reports
          // `RuleSetRules | undefined`.
          sanitizeReactRefreshForProd(rspackConfig.module.rules as any[])
        }

        return rspackConfig
      },
    },
  })
}
