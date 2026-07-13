import { type AddressInfo, createServer } from 'node:net'
import { dirname, join, parse } from 'node:path'
import * as rsbuildReal from '@rsbuild/core'
import fs from 'fs-extra'
import prettyTime from 'pretty-hrtime'
import sirv from 'sirv'
import { getPresets, resolveAddonName } from 'storybook/internal/common'
import { WebpackInvocationError } from 'storybook/internal/server-errors'
import type {
  Options,
  Preset,
  StorybookConfigRaw,
} from 'storybook/internal/types'
import { createRspackChangeDetectionAdapter } from './change-detection-adapter'
import { withStatsJsonCompat } from './chromatic-stats'
import { overrideRsbuildLogger } from './logger'
import rsbuildConfig, {
  type RsbuildBuilderOptions,
} from './preview/iframe-rsbuild.config'
import { applyReactShims } from './react-shims'
import type { RsbuildBuilder } from './types'

export * from './preview/virtual-module-mapping'
export * from './types'

const corePath = dirname(require.resolve('storybook/package.json'))

type RsbuildDevServer = Awaited<
  ReturnType<rsbuildReal.RsbuildInstance['createDevServer']>
>
type StatsOrMultiStats = Parameters<rsbuildReal.OnAfterBuildFn>[0]['stats']
export type Stats = NonNullable<
  Exclude<StatsOrMultiStats, { stats: unknown[] }>
>

export const printDuration = (startTime: [number, number]) =>
  prettyTime(process.hrtime(startTime))
    .replace(' ms', ' milliseconds')
    .replace(' s', ' seconds')
    .replace(' m', ' minutes')

type BuilderStartOptions = Parameters<RsbuildBuilder['start']>['0']

export const executor = {
  get: async (options: Options) => {
    const rsbuildInstance =
      (await options.presets.apply<typeof rsbuildReal>('rsbuildInstance')) ||
      rsbuildReal

    return rsbuildInstance
  },
}

const isObject = (val: unknown): val is Record<string, unknown> =>
  val != null && typeof val === 'object' && Array.isArray(val) === false

function nonNullables<T>(value: T): value is NonNullable<T> {
  return value !== undefined
}

/**
 * A neutral empty rspack config used as the base a `webpackAddons` chain's
 * `webpackFinal` runs against. Built fresh per call so no run mutates a shared
 * object.
 *
 * TODO: using empty webpack config as base for now. It's better to using the
 * composed rspack config in `iframe-rsbuild.config.ts` as base config. But when
 * `tools.rspack` is an async function, the following `tools.rspack` raise an
 * `Promises are not supported` error.
 */
const makeEmptyWebpackAddonsBase = (): rsbuildReal.Rspack.Configuration => ({
  output: {},
  module: {},
  plugins: [],
  resolve: {},
  // https://github.com/web-infra-dev/rsbuild/blob/8dc35dc1d1500d2f119875d46b6a07e27986d532/packages/core/src/provider/rspackConfig.ts#L167
  devServer: undefined,
  optimization: {},
  performance: {},
  externals: {},
  experiments: {},
  node: {},
  stats: {},
  entry: {},
})

/**
 * Resolve the `webpackAddons`-registered presets to their addon entries (the
 * same resolution the builder uses for its own `webpackFinal` pass). Exported so
 * a framework that OWNS the `webpackFinal` chain (see `webpackFinalOwnership`)
 * can apply those hooks itself — against the real, fully-assembled rspack config
 * instead of the builder's dummy base — without re-implementing the resolution.
 */
export async function resolveWebpackAddonPresets(options: Options) {
  const { presets } = options
  const webpackAddons =
    await presets.apply<StorybookConfigRaw['addons']>('webpackAddons')
  return (webpackAddons ?? [])
    .map((preset: Preset) => {
      const addonOptions = isObject(preset)
        ? preset.options || undefined
        : undefined
      const name = isObject(preset) ? preset.name : preset
      // Taken fromm https://github.com/storybookjs/storybook/blob/f3b15ce1f28daac195e7698c075be7790f8172f1/code/core/src/common/presets.ts#L198.
      return resolveAddonName(options.configDir, name, addonOptions)
    })
    .filter(nonNullables)
}

