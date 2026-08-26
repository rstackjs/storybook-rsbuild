import type { Rspack } from '@rsbuild/core'
import { afterEach, beforeEach, describe, expect, it, rs } from '@rstest/core'
import { PREVIEW_BUILDER_PROGRESS } from 'storybook/internal/core-events'
import { NoStatsForViteDevError } from 'storybook/internal/server-errors'
import { bail, printDuration, start } from '../src/index'
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

const createStartHarness = ({
  compiler = {} as Rspack.Compiler,
  startTime = process.hrtime(),
}: {
  compiler?: Rspack.Compiler | Rspack.MultiCompiler
  startTime?: [number, number]
} = {}) => {
  let progress: ProgressHandler | undefined
  const channel = { emit: rs.fn() }
  const devServer = {
    close: rs.fn(),
    connectWebSocket: rs.fn(),
    middlewares: rs.fn(),
  }
  const router = { use: rs.fn() }
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
    presetValues: new Map([
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
    server: {},
    startTime,
  } as unknown as Parameters<typeof start>[0]

  return {
    applyProgressPlugin,
    channel,
    reportProgress,
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
  it('resolves without waiting for the first compilation', async () => {
    const { startOptions } = createStartHarness()

    const result = await start(startOptions)

    expect(() => result.stats?.toJson()).toThrow(NoStatsForViteDevError)
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
