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
  const blocked = ['react', 'react-dom', 'react-server-dom-webpack', 'react/']
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
    if (clientRule || !rule.use) return
    const uses = Array.isArray(rule.use) ? rule.use : [rule.use]
    const names = uses.map(loaderNameOf)
    if (
      names.includes('builtin:react-refresh-loader') &&
      names.includes('next-swc-loader')
    ) {
      clientRule = rule
    }
  })
  if (!clientRule) return null

  const uses = Array.isArray(clientRule.use) ? clientRule.use : [clientRule.use]
  const chain: any[] = []
  for (const use of uses) {
    const name = loaderNameOf(use)
    if (name === 'next-swc-loader' || name?.endsWith('/next-swc-loader')) {
      chain.push({ loader: shimPath, options: use.options || {} })
    } else if (name?.includes('next-flight')) {
      // Skip server component loaders — not needed in Storybook
    } else {
      chain.push(use)
    }
  }
  return chain
}

/**
 * Replace Rsbuild's default `builtin:swc-loader` with the Next.js loader chain.
 * Mutates the rules in place. Returns whether any replacement was made.
 */
function replaceSwcRules(rules: any[], nextChain: any[]): boolean {
  let replaced = false
  walkRules(rules, (rule) => {
    if (!rule.use) return
    const uses = Array.isArray(rule.use) ? rule.use : [rule.use]
    let didSplice = false
    for (let i = 0; i < uses.length; i++) {
      if (loaderNameOf(uses[i]) === 'builtin:swc-loader') {
        uses.splice(i, 1, ...nextChain)
        i += nextChain.length - 1
        didSplice = true
      }
    }
    if (didSplice) {
      rule.use = uses
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
// Font-loader rule
// ---------------------------------------------------------------------------

/**
 * Register our font-loader for `next/font` target.css files.
 *
 * SWC's fontLoaders transform rewrites `Inter({ subsets: ['latin'] })` into
 * `import inter from 'next/font/google/target.css?{...}'`. Our font-loader
 * processes these imports and outputs JS (`{ className, style, variable }`
 * plus `@font-face` injection). We use our own loader because Storybook has
 * no font optimization server — fonts are inlined as data URLs.
 *
 * Rsbuild's css-extract-rspack-plugin would also match `.css` files, so we
 * add an `exclude` to all existing CSS rules before inserting our own rule.
 */
function setupFontLoaderRule(rules: any[], loaderPath: string): void {
  const fontPattern = /next[\\/]font[\\/](google|local)[\\/]target\.css/

  // Exclude font imports from existing CSS rules
  walkRules(rules, (rule) => {
    if (!rule.test) return
    const src =
      rule.test instanceof RegExp ? rule.test.source : String(rule.test)
    if (!src.includes('css')) return
    if (Array.isArray(rule.exclude)) {
      rule.exclude.push(fontPattern)
    } else if (rule.exclude) {
      rule.exclude = [rule.exclude, fontPattern]
    } else {
      rule.exclude = fontPattern
    }
  })

  rules.unshift({
    test: fontPattern,
    type: 'javascript/auto',
    loader: loaderPath,
  })
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
    fontLoader: fileURLToPath(
      import.meta.resolve('storybook-next-rsbuild/font-loader'),
    ),
    refreshEntry: fileURLToPath(
      import.meta.resolve('storybook-next-rsbuild/react-refresh-entry'),
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

  return mergeRsbuildConfig(config, {
    source: {
      define: extraction.defines,
    },
    resolve: {
      alias: allAliases,
    },
    tools: {
      rspack: (rspackConfig) => {
        rspackConfig.resolve ??= {}
        rspackConfig.resolve.fallback = {
          ...rspackConfig.resolve.fallback,
          ...NODE_BUILTINS_FALLBACK,
        }

        // Next.js compiled modules (path-to-regexp, etc.) use __dirname
        // which gets mocked in browser builds — suppress the noisy warning.
        rspackConfig.ignoreWarnings ??= []
        rspackConfig.ignoreWarnings.push(/has been used, it will be mocked/)

        if (extraction.resolveLoader) {
          rspackConfig.resolveLoader = {
            ...rspackConfig.resolveLoader,
            ...extraction.resolveLoader,
          }
        }

        if (nextLoaderChain) {
          const ok = replaceSwcRules(
            rspackConfig.module?.rules ?? [],
            nextLoaderChain,
          )
          if (!ok) {
            logger.warn(
              'Could not find builtin:swc-loader rules to replace. ' +
                'Next.js SWC integration may not work correctly.',
            )
          }
        }

        rspackConfig.module ??= {}
        rspackConfig.module.rules ??= []
        setupFontLoaderRule(rspackConfig.module.rules, loaderPaths.fontLoader)

        rspackConfig.plugins ??= []
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
