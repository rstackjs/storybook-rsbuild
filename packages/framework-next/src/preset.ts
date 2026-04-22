import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mergeRsbuildConfig } from '@rsbuild/core'
import { logger } from 'storybook/internal/node-logger'
import type { PresetProperty } from 'storybook/internal/types'
import type { FrameworkOptions, StorybookConfig } from './types'
import { extractNextRspackConfig, getNextVersion } from './utils/next-config'

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

function filterNextAliases(
  alias: Record<string, string | string[] | false>,
): Record<string, string | string[] | false> {
  const blocked = ['react', 'react-dom', 'react-server-dom-webpack']
  const filtered: Record<string, string | string[] | false> = {}
  for (const [key, value] of Object.entries(alias)) {
    if (blocked.some((b) => key === b || key.startsWith(`${b}/`))) continue
    filtered[key] = value
  }
  return filtered
}

function loaderNameOf(use: any): string | null {
  if (typeof use === 'string') return use
  if (typeof use === 'object' && use !== null) return use.loader ?? null
  return null
}

function asUseArray(use: any): any[] {
  if (!use) return []
  return Array.isArray(use) ? use : [use]
}

function walkRules(rules: any[] | undefined, fn: (rule: any) => void): void {
  if (!rules) return
  for (const rule of rules) {
    if (!rule || typeof rule !== 'object') continue
    fn(rule)
    if (rule.oneOf) walkRules(rule.oneOf, fn)
    if (Array.isArray(rule.rules)) walkRules(rule.rules, fn)
  }
}

/**
 * Build a Storybook loader chain from Next.js's client JS rule:
 * keep `builtin:react-refresh-loader`, swap `next-swc-loader` for our shim
 * (strips `pitch` that breaks virtual modules), drop server-only `next-flight-*`.
 */
function buildNextLoaderChain(rawRules: any[], shimPath: string): any[] | null {
  let clientRule: any = null
  walkRules(rawRules, (rule) => {
    if (clientRule) return
    const names = asUseArray(rule.use).map(loaderNameOf)
    if (
      names.includes('builtin:react-refresh-loader') &&
      names.includes('next-swc-loader')
    ) {
      clientRule = rule
    }
  })
  if (!clientRule) return null

  return asUseArray(clientRule.use).flatMap((use) => {
    const name = loaderNameOf(use)
    if (name === 'next-swc-loader' || name?.endsWith('/next-swc-loader')) {
      return [{ loader: shimPath, options: use.options || {} }]
    }
    if (name?.includes('next-flight')) return []
    return [use]
  })
}

function replaceSwcRules(rules: any[], nextChain: any[]): boolean {
  let replaced = false
  walkRules(rules, (rule) => {
    if (!rule.use) return
    let mutated = false
    const next = asUseArray(rule.use).flatMap((use) => {
      if (loaderNameOf(use) !== 'builtin:swc-loader') return [use]
      mutated = true
      return nextChain
    })
    if (mutated) {
      rule.use = next
      replaced = true
    }
  })
  return replaced
}

/**
 * Allowlist of Next.js plugins to inject into Storybook. Allowlist (not
 * denylist) because Next.js adds/renames plugins across versions and an
 * unknown new plugin may write to disk, throw, or pollute the bundle.
 * - `CssExtractRspackPlugin`: drives the CSS pipeline; required for `next/font` target.css
 * - `ReactRefreshRspackPlugin`: provides `$ReactRefreshRuntime$` via ProvidePlugin
 *   (complements our `ReactRefreshInitPlugin` which handles the `injectIntoGlobalHook` bootstrap)
 */
const KEEP_PLUGIN_NAMES = new Set([
  'CssExtractRspackPlugin',
  'ReactRefreshRspackPlugin',
])

