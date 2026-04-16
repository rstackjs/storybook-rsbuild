import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mergeRsbuildConfig } from '@rsbuild/core'
import { logger } from 'storybook/internal/node-logger'
import type { PresetProperty } from 'storybook/internal/types'
import type { FrameworkOptions, StorybookConfig } from './types'
import { extractNextRspackConfig } from './utils/next-config'

export const core: PresetProperty<'core'> = async (config, options) => {
  const framework = await options.presets.apply('framework')
  return {
    ...config,
    builder: {
      name: fileURLToPath(import.meta.resolve('storybook-builder-rsbuild')),
      options:
        typeof framework === 'string' ? {} : framework.options.builder || {},
    },
    renderer: fileURLToPath(import.meta.resolve('@storybook/react/preset')),
  }
}

export const previewAnnotations: PresetProperty<'previewAnnotations'> = (
  entry = [],
) => {
  return [
    ...entry,
    fileURLToPath(import.meta.resolve('storybook-next-rsbuild/preview')),
  ]
}

// ---------------------------------------------------------------------------
// Alias management
// ---------------------------------------------------------------------------

/**
 * Aliases that Storybook must override regardless of what Next.js sets.
 * These take precedence over the extracted Next.js aliases.
 */
function getStorybookOverrideAliases() {
  const styledJsxDir = dirname(
    fileURLToPath(import.meta.resolve('styled-jsx/package.json')),
  )

  return {
    'next/image$': fileURLToPath(
      import.meta.resolve('storybook-next-rsbuild/next-image-mock'),
    ),
    'styled-jsx': styledJsxDir,
    'styled-jsx/style': join(styledJsxDir, 'style'),
    'styled-jsx/style.js': join(styledJsxDir, 'style'),
  }
}

/**
 * Drop React-related aliases from the Next.js extraction.
 * Storybook manages its own React runtime; letting Next.js redirect
 * react/react-dom to its compiled copies would break version management.
 */
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

// ---------------------------------------------------------------------------
// Rspack rule utilities
// ---------------------------------------------------------------------------

/** Extract the loader name from a `use` entry (string or `{ loader }` object). */
function loaderNameOf(use: any): string | null {
  if (typeof use === 'string') return use
  if (typeof use === 'object' && use !== null) return use.loader ?? null
  return null
}

/** Normalize a rule's `use` field to an array (string, object, array, or absent). */
function asUseArray(use: any): any[] {
  if (!use) return []
  return Array.isArray(use) ? use : [use]
}

/** Recursively walk rspack rules, invoking `fn` on each rule node. */
function walkRules(rules: any[] | undefined, fn: (rule: any) => void): void {
  if (!rules) return
  for (const rule of rules) {
    if (!rule || typeof rule !== 'object') continue
    fn(rule)
    if (rule.oneOf) walkRules(rule.oneOf, fn)
    if (Array.isArray(rule.rules)) walkRules(rule.rules, fn)
  }
}

// ---------------------------------------------------------------------------
// Next.js loader chain extraction
// ---------------------------------------------------------------------------

/**
 * Find the client JS compilation rule from Next.js's raw rules and build
 * a Storybook-compatible loader chain from it.
 *
 * Next.js's client JS rule contains `[builtin:react-refresh-loader, next-swc-loader]`.
 * We keep `builtin:react-refresh-loader` as-is, replace `next-swc-loader`
 * with our shim (strips the `pitch` that breaks virtual modules), and filter
 * out server-only loaders (`next-flight-*`).
 *
 * @returns The loader chain array, or `null` if the client JS rule was not found.
 */
function buildNextLoaderChain(rawRules: any[], shimPath: string): any[] | null {
  // Find the rule whose `use` array contains both
  // `builtin:react-refresh-loader` and `next-swc-loader`.
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
    // Skip server component loaders — not needed in Storybook
    if (name?.includes('next-flight')) return []
    return [use]
  })
}

/**
 * Replace Rsbuild's default `builtin:swc-loader` with the Next.js loader chain.
 * Mutates the rules in place. Returns whether any replacement was made.
 */
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

// ---------------------------------------------------------------------------
// Next.js plugin filtering
// ---------------------------------------------------------------------------

