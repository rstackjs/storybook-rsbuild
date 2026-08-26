import { afterEach, beforeEach, describe, expect, it, rs } from '@rstest/core'
import { PREVIEW_BUILDER_PROGRESS } from 'storybook/internal/core-events'
import { WebpackCompilationError } from 'storybook/internal/server-errors'
import type { Options } from 'storybook/internal/types'
import { bail, type Stats, start } from './index'

const mocks = rs.hoisted(() => ({
  applyReactShims: rs.fn(),
  getPresets: rs.fn(),
  iframeConfig: rs.fn(),
  overrideRsbuildLogger: rs.fn(),
}))

rs.mock('storybook/internal/common', () => ({
  getPresets: mocks.getPresets,
  resolveAddonName: rs.fn(),
}))

rs.mock('./logger', () => ({
  overrideRsbuildLogger: mocks.overrideRsbuildLogger,
}))

rs.mock('./preview/iframe-rsbuild.config', () => ({
  default: mocks.iframeConfig,
}))

rs.mock('./react-shims', () => ({
  applyReactShims: mocks.applyReactShims,
}))

type ProgressHandler = (value: number, message: string) => void

type CompilationError = ConstructorParameters<
  typeof WebpackCompilationError
>[0]['errors'][number]

const createStats = (errors: CompilationError[] = []): Stats =>
  ({
    compilation: {
      modules: { size: 20 },
    },
    hasErrors: () => errors.length > 0,
    toJson: () => ({ errors }),
  }) as unknown as Stats

const createStartHarness = (stats: Stats = createStats()) => {
  let compileDone:
    | ((params: { stats: Stats; isFirstCompile: boolean }) => void)
    | undefined
  let compilerCreated:
    | ((params: { compiler: Record<string, never> }) => void)
    | undefined
  let progress: ProgressHandler | undefined

  const channel = { emit: rs.fn() }
  const cache = {
    get: rs.fn().mockResolvedValue(1000),
    set: rs.fn().mockResolvedValue(undefined),
  }
  const devServer = {
    afterListen: rs.fn(),
    close: rs.fn(),
    connectWebSocket: rs.fn(() => {
      queueMicrotask(() => {
        progress?.(0.5, 'building')
        progress?.(0.4, 'building')
        progress?.(1, '')
        compileDone?.({ stats, isFirstCompile: true })
      })
    }),
    middlewares: rs.fn(),
  }
  const rsbuildBuild = {
    createDevServer: rs.fn(async () => {
      compilerCreated?.({ compiler: {} })
      return devServer
    }),
    onAfterCreateCompiler: rs.fn(
      (handler: NonNullable<typeof compilerCreated>) => {
        compilerCreated = handler
      },
    ),
    onDevCompileDone: rs.fn((handler: NonNullable<typeof compileDone>) => {
      compileDone = handler
    }),
  }
  const rsbuildInstance = {
    createRsbuild: rs.fn().mockResolvedValue(rsbuildBuild),
    rspack: {
      ProgressPlugin: class ProgressPlugin {
        constructor(handler: ProgressHandler) {
          progress = handler
        }

        apply() {}
      },
    },
  }
  const presets = {
    apply: rs.fn(async (name: string, defaultValue?: unknown) => {
      if (name === 'rsbuildInstance') {
        return rsbuildInstance
      }
      if (name === 'webpackAddons') {
        return []
      }
      return defaultValue ?? {}
    }),
  }
  const options = {
    cache,
    channel,
    configDir: process.cwd(),
    presets,
  } as unknown as Options
  const startOptions = {
    channel,
    options,
    router: { use: rs.fn() },
    server: {},
    startTime: process.hrtime(),
  } as unknown as Parameters<typeof start>[0]

  return { cache, channel, startOptions }
}

beforeEach(() => {
  mocks.applyReactShims.mockResolvedValue({})
  mocks.getPresets.mockResolvedValue({
    apply: async (_name: string, config: unknown) => config,
  })
  mocks.iframeConfig.mockResolvedValue({})
})

afterEach(async () => {
  await bail()
  rs.clearAllMocks()
})

describe('start', () => {
  it('reports preview compilation progress and caches the module count', async () => {
    const { cache, channel, startOptions } = createStartHarness()

    await start(startOptions)

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
    expect(cache.set).toHaveBeenCalledWith('modulesCount', 20)
  })

  it('throws a compilation error when the initial compilation fails', async () => {
    const compilationError = {
      message: 'Module build failed: SyntaxError: Unexpected token',
      name: 'ModuleBuildError',
      stack: 'ModuleBuildError: Module build failed',
    }
    const { startOptions } = createStartHarness(createStats([compilationError]))

    let error: unknown
    try {
      await start(startOptions)
    } catch (caught) {
      error = caught
    }

    expect(error).toBeInstanceOf(WebpackCompilationError)
    expect(error).toMatchObject({
      data: { errors: [compilationError] },
    })
  })
})
