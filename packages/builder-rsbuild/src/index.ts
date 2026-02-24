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

const rsbuild = async (_: unknown, options: RsbuildBuilderOptions) => {
  const { presets } = options
  // #region webpack addons
  const webpackAddons =
    await presets.apply<StorybookConfigRaw['addons']>('webpackAddons')
  const resolvedWebpackAddons = (webpackAddons ?? [])
    .map((preset: Preset) => {
      const addonOptions = isObject(preset)
        ? preset.options || undefined
        : undefined
      const name = isObject(preset) ? preset.name : preset
      // Taken fromm https://github.com/storybookjs/storybook/blob/f3b15ce1f28daac195e7698c075be7790f8172f1/code/core/src/common/presets.ts#L198.
      return resolveAddonName(options.configDir, name, addonOptions)
    })
    .filter(nonNullables)
  const { apply } = await getPresets(resolvedWebpackAddons, options)
  const webpackAddonsConfig: rsbuildReal.Rspack.Configuration = await apply(
    'webpackFinal',
    // TODO: using empty webpack config as base for now. It's better to using the composed rspack
    // config in `iframe-rsbuild.config.ts` as base config. But when `tools.rspack` is an async function,
    // the following `tools.rspack` raise an `Promises are not supported` error.
    {
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
    },
    options,
  )
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

export async function bail(): Promise<void> {
  return server?.close()
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
