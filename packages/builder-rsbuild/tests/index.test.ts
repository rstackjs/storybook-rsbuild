import { EventEmitter } from 'node:events'
import { fileURLToPath } from 'node:url'
import type { RsbuildConfig, Rspack } from '@rsbuild/core'
import { afterEach, beforeEach, describe, expect, it, rs } from '@rstest/core'
import { PREVIEW_BUILDER_PROGRESS } from 'storybook/internal/core-events'
import * as previewBuilder from '../src/index'
import * as previewPreset from '../src/preview-preset'
import { createTestOptions } from './fixtures/options'

const { bail, printDuration, start } = previewBuilder

const mocks = rs.hoisted(() => ({
  applyReactShims: rs.fn(),
  findConfigFile: rs.fn(),
  getPresets: rs.fn(),
  iframeConfig: rs.fn(),
  loggerError: rs.fn(),
  overrideRsbuildLogger: rs.fn(),
}))

rs.mock('storybook/internal/common', () => ({
  findConfigFile: mocks.findConfigFile,
  getPresets: mocks.getPresets,
  resolveAddonName: rs.fn(),
}))

rs.mock('storybook/internal/node-logger', () => ({
  logger: { error: mocks.loggerError },
}))

rs.mock('../src/logger', () => ({
  overrideRsbuildLogger: mocks.overrideRsbuildLogger,
}))

rs.mock('../src/preview/iframe-rsbuild.config', () => ({
  default: mocks.iframeConfig,
}))

rs.mock('../src/react-shims', () => ({
  applyReactShims: mocks.applyReactShims,
}))

type ProgressHandler = (value: number, message: string) => void

const createStartHarness = ({
  afterListenError,
  compiler = {} as Rspack.Compiler,
  serverListening = false,
  startTime = process.hrtime(),
}: {
  afterListenError?: Error
  compiler?: Rspack.Compiler | Rspack.MultiCompiler
  serverListening?: boolean
  startTime?: [number, number]
} = {}) => {
  let progress: ProgressHandler | undefined
  const channel = { emit: rs.fn() }
  const devServer = {
    afterListen: afterListenError
      ? () => Promise.reject(afterListenError)
      : rs.fn().mockResolvedValue(undefined),
    close: rs.fn(),
    connectWebSocket: rs.fn(),
    middlewares: rs.fn(),
  }
  const router = { use: rs.fn() }
  const storybookServer = Object.assign(new EventEmitter(), {
    listening: serverListening,
  })
  const startListening = () => {
    storybookServer.listening = true
    storybookServer.emit('listening')
  }
  const reportProgress = (value: number, message: string) => {
    progress?.(value, message)
  }
  const applyProgressPlugin = rs.fn()
  const rsbuildBuild = {
    createDevServer: rs.fn().mockResolvedValue(devServer),
    onAfterCreateCompiler: rs.fn(
      (
        handler: (params: {
          compiler: Rspack.Compiler | Rspack.MultiCompiler
          environments: Record<string, never>
        }) => void,
      ) => {
        handler({ compiler, environments: {} })
      },
    ),
  }
  const rsbuildInstance = {
    createRsbuild: rs.fn().mockResolvedValue(rsbuildBuild),
    rspack: {
      ProgressPlugin: class ProgressPlugin {
        constructor(handler: ProgressHandler) {
          progress = handler
        }

        apply(compiler: Rspack.Compiler) {
          applyProgressPlugin(compiler)
        }
      },
    },
  }
  const { options } = createTestOptions({
    presetValues: new Map<string, unknown>([
      ['rsbuildInstance', rsbuildInstance],
      ['webpackAddons', []],
    ]),
    overrides: {
      host: 'localhost',
      port: 6006,
    },
  })
  const startOptions = {
    channel,
    options,
    router,
    server: storybookServer,
    startTime,
  } as unknown as Parameters<typeof start>[0]

  return {
    afterListen: devServer.afterListen,
    applyProgressPlugin,
    channel,
    reportProgress,
    startListening,
    startOptions,
  }
}

beforeEach(() => {
  mocks.applyReactShims.mockResolvedValue({})
  mocks.findConfigFile.mockReturnValue('/project/.storybook/preview.ts')
  mocks.getPresets.mockResolvedValue({
    apply: async (_name: string, config: unknown) => config,
  })
  mocks.iframeConfig.mockResolvedValue({})
})

afterEach(async () => {
  await bail()
})

describe('printDuration', () => {
  it('formats minutes without leaving part of the abbreviation', () => {
    const startTime = process.hrtime()
    startTime[0] -= 72

    expect(printDuration(startTime)).toBe('1.2 minutes')
  })
})

