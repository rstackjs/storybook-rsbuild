import type { OnAfterDevCompileFn, Rspack } from '@rsbuild/core'
import { afterEach, beforeEach, describe, expect, it, rs } from '@rstest/core'
import { PREVIEW_BUILDER_PROGRESS } from 'storybook/internal/core-events'
import { WebpackCompilationError } from 'storybook/internal/server-errors'
import { bail, type Stats, start } from '../src/index'
import { createTestOptions } from './fixtures/options'

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
}: {
  stats?: CompileStats
  compiler?: Rspack.Compiler | Rspack.MultiCompiler
} = {}) => {
  let progress: ProgressHandler | undefined

  const channel = { emit: rs.fn() }
  const devServer = {
    afterListen: rs.fn(),
    close: rs.fn(),
    connectWebSocket: rs.fn(),
    middlewares: rs.fn(),
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
      queueMicrotask(() => {
        void handler({
          environments: {},
          isFirstCompile: true,
          stats,
        })
      })
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
  })
  const startOptions = {
    channel,
    options,
    router: { use: rs.fn() },
    server: {},
    startTime: process.hrtime(),
  } as unknown as Parameters<typeof start>[0]

  return { applyProgressPlugin, channel, startOptions }
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

describe('start', () => {
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