/**
 * Apply the `webpackAddons` chain's `webpackFinal` against a REAL base config,
 * for a framework that owns the `webpackFinal` chain. Presets whose resolved
 * `name` is already in `mainChainPresetNames` are skipped (they run in the
 * framework's main-chain apply) so an addon listed in both `addons` and
 * `webpackAddons` runs exactly once; the skipped names are returned so the
 * caller can warn. Returns the (possibly new) config and the skipped names.
 */
export async function applyWebpackAddonsWebpackFinal(
  options: Options,
  baseConfig: rsbuildReal.Rspack.Configuration,
  mainChainPresetNames: ReadonlySet<string>,
): Promise<{
  config: rsbuildReal.Rspack.Configuration
  skipped: string[]
}> {
  const resolved = await resolveWebpackAddonPresets(options)
  const skipped: string[] = []
  const toApply = resolved.filter((entry: any) => {
    if (entry?.name && mainChainPresetNames.has(entry.name)) {
      skipped.push(entry.name)
      return false
    }
    return true
  })
  if (toApply.length === 0) return { config: baseConfig, skipped }
  const { apply } = await getPresets(toApply as any, options)
  const config = await apply('webpackFinal', baseConfig, options)
  return { config, skipped }
}

const rsbuild = async (_: unknown, options: RsbuildBuilderOptions) => {
  const { presets } = options
  // #region webpack addons
  // A framework can declare it will run the `webpackFinal` chain itself (against
  // the fully-assembled rspack config) by exporting `webpackFinalOwnership`. When
  // it does, skip this dummy-config pass entirely so addon `webpackFinal` hooks
  // don't run twice (once here against an empty base, once in the framework's
  // own apply). Default `false` preserves the exact behavior for every other
  // framework.
  const ownsWebpackFinal = await presets.apply<boolean>(
    'webpackFinalOwnership',
    false,
  )
  let webpackAddonsConfig: rsbuildReal.Rspack.Configuration =
    makeEmptyWebpackAddonsBase()
  if (!ownsWebpackFinal) {
    // No main chain runs here, so there's nothing to skip — apply every
    // `webpackAddons` preset against the empty base (same helper the
    // framework-owned path uses, with an empty skip set).
    ;({ config: webpackAddonsConfig } = await applyWebpackAddonsWebpackFinal(
      options,
      webpackAddonsConfig,
      new Set(),
    ))
  }
  // #endregion

  let intrinsicRsbuildConfig = await rsbuildConfig(options, webpackAddonsConfig)
  const shimsConfig = await applyReactShims(intrinsicRsbuildConfig, options)

  intrinsicRsbuildConfig = rsbuildReal.mergeRsbuildConfig(
    intrinsicRsbuildConfig,
    shimsConfig,
  ) as rsbuildReal.RsbuildConfig

  const finalConfig = await presets.apply(
    'rsbuildFinal',
    intrinsicRsbuildConfig,
    options,
  )

  return finalConfig
}

export const getConfig: RsbuildBuilder['getConfig'] = async (options) => {
  const { presets } = options
  const typescriptOptions = await presets.apply('typescript', {}, options)
  const frameworkOptions = await presets.apply<any>('frameworkOptions')

  return rsbuild({}, {
    ...options,
    typescriptOptions,
    frameworkOptions,
  } as any)
}

let server: RsbuildDevServer
let activeCompiler: rsbuildReal.Rspack.Compiler | undefined

export async function bail(): Promise<void> {
  activeCompiler = undefined
  return server?.close()
}

/**
 * Returns a {@link ChangeDetectionAdapter} bound to the Rspack compiler created by `start()`.
 *
 * Storybook core only invokes this after `start()` has resolved, so `activeCompiler` is populated
 * in practice. The guard is defensive: it fails loudly on an unexpected call-before-start rather
 * than silently binding to an undefined compiler.
 */
