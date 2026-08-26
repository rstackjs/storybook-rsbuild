import type { OnAfterDevCompileFn, Rspack } from '@rsbuild/core'
import { afterEach, beforeEach, describe, expect, it, rs } from '@rstest/core'
import { PREVIEW_BUILDER_PROGRESS } from 'storybook/internal/core-events'
import { WebpackCompilationError } from 'storybook/internal/server-errors'
import { bail, printDuration, start } from '../src/index'
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
type CompileStats = Parameters<OnAfterDevCompileFn>[0]['stats']

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
} = {}): CompileStats =>
  ({
    hasErrors: () => errors.length > 0 || childErrors.length > 0,
    toJson: (options: {
      all?: boolean
      children?: boolean
      errors?: boolean
    }) => ({
      errors,
      ...(typeof options === 'object' && options.children
        ? { children: [{ errors: childErrors }] }
        : {}),
    }),
  }) as unknown as CompileStats

const createMultiStats = (errors: CompilationError[]): CompileStats =>
  ({
    stats: [createStats({ errors })],
    hasErrors: () => errors.length > 0,
    toJson: () => ({ errors }),
  }) as unknown as CompileStats

const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise
  })

  return { promise, resolve }
}

const createStartHarness = ({
  stats = createStats(),
  compiler = {} as Rspack.Compiler,
  autoComplete = true,
  listenError,
  quiet,
}: {
  stats?: CompileStats
  compiler?: Rspack.Compiler | Rspack.MultiCompiler
  autoComplete?: boolean
  listenError?: Error
  quiet?: boolean
} = {}) => {
  let progress: ProgressHandler | undefined
  let compileDoneHandler: OnAfterDevCompileFn | undefined
  const compileHandlerRegistered = deferred()
  const serverStarted = deferred()

  const channel = { emit: rs.fn() }
  const devServer = {
    afterListen: rs.fn(),
    close: rs.fn(),
    connectWebSocket: rs.fn(),
    middlewares: rs.fn(),
  }
  let isListening = false
  let serverErrorHandler: ((error: Error) => void) | undefined
  const storybookServer = {
    get listening() {
      return isListening
    },
    close: rs.fn((callback?: (error?: Error) => void) => {
      isListening = false
      callback?.()
      return storybookServer
    }),
    once: rs.fn((event: string, handler: (error: Error) => void) => {
      if (event === 'error') {
        serverErrorHandler = handler
      }
      return storybookServer
    }),
  }
  const listen = rs.fn(
    (_options: { host?: string; port?: number }, callback: () => void) => {
      if (listenError) {
        queueMicrotask(() => serverErrorHandler?.(listenError))
        return router
      }
      isListening = true
      callback()
      serverStarted.resolve()
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
    onDevCompileDone: rs.fn((handler: OnAfterDevCompileFn) => {
      compileDoneHandler = handler
      compileHandlerRegistered.resolve()
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
      quiet,
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
    compileHandlerRegistered: compileHandlerRegistered.promise,
    completeCompile,
    listen,
    reportProgress,
    router,
    serverStarted: serverStarted.promise,
    startOptions,
    storybookServer,
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

  it.each([
    [undefined, 1],
    [false, 1],
    [true, 0],
  ])('logs the early URL based on quiet=%s', async (quiet, expectedCount) => {
    const { completeCompile, serverStarted, startOptions } = createStartHarness(
      {
        autoComplete: false,
        quiet,
      },
    )

    const result = start(startOptions)
    await serverStarted
    await Promise.resolve()
    const loggedBeforeCompile = mocks.loggerInfo.mock.calls.length
    completeCompile()
    await result

    expect(loggedBeforeCompile).toBe(expectedCount)
    expect(mocks.loggerInfo).toHaveBeenCalledTimes(expectedCount)
    if (expectedCount > 0) {
      expect(mocks.loggerInfo).toHaveBeenCalledWith(
        expect.stringContaining('http://localhost:6006/'),
      )
    }
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

  it('does not emit an unhandled rejection when listen fails before bail', async () => {
    const listenError = Object.assign(new Error('Address already in use'), {
      code: 'EADDRINUSE',
    })
    const { startOptions } = createStartHarness({
      autoComplete: false,
      listenError,
    })

    await expect(start(startOptions)).rejects.toBe(listenError)

    const unhandledRejection = rs.fn()
    const emit = process.emit.bind(process) as (...args: unknown[]) => boolean
    const emitSpy = rs.spyOn(process, 'emit').mockImplementation(((
      event: string | symbol,
      ...args: unknown[]
    ) => {
      if (event === 'unhandledRejection') {
        unhandledRejection(...args)
        return true
      }
      return emit(event, ...args)
    }) as typeof process.emit)

    try {
      await bail()
      await new Promise<void>((resolve) => setImmediate(resolve))

      expect(unhandledRejection).not.toHaveBeenCalled()
    } finally {
      emitSpy.mockRestore()
    }
  })

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

  it('closes the early-listening server when bailing after a compilation error', async () => {
    const { startOptions, storybookServer } = createStartHarness({
      stats: createStats({ errors: [compilationError] }),
    })

    await expect(start(startOptions)).rejects.toBeInstanceOf(
      WebpackCompilationError,
    )
    await bail()

    expect(storybookServer.close).toHaveBeenCalledTimes(1)
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
