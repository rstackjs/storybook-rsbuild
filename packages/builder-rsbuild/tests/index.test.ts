import type { OnAfterDevCompileFn, Rspack } from '@rsbuild/core'
import { afterEach, beforeEach, describe, expect, it, rs } from '@rstest/core'
import { PREVIEW_BUILDER_PROGRESS } from 'storybook/internal/core-events'
import { WebpackCompilationError } from 'storybook/internal/server-errors'
import { bail, printDuration, type Stats, start } from '../src/index'
import { createTestOptions } from './fixtures/options'

const mocks = rs.hoisted(() => ({
  applyReactShims: rs.fn(),
  getPresets: rs.fn(),
  iframeConfig: rs.fn(),
  loggerInfo: rs.fn(),
  overrideRsbuildLogger: rs.fn(),
}))

rs.mock('storybook/internal/common', () => ({
  getPresets: mocks.getPresets,
  resolveAddonName: rs.fn(),
}))

rs.mock('storybook/internal/node-logger', () => ({
  logger: { info: mocks.loggerInfo },
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
type CompileDoneHandler = OnAfterDevCompileFn
type CompileStats = Parameters<CompileDoneHandler>[0]['stats']

type CompilationError = ConstructorParameters<
  typeof WebpackCompilationError
>[0]['errors'][number]

const compilationError = {
  message: 'Module build failed: SyntaxError: Unexpected token',
  name: 'ModuleBuildError',
  stack: 'ModuleBuildError: Module build failed',
}

const childCompilationError = {
  message: 'Child compilation failed: SyntaxError: Unexpected token',
  name: 'ModuleBuildError',
  stack: 'ModuleBuildError: Child compilation failed',
}

const createStats = ({
  errors = [],
  childErrors = [],
}: {
  errors?: CompilationError[]
  childErrors?: CompilationError[]
} = {}): Stats =>
  ({
    hasErrors: () => errors.length > 0 || childErrors.length > 0,
    toJson: (
      options: boolean | string | { all?: boolean; children?: boolean },
    ) => ({
      errors,
      ...(typeof options === 'object' && options.children
        ? { children: [{ errors: childErrors }] }
        : {}),
    }),
  }) as unknown as Stats

const createMultiStats = (errors: CompilationError[]): CompileStats =>
  ({
    stats: [createStats({ errors })],
    hasErrors: () => errors.length > 0,
    toJson: () => ({ errors }),
  }) as unknown as CompileStats

const createStartHarness = ({
  stats = createStats(),
  compiler = {} as Rspack.Compiler,
  autoComplete = true,
}: {
  stats?: CompileStats
  compiler?: Rspack.Compiler | Rspack.MultiCompiler
  autoComplete?: boolean
} = {}) => {
  let progress: ProgressHandler | undefined
  let compileDoneHandler: CompileDoneHandler | undefined
  let markCompileHandlerRegistered: () => void
  const compileHandlerRegistered = new Promise<void>((resolve) => {
    markCompileHandlerRegistered = resolve
  })
  let markServerStarted: () => void
  const serverStarted = new Promise<void>((resolve) => {
    markServerStarted = resolve
  })

  const channel = { emit: rs.fn() }
  const devServer = {
    afterListen: rs.fn(),
    close: rs.fn(),
    connectWebSocket: rs.fn(),
    middlewares: rs.fn(),
  }
  let isListening = false
  const storybookServer = {
    get listening() {
      return isListening
    },
    once: rs.fn(),
  }
  const listen = rs.fn(
    (_options: { host?: string; port?: number }, callback: () => void) => {
      isListening = true
      callback()
      markServerStarted()
      return router
    },
  )
  const router = {
    use: rs.fn(),
    listen,
  }
  const completeCompile = () => {
    void compileDoneHandler?.({
      environments: {},
      isFirstCompile: true,
      stats,
    })
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
    onDevCompileDone: rs.fn((handler: CompileDoneHandler) => {
      compileDoneHandler = handler
      markCompileHandlerRegistered()
      if (autoComplete) {
        queueMicrotask(completeCompile)
      }
    }),
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
          progress?.(0.5, 'building')
          progress?.(0.4, 'building')
          progress?.(1, 'done')
        }
      },
    },
  }
  const { options } = createTestOptions({
    presetValues: new Map([
      ['rsbuildInstance', rsbuildInstance],
      ['webpackAddons', []],
    ]),
    overrides: {
      host: 'localhost',
      localAddress: 'http://localhost:6006/',
      port: 6006,
    },
  })
  const startOptions = {
    channel,
    options,
    router,
    server: storybookServer,
    startTime: process.hrtime(),
  } as unknown as Parameters<typeof start>[0]

  return {
    applyProgressPlugin,
    channel,
    compileHandlerRegistered,
    completeCompile,
    listen,
    reportProgress,
    router,
    serverStarted,
    startOptions,
  }
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
})

