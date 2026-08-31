// Tests the headless Rsbuild ChangeDetectionAdapter used by consumers without a dev server (the
// `storybook tools` CLI): resolve config comes from a development-mode serverless compiler over the
// same assembly the dev server uses, and file watching is a no-op.
import { fileURLToPath } from 'node:url'
import { createRsbuild, type RsbuildConfig, type Rspack } from '@rsbuild/core'
import { describe, expect, it, rs } from '@rstest/core'
import type { Options } from 'storybook/internal/types'
import {
  createHeadlessRsbuildChangeDetectionAdapter,
  type HeadlessRsbuildDependencies,
} from './headless'
import { createRspackChangeDetectionAdapter } from './index'

function closeCompiler(
  compiler: Rspack.Compiler | Rspack.MultiCompiler,
): Promise<void> {
  return new Promise((resolve, reject) => {
    compiler.close((error) => {
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    })
  })
}

function createOptions(): Options {
  return {} as Options
}

function createDependencies() {
  const close = rs.fn((callback: (error?: Error) => void) => callback())
  const compiler = {
    context: '/repo',
    options: {
      resolve: {
        alias: { '@': '/repo/src' },
        conditionNames: ['import', 'module', 'default'],
      },
    },
    close,
  }
  const createCompiler = rs.fn(async () => compiler)
  const createRsbuildMock = rs.fn(async () => ({ createCompiler }))
  const config: RsbuildConfig = { resolve: { alias: {} } }
  const getConfig = rs.fn(async () => config)
  const getRsbuild = rs.fn(async () => ({
    createRsbuild:
      createRsbuildMock as unknown as typeof import('@rsbuild/core').createRsbuild,
  }))

  return {
    close,
    compiler,
    createCompiler,
    createRsbuildMock,
    dependencies: {
      getConfig,
      getRsbuild,
    } satisfies HeadlessRsbuildDependencies,
    getConfig,
    getRsbuild,
  }
}

describe('createHeadlessRsbuildChangeDetectionAdapter', () => {
  it('resolves the same three fields the compiler-bound adapter snapshots', async () => {
    const { close, dependencies } = createDependencies()
    const options = createOptions()

    const adapter = createHeadlessRsbuildChangeDetectionAdapter(
      options,
      dependencies,
    )
    const config = await adapter.getResolveConfig()

    expect(config).toEqual({
      projectRoot: '/repo',
      alias: { '@': '/repo/src' },
      conditions: ['import', 'module', 'default'],
    })
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('assembles config like the dev server in development mode', async () => {
    const { createRsbuildMock, dependencies, getConfig, getRsbuild } =
      createDependencies()
    const options = createOptions()

    const adapter = createHeadlessRsbuildChangeDetectionAdapter(
      options,
      dependencies,
    )
    await adapter.getResolveConfig()

    expect(getRsbuild).toHaveBeenCalledWith(options)
    expect(getConfig).toHaveBeenCalledWith(options)
    expect(createRsbuildMock).toHaveBeenCalledWith({
      cwd: process.cwd(),
      rsbuildConfig: {
        resolve: { alias: {} },
        mode: 'development',
      },
    })
  })

  it('onFileChange is a no-op that still returns an unsubscribe function', () => {
    const adapter = createHeadlessRsbuildChangeDetectionAdapter(
      createOptions(),
      createDependencies().dependencies,
    )
    const handler = rs.fn()

    const unsubscribe = adapter.onFileChange(handler)

    expect(handler).not.toHaveBeenCalled()
    expect(typeof unsubscribe).toBe('function')
    expect(() => unsubscribe()).not.toThrow()
  })

  it('matches the compiler-bound adapter after real Rspack normalisation', async () => {
    const options = createOptions()
    const rsbuildConfig: RsbuildConfig = {
      source: {
        entry: {
          index: fileURLToPath(import.meta.url),
        },
      },
      resolve: {
        alias: {
          '@': '/repo/src',
        },
      },
      tools: {
        rspack(config) {
          config.resolve ??= {}
          config.resolve.conditionNames = [
            'storybook',
            'stories',
            'test',
            '...',
          ]
          return config
        },
      },
    }
    const dependencies: HeadlessRsbuildDependencies = {
      getConfig: async () => rsbuildConfig,
      getRsbuild: async () => ({ createRsbuild }),
    }
    const headlessAdapter = createHeadlessRsbuildChangeDetectionAdapter(
      options,
      dependencies,
    )

    const liveRsbuild = await createRsbuild({
      cwd: process.cwd(),
      rsbuildConfig: {
        ...rsbuildConfig,
        mode: 'development',
      },
    })
    const liveCompiler = await liveRsbuild.createCompiler()
    const previewCompiler =
      'compilers' in liveCompiler ? liveCompiler.compilers[0] : liveCompiler

    try {
      const liveAdapter = createRspackChangeDetectionAdapter(previewCompiler)
      const [headlessConfig, liveConfig] = await Promise.all([
        headlessAdapter.getResolveConfig(),
        liveAdapter.getResolveConfig(),
      ])

      expect(headlessConfig).toEqual(liveConfig)
      expect(headlessConfig.conditions).not.toContain('...')
    } finally {
      await closeCompiler(liveCompiler)
    }
  })
})
