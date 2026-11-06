import * as rsbuildReal from '@rsbuild/core'
import fs from 'fs-extra'
import { type AddressInfo, createServer } from 'node:net'
import { dirname, join, parse } from 'node:path'
import prettyTime from 'pretty-hrtime'
import sirv from 'sirv'
import { findConfigFile } from 'storybook/internal/common'
import { PREVIEW_BUILDER_PROGRESS } from 'storybook/internal/core-events'
import { logger } from 'storybook/internal/node-logger'
import { WebpackInvocationError } from 'storybook/internal/server-errors'
import type { Options } from 'storybook/internal/types'
import { createRspackChangeDetectionAdapter } from './change-detection-adapter'
import { createHeadlessRsbuildChangeDetectionAdapter } from './change-detection-adapter/headless'
import { withStatsJsonCompat } from './chromatic-stats'
import { overrideRsbuildLogger } from './logger'
import { pluginStorybookMock } from './plugins/rsbuild-plugin-storybook-mock'
import rsbuildConfig, {
  type RsbuildBuilderOptions,
} from './preview/iframe-rsbuild.config'
import type { RsbuildBuilder } from './types'

export {
  pickRsbuildEnvironment,
  stripInheritedConfig,
} from './inherited-config'
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

export const executor = {
  get: async (options: Options) => {
    const rsbuildInstance =
      (await options.presets.apply<typeof rsbuildReal>('rsbuildInstance')) ||
      rsbuildReal

    return rsbuildInstance
  },
}

const rsbuild = async (_: unknown, options: RsbuildBuilderOptions) => {
  const { presets } = options

  const intrinsicRsbuildConfig = await rsbuildConfig(options)

  // Preset hooks run in order with the user's main.ts last. Inherited configs have already
  // been stripped, so an explicit rsbuildFinal hook is the escape hatch for restoring fields.
  const finalConfig = await presets.apply(
    'rsbuildFinal',
    intrinsicRsbuildConfig,
    options,
  )

  const previewConfigPath = findConfigFile('preview', options.configDir)
  if (!previewConfigPath) {
    return finalConfig
  }

  // Intentional divergence: this Vite-style builder appends mocking here after the user's hook,
  // rather than using builder-webpack5's overridePresets slot; the ordering is equivalent.
  // https://github.com/storybookjs/storybook/blob/0f8be9ce02f2e2d8d8730b8b3c7fecb61edc1fd7/code/builders/builder-webpack5/src/presets/custom-webpack-preset.ts
  return {
    ...finalConfig,
    plugins: [
      ...(finalConfig.plugins ?? []),
      pluginStorybookMock({ previewConfigPath }),
    ],
  }
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
 * Returns a {@link ChangeDetectionAdapter} bound to the Rspack compiler created by `start()`, or a
 * headless adapter when `options` are passed without a dev server (the `storybook tools` CLI).
 * Throws if called without options before `start()` has created the compiler.
 */
export const changeDetectionAdapter: NonNullable<
  RsbuildBuilder['changeDetectionAdapter']
> = (options) => {
  if (activeCompiler) {
    return createRspackChangeDetectionAdapter(activeCompiler)
  }
  if (options) {
    return createHeadlessRsbuildChangeDetectionAdapter(options)
  }
  // eslint-disable-next-line local-rules/no-uncategorized-errors
  throw new Error(
    'builder-rsbuild: changeDetectionAdapter() called before start(); the Rspack compiler is not ready yet.',
  )
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
  let completedMessage: string | undefined
  const reportProgress = (newValue: number, message: string) => {
    // Monotonic like builder-webpack5: rebuilds stay at 1 so the preview loader only covers the
    // initial build (#626).
    progressValue = Math.max(newValue, progressValue)
    const progress = {
      value: progressValue,
      message: message.charAt(0).toUpperCase() + message.slice(1),
    }

    if (progressValue === 1) {
      completedMessage ??= `Completed in ${printDuration(startTime)}.`
      progress.message = completedMessage
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
  const runAfterListen = () => {
    void rsbuildServer.afterListen().catch((error) => {
      logger.error(
        `Rsbuild onAfterStartDevServer hook failed in afterListen(): ${error}`,
      )
    })
  }
  if (storybookServer.listening) {
    runAfterListen()
  } else {
    storybookServer.once('listening', runAfterListen)
  }

  return {
    bail,
    totalTime: process.hrtime(startTime),
  }
}

// explicit type annotation to bypass TypeScript check
// see: https://github.com/microsoft/TypeScript/issues/47663#issuecomment-1519138189
export const build: ({
  options,
}: BuilderStartOptions) => Promise<Stats> = async ({ options }) => {
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