describe('printDuration', () => {
  it('formats minutes without leaving part of the abbreviation', () => {
    const startTime = process.hrtime()
    startTime[0] -= 72

    expect(printDuration(startTime)).toBe('1.2 minutes')
  })
})

describe('start', () => {
  it('starts the Storybook server before the first compilation finishes', async () => {
    const { compileHandlerRegistered, completeCompile, listen, startOptions } =
      createStartHarness({ autoComplete: false })

    const result = start(startOptions)
    await compileHandlerRegistered
    const listenCallsBeforeCompile = listen.mock.calls.length
    completeCompile()
    await result

    expect(listenCallsBeforeCompile).toBe(1)
  })

  it('keeps the core server listen call idempotent after starting early', async () => {
    const { listen, router, startOptions } = createStartHarness()

    await start(startOptions)
    const coreListenCallback = rs.fn()
    router.listen({ host: 'localhost', port: 6006 }, coreListenCallback)

    expect(listen).toHaveBeenCalledTimes(1)
    expect(coreListenCallback).toHaveBeenCalledTimes(1)
  })

  it('prints the Storybook URL as soon as the server starts', async () => {
    const { completeCompile, serverStarted, startOptions } = createStartHarness(
      {
        autoComplete: false,
      },
    )

    const result = start(startOptions)
    await serverStarted
    await Promise.resolve()
    const loggedBeforeCompile = mocks.loggerInfo.mock.calls.length
    completeCompile()
    await result

    expect(loggedBeforeCompile).toBe(1)
    expect(mocks.loggerInfo).toHaveBeenCalledWith(
      expect.stringContaining('http://localhost:6006/'),
    )
  })

  it('rejects a pending first compilation when bailed', async () => {
    const { compileHandlerRegistered, completeCompile, startOptions } =
      createStartHarness({ autoComplete: false })

    const result = start(startOptions)
    const outcome = result.then(
      () => 'resolved',
      () => 'rejected',
    )
    await compileHandlerRegistered
    await bail()
    const settled = await Promise.race([
      outcome,
      new Promise<'pending'>((resolve) =>
        setTimeout(() => resolve('pending'), 20),
      ),
    ])
    completeCompile()

    expect(settled).toBe('rejected')
  })

  it('reports preview compilation progress', async () => {
    const { channel, startOptions } = createStartHarness()

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
  })

  it('restarts progress from the next compilation value', async () => {
    const { channel, reportProgress, startOptions } = createStartHarness()

    await start(startOptions)
    channel.emit.mockClear()
    reportProgress(0.2, 'building')
    reportProgress(0.1, 'building')

    expect(channel.emit).toHaveBeenNthCalledWith(1, PREVIEW_BUILDER_PROGRESS, {
      value: 0.2,
      message: 'Building',
    })
    expect(channel.emit).toHaveBeenNthCalledWith(2, PREVIEW_BUILDER_PROGRESS, {
      value: 0.2,
      message: 'Building',
    })
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

  it.each([
    ['Stats', createStats({ errors: [compilationError] })],
    ['MultiStats', createMultiStats([compilationError])],
  ])('throws a compilation error from %s', async (_name, stats) => {
    const { startOptions } = createStartHarness({ stats })
    const result = start(startOptions)

    await expect(result).rejects.toBeInstanceOf(WebpackCompilationError)
    await expect(result).rejects.toMatchObject({
      data: { errors: [compilationError] },
    })
  })

  it('preserves root and child compilation errors', async () => {
    const stats = createStats({
      errors: [compilationError],
      childErrors: [childCompilationError],
    })
    const { startOptions } = createStartHarness({ stats })

    await expect(start(startOptions)).rejects.toMatchObject({
      data: { errors: [compilationError, childCompilationError] },
    })
  })
})
