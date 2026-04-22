import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mergeRsbuildConfig } from '@rsbuild/core'
import { logger } from 'storybook/internal/node-logger'
import type { PresetProperty } from 'storybook/internal/types'
import type { FrameworkOptions, StorybookConfig } from './types'
import { extractNextRspackConfig, getNextVersion } from './utils/next-config'
import {
  buildNextLoaderChain,
  filterNextAliases,
  filterNextPlugins,
  prepareNextCssRules,
  replaceSwcRules,
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