/**
 * Plugin names from Next.js that must NOT be injected into Storybook.
 *
 * Grouped by reason:
 * - **Rsbuild already provides**: DefinePlugin, RspackDefinePlugin,
 *   EvalSourceMapDevToolPlugin, HotModuleReplacementPlugin, MemoryWithGcCachePlugin,
 *   ProvidePlugin, IgnorePlugin
 * - **Next.js build artifacts**: BuildManifestPlugin, NextFontManifestPlugin,
 *   CopyFilePlugin, ReactLoadablePlugin
 * - **Incompatible with Storybook's browser context**: NextExternalsPlugin
 * - **Unnecessary profiling, replaced by NoopTraceSpanPlugin**: RspackProfilingPlugin
 * - **Storybook has its own**: NextJsRequireCacheHotReloader, WellKnownErrorsPlugin
 */
const SKIP_PLUGIN_NAMES = new Set([
  'DefinePlugin',
  'RspackDefinePlugin',
  'EvalSourceMapDevToolPlugin',
  'HotModuleReplacementPlugin',
  'MemoryWithGcCachePlugin',
  'ProvidePlugin',
  'IgnorePlugin',
  'BuildManifestPlugin',
  'NextFontManifestPlugin',
  'CopyFilePlugin',
  'ReactLoadablePlugin',
  'NextExternalsPlugin',
  'RspackProfilingPlugin',
  'NextJsRequireCacheHotReloader',
  'WellKnownErrorsPlugin',
])

function filterNextPlugins(rawPlugins: any[]): any[] {
  return rawPlugins.filter((plugin) => {
    const name = plugin?.constructor?.name
    return name && name !== 'Function' && !SKIP_PLUGIN_NAMES.has(name)
  })
}

// ---------------------------------------------------------------------------
// NoopTraceSpanPlugin
// ---------------------------------------------------------------------------

/**
 * Next.js loaders call `this.currentTraceSpan.traceChild()` for diagnostic
 * tracing, normally injected by `RspackProfilingPlugin`. We skip that plugin
 * (unnecessary profiling overhead) and provide this no-op implementation so
 * loaders don't crash on `this.currentTraceSpan` being undefined.
 */