function filterNextPlugins(rawPlugins: any[]): any[] {
  return rawPlugins.filter((plugin) => {
    const name = plugin?.constructor?.name
    return !!name && KEEP_PLUGIN_NAMES.has(name)
  })
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

const CSS_LOADER_MARKERS = [
  'css-loader',
  'postcss-loader',
  'lightningcss-loader',
  'sass-loader',
  'less-loader',
  'resolve-url-loader',
  'next-font-loader',
  'next-flight-css-loader',
  'next-style-loader',
  'mini-css-extract',
  'CssExtract',
]

const CSS_TEST_RE = /\.(css|s[ac]ss|less|styl)|target\.css/

function isCssLoaderUse(use: any): boolean {
  const name = loaderNameOf(use)
  return !!name && CSS_LOADER_MARKERS.some((m) => name.includes(m))
}

function isNextFontLoader(use: any): boolean {
  const name = loaderNameOf(use)
  return name === 'next-font-loader' || !!name?.endsWith('/next-font-loader')
}

function isCssRule(rule: any): boolean {
  if (!rule || typeof rule !== 'object') return false

  if (isCssLoaderUse(rule) || asUseArray(rule.use).some(isCssLoaderUse)) {
    return true
  }
  if (rule.oneOf?.some(isCssRule)) return true
  if (rule.rules?.some(isCssRule)) return true

  if (rule.test) {
    const patterns = Array.isArray(rule.test) ? rule.test : [rule.test]
    const source = patterns
      .map((t: any) => (t instanceof RegExp ? t.source : String(t)))
      .join('|')
    if (CSS_TEST_RE.test(source)) return true
  }

  return false
}

/**
 * Extract Next.js CSS rules and splice our URL-rewrite loader before every
 * `next-font-loader`. Why the rewriter: `next-font-loader` emits CSS with
 * `url(/_next/static/media/[hash])` but writes binaries to `static/media/`,
 * relying on a Next.js dev-server alias we don't have. See
 * `loaders/next-font-url-rewrite.cjs`. Spliced *before* next-font-loader so
 * it runs *after* it (loaders apply right-to-left).
 */
function prepareNextCssRules(rawRules: any[], rewriterPath: string): any[] {
  const rules = rawRules.filter(isCssRule)
  walkRules(rules, (rule) => {
    if (!rule.use) return
    const uses = asUseArray(rule.use)
    const fontIdx = uses.findIndex(isNextFontLoader)
    if (fontIdx < 0) return
    uses.splice(fontIdx, 0, { loader: rewriterPath })
    rule.use = uses
  })
  return rules
}

/**
 * Node.js builtins floor — merged *under* Next.js's `resolve.fallback`, so
 * Next.js-supplied polyfills (e.g. `process`) still win.
 */
const NODE_BUILTINS_FALLBACK: Record<string, false> = Object.fromEntries(
  [
    'fs',
    'zlib',
    'stream',
    'path',
    'crypto',
    'os',
    'http',
    'https',
    'net',
    'tls',
    'child_process',
    'dns',
    'tty',
    'module',
    'async_hooks',
    'perf_hooks',
    'worker_threads',
  ].map((m) => [m, false as const]),
)

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
  const { nextConfigPath } =
    await options.presets.apply<FrameworkOptions>('frameworkOptions')

  const extraction = await extractNextRspackConfig(
    nextConfigPath ? dirname(nextConfigPath) : undefined,
  )

  const allAliases: Record<string, string | string[] | false> = {
    ...filterNextAliases(extraction.alias),
    ...getStorybookOverrideAliases(),
  }

  const nextLoaderChain = buildNextLoaderChain(extraction.rawRules, SWC_SHIM)
  if (nextLoaderChain) {
    logger.info('Using Next.js SWC loader for JS/TS compilation')
  }

  const nextPlugins = filterNextPlugins(extraction.rawPlugins)

  const nextCssRules = prepareNextCssRules(
    extraction.rawRules,
    FONT_URL_REWRITE,
  )
  if (nextCssRules.length > 0) {
    logger.info(
      `Using Next.js CSS pipeline (${nextCssRules.length} rules injected)`,
    )
  }

  return mergeRsbuildConfig(config, {
    source: {
      define: extraction.defines,
    },
    resolve: {
      alias: allAliases,
    },
    tools: {
      /**
       * Strip Rsbuild's CSS pipeline — Next.js ships its own `CssExtractRspackPlugin`
       * plus layered CSS rules; running both produces double-extraction and
       * breaks `next/font` target.css. `CHAIN_ID` isn't exported from
       * `@rsbuild/core`'s public entry, so this hook is the only stable access.
       */
      bundlerChain: (chain, { CHAIN_ID }) => {
        if (chain.module.rules.has(CHAIN_ID.RULE.CSS)) {
          chain.module.rules.delete(CHAIN_ID.RULE.CSS)
        }
        if (chain.plugins.has(CHAIN_ID.PLUGIN.MINI_CSS_EXTRACT)) {
          chain.plugins.delete(CHAIN_ID.PLUGIN.MINI_CSS_EXTRACT)
        }
      },
      rspack: (rspackConfig) => {
        rspackConfig.resolve ??= {}
        rspackConfig.module ??= {}
        rspackConfig.module.rules ??= []
        rspackConfig.plugins ??= []
        rspackConfig.ignoreWarnings ??= []

        // Fallback precedence: user > Next.js polyfills > our builtin floor.
        rspackConfig.resolve.fallback = {
          ...NODE_BUILTINS_FALLBACK,
          ...extraction.fallback,
          ...rspackConfig.resolve.fallback,
        }
        if (extraction.resolveLoader) {
          // Field-level merge: scalars follow "Next.js wins" (last spread), but
          // `modules` concatenate and `alias` unions so user-supplied loader
          // search paths / aliases from `tools.rspack` aren't silently dropped.
          const userRL = rspackConfig.resolveLoader ?? {}
          const nextRL = extraction.resolveLoader
          rspackConfig.resolveLoader = {
            ...userRL,
            ...nextRL,
            modules: [...(nextRL.modules ?? []), ...(userRL.modules ?? [])],
            alias: {
              ...(userRL.alias ?? {}),
              ...(nextRL.alias ?? {}),
            },
          }
        }
        // Next.js compiled modules use __dirname, mocked in browser builds.
        rspackConfig.ignoreWarnings.push(/has been used, it will be mocked/)

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

        rspackConfig.plugins.push(new NoopTraceSpanPlugin(), ...nextPlugins)
        if (nextLoaderChain) {
          rspackConfig.plugins.push(new ReactRefreshInitPlugin(REFRESH_ENTRY))
        }
      },
    },
  })
}
