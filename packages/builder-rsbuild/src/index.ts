import { type AddressInfo, createServer } from 'node:net'
import { dirname, join, parse } from 'node:path'
import * as rsbuildReal from '@rsbuild/core'
import fs from 'fs-extra'
import prettyTime from 'pretty-hrtime'
import sirv from 'sirv'
import { getPresets, resolveAddonName } from 'storybook/internal/common'
import { PREVIEW_BUILDER_PROGRESS } from 'storybook/internal/core-events'
import { logger } from 'storybook/internal/node-logger'
import {
  WebpackCompilationError,
  WebpackInvocationError,
} from 'storybook/internal/server-errors'
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

export { stripInheritedConfig } from './inherited-config'
export * from './preview/virtual-module-mapping'
export * from './types'

const corePath = dirname(require.resolve('storybook/package.json'))

type RsbuildDevServer = Awaited<
  ReturnType<rsbuildReal.RsbuildInstance['createDevServer']>
>
type StatsOrMultiStats = Parameters<rsbuildReal.OnAfterDevCompileFn>[0]['stats']
export type Stats = Exclude<StatsOrMultiStats, { stats: unknown[] }>

export const printDuration = (startTime: [number, number]) =>
  prettyTime(process.hrtime(startTime))
    .replace(' ms', ' milliseconds')
    .replace(' s', ' seconds')
    .replace(' min', ' minutes')

type BuilderStartOptions = Parameters<RsbuildBuilder['start']>['0']
type ListeningRouter = BuilderStartOptions['router'] & {
  listen: (
    options: { host?: string; port?: number },
    callback: () => void,
  ) => unknown
}

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

  // Preset hooks run in order with the user's main.ts last. Inherited configs have already
  // been stripped, so an explicit rsbuildFinal hook is the escape hatch for restoring fields.
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
let activeStorybookServer: BuilderStartOptions['server'] | undefined
let didBuilderStartStorybookServer = false
let rejectFirstCompile: ((reason?: unknown) => void) | undefined

export async function bail(): Promise<void> {
  const storybookServerToClose =
    didBuilderStartStorybookServer && activeStorybookServer?.listening
      ? activeStorybookServer
      : undefined
  activeCompiler = undefined
  activeStorybookServer = undefined
  didBuilderStartStorybookServer = false
  rejectFirstCompile?.()
  rejectFirstCompile = undefined
  await Promise.all([
    storybookServerToClose &&
      new Promise<void>((resolve) => {
        storybookServerToClose.close(() => resolve())
      }),
    server?.close(),
  ])
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
  channel,
}) => {
  overrideRsbuildLogger()
  const { createRsbuild, rspack } = await executor.get(options)
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

  let progressValue = 0
  const reportProgress = (newValue: number, message: string) => {
    // Unlike builder-webpack5, reset after a completed compilation because Rspack reuses this
    // handler for rebuilds; otherwise every later update is permanently clamped to 1.
    if (progressValue === 1 && newValue < 1) {
      progressValue = 0
    }
    progressValue = Math.max(newValue, progressValue)
    const progress = {
      value: progressValue,
      message: message.charAt(0).toUpperCase() + message.slice(1),
    }

    if (progressValue === 1) {
      progress.message = `Completed in ${printDuration(startTime)}.`
    }

    channel.emit(PREVIEW_BUILDER_PROGRESS, progress)
  }

  rsbuildBuild.onAfterCreateCompiler(({ compiler }) => {
    // Rsbuild yields a MultiCompiler when several environments are built; the preview iframe is
    // a single environment, so pick the first child compiler for change detection.
    const previewCompiler =
      'compilers' in compiler ? compiler.compilers[0] : compiler
    activeCompiler = previewCompiler
    // Storybook channel progress intentionally reflects only the preview environment and coexists
    // with Rsbuild's terminal progress bar; any additional environments are not included.
    // This deliberately adds a second progress instrumentation alongside Rsbuild's dev.progressBar:
    // the terminal bar and Storybook channel serve separate consumers, and that cost is accepted.
    new rspack.ProgressPlugin(reportProgress).apply(previewCompiler)
  })

  const rsbuildServer = await rsbuildBuild.createDevServer()

  const waitFirstCompileDone = new Promise<StatsOrMultiStats>(
    (resolve, rej) => {
      rejectFirstCompile = rej
      rsbuildBuild.onDevCompileDone(({ stats, isFirstCompile }) => {
        if (!isFirstCompile) {
          return
        }
        rejectFirstCompile = undefined
        resolve(stats)
      })
    },
  )
  waitFirstCompileDone.catch(() => {})

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
  // Storybook 10.5 waits for start() before listening, while the upstream webpack contract starts
  // the server first and keeps start() pending for the initial compilation. Restore that ordering
  // here so the manager can receive progress, then make core's later listen call idempotent.
  const listeningRouter = router as ListeningRouter
  const listen = listeningRouter.listen.bind(listeningRouter)
  listeningRouter.listen = (listenOptions, callback) => {
    if (!storybookServer.listening) {
      return listen(listenOptions, () => {
        activeStorybookServer = storybookServer
        didBuilderStartStorybookServer = true
        callback()
      })
    }
    callback()
    return listeningRouter
  }
  await new Promise<void>((resolve, reject) => {
    storybookServer.once('error', reject)
    listeningRouter.listen({ port: options.port, host: options.host }, resolve)
  })
  if (!options.quiet && options.localAddress) {
    logger.info(
      `Storybook server is listening at ${options.localAddress} while the preview builds.`,
    )
  }
  const stats = await waitFirstCompileDone
  if (stats.hasErrors()) {
    let errors
    if ('stats' in stats) {
      errors = stats.toJson({ all: false, errors: true }).errors ?? []
    } else {
      const json = stats.toJson({ all: false, children: true, errors: true })
      errors = [json, ...(json.children ?? [])].flatMap(
        (compilation) => compilation.errors ?? [],
      )
    }
    throw new WebpackCompilationError({ errors })
  }
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