export const changeDetectionAdapter: NonNullable<
  RsbuildBuilder['changeDetectionAdapter']
> = () => {
  if (!activeCompiler) {
    // eslint-disable-next-line local-rules/no-uncategorized-errors
    throw new Error(
      'builder-rsbuild: changeDetectionAdapter() called before start(); the Rspack compiler is not ready yet.',
    )
  }
  return createRspackChangeDetectionAdapter(activeCompiler)
}

export const start: RsbuildBuilder['start'] = async ({
  startTime,
  options,
  router,
  server: storybookServer,
}) => {
  overrideRsbuildLogger()
  const { createRsbuild } = await executor.get(options)
  const config = await getConfig(options)
  const rsbuildBuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      ...config,
      server: {
        ...config.server,
        port: await getRandomPort(options.host),
        host: options.host,
        htmlFallback: false,
        printUrls: false,
      },
    },
  })

  rsbuildBuild.onAfterCreateCompiler(({ compiler }) => {
    // Rsbuild yields a MultiCompiler when several environments are built; the preview iframe is
    // a single environment, so pick the first child compiler for change detection.
    activeCompiler = 'compilers' in compiler ? compiler.compilers[0] : compiler
  })

  const rsbuildServer = await rsbuildBuild.createDevServer()

  const waitFirstCompileDone = new Promise<StatsOrMultiStats>((resolve) => {
    rsbuildBuild.onDevCompileDone(({ stats, isFirstCompile }) => {
      if (!isFirstCompile) {
        return
      }
      resolve(stats)
    })
  })

  server = rsbuildServer

  if (!rsbuildBuild) {
    throw new WebpackInvocationError({
      // eslint-disable-next-line local-rules/no-uncategorized-errors
      error: new Error('Missing Rsbuild build instance at runtime!'),
    })
  }

  const previewResolvedDir = join(corePath, 'dist/preview')
  const previewDirOrigin = previewResolvedDir

  router.use(
    '/sb-preview',
    sirv(previewDirOrigin, { maxAge: 300000, dev: true, immutable: true }),
  )

  router.use(rsbuildServer.middlewares)
  rsbuildServer.connectWebSocket({ server: storybookServer })
  const stats = await waitFirstCompileDone
  await server.afterListen()

  return {
    bail,
    stats,
    totalTime: process.hrtime(startTime),
  }
}

// explicit type annotation to bypass TypeScript check
// see: https://github.com/microsoft/TypeScript/issues/47663#issuecomment-1519138189
export const build: ({ options }: BuilderStartOptions) => Promise<Stats> =
  async ({ options }) => {
    overrideRsbuildLogger()
    const { createRsbuild } = await executor.get(options)
    const config = await getConfig(options)
    const rsbuildBuild = await createRsbuild({
      cwd: process.cwd(),
      rsbuildConfig: config,
    })

    const previewResolvedDir = join(corePath, 'dist/preview')
    const previewDirOrigin = previewResolvedDir
    const previewDirTarget = join(options.outputDir || '', 'sb-preview')
    let stats: Stats

    rsbuildBuild.onAfterBuild((params) => {
      stats = params.stats as Stats
    })

    const previewFiles = fs.copy(previewDirOrigin, previewDirTarget, {
      filter: (src) => {
        const { ext } = parse(src)
        if (ext) {
          return ext === '.js'
        }
        return true
      },
    })

    const [{ close }] = await Promise.all([rsbuildBuild.build(), previewFiles])

    await close()
    return withStatsJsonCompat(stats!)
  }

export const corePresets = [join(__dirname, './preview-preset.js')]

export const previewMainTemplate = () =>
  require.resolve('storybook-builder-rsbuild/templates/preview.ejs')

function getRandomPort(host?: string) {
  return new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.on('error', reject)
    server.listen({ port: 0, host }, () => {
      const { port } = server.address() as AddressInfo
      server.close(() => {
        resolve(port)
      })
    })
  })
}