describe('preset ordering', () => {
  it('preserves a custom template while applying mocking after user config', async () => {
    const { apply, options } = createTestOptions({
      overrides: { configDir: '/project/.storybook' },
    })
    const expectedDefaultTemplate = fileURLToPath(
      new URL('../templates/preview.ejs', import.meta.url),
    )
    const baseConfig: RsbuildConfig = {
      resolve: { alias: { base: '/project/src/base' } },
    }
    const userRsbuildFinal = rs.fn(
      async (_config: RsbuildConfig): Promise<RsbuildConfig> => ({
        resolve: { alias: { app: '/project/src/app' } },
      }),
    )
    const userPreviewMainTemplate = rs.fn(
      (_template?: string) => '/project/.storybook/preview-template.ejs',
    )
    apply.mockImplementation(async (name: string, defaultValue?: unknown) => {
      if (name === 'rsbuildFinal') {
        return userRsbuildFinal(defaultValue as RsbuildConfig)
      }

      return defaultValue
    })
    mocks.iframeConfig.mockResolvedValue(baseConfig)

    expect(previewPreset).not.toHaveProperty('rsbuildFinal')
    expect(previewPreset.previewMainTemplate()).toBe(expectedDefaultTemplate)

    const previewMainTemplate = userPreviewMainTemplate(
      previewPreset.previewMainTemplate(),
    )
    const config = await previewBuilder.getConfig(options)

    expect(userRsbuildFinal).toHaveBeenCalledExactlyOnceWith(baseConfig)
    expect(userPreviewMainTemplate).toHaveBeenCalledExactlyOnceWith(
      expectedDefaultTemplate,
    )
    expect(previewMainTemplate).toBe('/project/.storybook/preview-template.ejs')
    expect(config.resolve?.alias).toEqual({ app: '/project/src/app' })
    expect(config.tools?.rspack).toEqual([expect.any(Function)])
  })
})

describe('start', () => {
  it('resolves without preview stats or waiting for the first compilation', async () => {
    const { startOptions } = createStartHarness()

    const result = await start(startOptions)

    expect(result).not.toHaveProperty('stats')
  })

  it('notifies Rsbuild after the Storybook server starts listening', async () => {
    const { afterListen, startListening, startOptions } = createStartHarness()

    await start(startOptions)
    expect(afterListen).not.toHaveBeenCalled()

    startListening()
    startListening()

    expect(afterListen).toHaveBeenCalledTimes(1)
  })

  it('notifies Rsbuild when the Storybook server is already listening', async () => {
    const { afterListen, startOptions } = createStartHarness({
      serverListening: true,
    })

    await start(startOptions)

    expect(afterListen).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['already listening', true, false],
    ['listening event', false, true],
  ])(
    'reports an afterListen failure without an unhandled rejection when %s',
    async (_name, serverListening, emitListening) => {
      const afterListenError = new Error('plugin hook failed')
      const { startListening, startOptions } = createStartHarness({
        afterListenError,
        serverListening,
      })
      const unhandledRejection = rs.fn()
      const handleUnhandledRejection = (reason: unknown) => {
        if (reason === afterListenError) {
          unhandledRejection(reason)
        }
      }
      process.prependListener('unhandledRejection', handleUnhandledRejection)

      try {
        await start(startOptions)
        if (emitListening) {
          startListening()
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 10))

        expect(unhandledRejection).not.toHaveBeenCalled()
        expect(mocks.loggerError).toHaveBeenCalledWith(
          expect.stringMatching(/onAfterStartDevServer|afterListen/),
        )
      } finally {
        process.removeListener('unhandledRejection', handleUnhandledRejection)
      }
    },
  )

  it('reports preview compilation progress', async () => {
    const { channel, reportProgress, startOptions } = createStartHarness()

    await start(startOptions)
    reportProgress(0.5, 'building')
    reportProgress(0.4, 'building')
    reportProgress(1, 'done')

    expect(channel.emit).toHaveBeenNthCalledWith(1, PREVIEW_BUILDER_PROGRESS, {
      value: 0.5,
      message: 'Building',
    })
    expect(channel.emit).toHaveBeenNthCalledWith(2, PREVIEW_BUILDER_PROGRESS, {
      value: 0.5,
      message: 'Building',
    })
    expect(channel.emit).toHaveBeenNthCalledWith(3, PREVIEW_BUILDER_PROGRESS, {
      value: 1,
      message: expect.stringMatching(/^Completed in /),
    })
  })

  it('restarts progress from the next compilation value', async () => {
    const { channel, reportProgress, startOptions } = createStartHarness()

    await start(startOptions)
    reportProgress(1, 'done')
    reportProgress(0.2, 'building')
    reportProgress(0.1, 'building')

    expect(channel.emit).toHaveBeenNthCalledWith(2, PREVIEW_BUILDER_PROGRESS, {
      value: 0.2,
      message: 'Building',
    })
    expect(channel.emit).toHaveBeenNthCalledWith(3, PREVIEW_BUILDER_PROGRESS, {
      value: 0.2,
      message: 'Building',
    })
  })

  it('measures rebuild duration from the rebuild start', async () => {
    const staleStartTime = process.hrtime()
    staleStartTime[0] -= 120
    const { channel, reportProgress, startOptions } = createStartHarness({
      startTime: staleStartTime,
    })

    await start(startOptions)
    reportProgress(1, 'done')
    reportProgress(0.2, 'building')
    reportProgress(1, 'done')

    const firstBuild = channel.emit.mock.calls[0][1]
    const rebuild = channel.emit.mock.calls[2][1]
    expect(firstBuild.message).toContain('minutes')
    expect(rebuild.message).not.toContain('minutes')
  })

  it('applies progress tracking to the preview compiler', async () => {
    const previewCompiler = {} as Rspack.Compiler
    const otherCompiler = {} as Rspack.Compiler
    const compiler = {
      compilers: [previewCompiler, otherCompiler],
    } as Rspack.MultiCompiler
    const { applyProgressPlugin, startOptions } = createStartHarness({
      compiler,
    })

    await start(startOptions)

    expect(applyProgressPlugin).toHaveBeenCalledExactlyOnceWith(previewCompiler)
  })
})