const noopSpan: Record<string, any> = {
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

// ---------------------------------------------------------------------------
// CSS rule extraction
// ---------------------------------------------------------------------------

/**
 * Loader name fragments that mark a use entry as part of Next.js's CSS
 * pipeline — Next.js-specific loaders, the Rspack extraction loader, and
 * common CSS pre/post-processors.
 */
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

/** Matches any `test` regex used by CSS-related rules, including Next.js font target files. */
const CSS_TEST_RE = /\.(css|s[ac]ss|less|styl)|target\.css/

function isCssLoaderUse(use: any): boolean {
  const name = loaderNameOf(use)
  return !!name && CSS_LOADER_MARKERS.some((m) => name.includes(m))
}

function isNextFontLoader(use: any): boolean {
  const name = loaderNameOf(use)
  return name === 'next-font-loader' || !!name?.endsWith('/next-font-loader')
}

/**
 * Identify whether a rule from Next.js's rawRules belongs to the CSS pipeline.
 * Detection order:
 * 1. Inline `loader` or any entry in `use` matches a CSS loader
 * 2. Nested `oneOf` / `rules` contains a CSS sub-rule
 * 3. `test` pattern matches CSS extensions — catches error-guard rules that
 *    scope themselves to CSS files without declaring a loader
 */
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
 * Extract Next.js CSS rules and splice a URL-rewrite loader in front of every
 * `next-font-loader`.
 *
 * **Why the rewriter is needed:** `next-font-loader` emits CSS with
 * `url(/_next/static/media/[hash])` (next-font-loader/index.js:78), but the
 * matching `emitFile` call writes the binary at `static/media/[hash]` —
 * without the `/_next/` prefix. Next.js bridges the gap via a dev-server alias
 * (`/_next/*` → output root). Storybook has no such alias, so every font 404s
 * unless we rewrite the prefix out. See `loaders/next-font-url-rewrite.cjs`
 * for the loader itself (and the non-obvious `meta.ast` strip it performs).
 *
 * The rewriter is spliced *before* `next-font-loader` in the `use` chain so
 * it runs *after* it — loaders execute right-to-left.
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

// ---------------------------------------------------------------------------
// Node.js builtins fallback
// ---------------------------------------------------------------------------

/** Node.js builtins that Next.js transitively imports but cannot be resolved in a browser. */
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

// ---------------------------------------------------------------------------
// ReactRefreshInitPlugin
// ---------------------------------------------------------------------------

/**
 * Injects `react-refresh/runtime.injectIntoGlobalHook()` as a global entry.
 *
 * Next.js's simplified `ReactRefreshRspackPlugin` only provides
 * `$ReactRefreshRuntime$` via ProvidePlugin — it does NOT inject the
 * `reactRefreshEntry` that calls `injectIntoGlobalHook()`. Without that
 * initialisation, `__REACT_DEVTOOLS_GLOBAL_HOOK__` is never set up, React's
 * reconciler never registers with it, and `performReactRefresh()` silently
 * does nothing (HMR updates download but the UI never re-renders).
 *
 * Uses `EntryPlugin` with `name: undefined` to inject the entry into every
 * chunk — the same approach as `@rspack/plugin-react-refresh`.
 */
class ReactRefreshInitPlugin {
  constructor(private entryPath: string) {}
  apply(compiler: any) {
    new compiler.webpack.EntryPlugin(compiler.context, this.entryPath, {
      name: undefined,
    }).apply(compiler)
  }
}

// ---------------------------------------------------------------------------
// rsbuildFinal
// ---------------------------------------------------------------------------

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

  const loaderPaths = {
    swcShim: fileURLToPath(
      import.meta.resolve('storybook-next-rsbuild/swc-loader-shim'),
    ),
    refreshEntry: fileURLToPath(
      import.meta.resolve('storybook-next-rsbuild/react-refresh-entry'),
    ),
    fontUrlRewrite: fileURLToPath(
      import.meta.resolve('storybook-next-rsbuild/next-font-url-rewrite'),
    ),
  }

  const nextLoaderChain = buildNextLoaderChain(
    extraction.rawRules,
    loaderPaths.swcShim,
  )
  if (nextLoaderChain) {
    logger.info('Using Next.js SWC loader for JS/TS compilation')
  }

  const nextPlugins = filterNextPlugins(extraction.rawPlugins)

  const nextCssRules = prepareNextCssRules(
    extraction.rawRules,
    loaderPaths.fontUrlRewrite,
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
       * Strip Rsbuild's CSS pipeline. Next.js ships its own
       * `CssExtractRspackPlugin` plus layered rules (`css-loader` with `pure`,
       * `next-flight-css-loader` for RSC, `next-font-loader` for `next/font`,
       * plus postcss / lightningcss / sass chains). Running both pipelines
       * produces double-extraction and silent breakage on `next/font`
       * target.css files. We own the CSS pipeline here; user-side Rsbuild
       * CSS config is intentionally ignored.
       *
       * No React Refresh strip needed — `storybook-builder-rsbuild` calls
       * `createRsbuild({ plugins: [] })`, and `@rsbuild/plugin-react` (which
       * would register `REACT_FAST_REFRESH`) isn't a dependency of any
       * package in this repo. Next.js's `ReactRefreshRspackPlugin` (via
       * `filterNextPlugins`) is the only refresh plugin in the chain.
       *
       * `CHAIN_ID` is supplied via the hook util — it's not exported from
       * `@rsbuild/core`'s public entry, so this is the only stable access.
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

        // --- Resolve ---
        rspackConfig.resolve.fallback = {
          ...rspackConfig.resolve.fallback,
          ...NODE_BUILTINS_FALLBACK,
        }
        if (extraction.resolveLoader) {
          rspackConfig.resolveLoader = {
            ...rspackConfig.resolveLoader,
            ...extraction.resolveLoader,
          }
        }
        // Next.js compiled modules (path-to-regexp, etc.) use __dirname
        // which gets mocked in browser builds — suppress the noisy warning.
        rspackConfig.ignoreWarnings.push(/has been used, it will be mocked/)

        // --- Rules ---
        if (
          nextLoaderChain &&
          !replaceSwcRules(rspackConfig.module.rules, nextLoaderChain)
        ) {
          logger.warn(
            'Could not find builtin:swc-loader rules to replace. ' +
              'Next.js SWC integration may not work correctly.',
          )
        }
        // Unshift so Next.js's specific matchers (e.g.,
        // `require.resolve('next/font/google/target.css')`) are evaluated
        // before any generic file rules that remain in the chain.
        if (nextCssRules.length > 0) {
          rspackConfig.module.rules.unshift(...nextCssRules)
        }

        // --- Plugins ---
        rspackConfig.plugins.push(new NoopTraceSpanPlugin(), ...nextPlugins)
        if (nextLoaderChain) {
          rspackConfig.plugins.push(
            new ReactRefreshInitPlugin(loaderPaths.refreshEntry),
          )
        }
      },
    },
  })
}
