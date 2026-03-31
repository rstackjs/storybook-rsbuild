import { describe, expect, it, rs } from '@rstest/core'
import { bail, executor, onModuleGraphChange, start } from '../src/index'

rs.mock('../src/react-shims', () => ({
  applyReactShims: rs.fn(async (config: unknown) => config),
}))

type DevCompileDoneCallback = (params: {
  stats: {
    compilation: unknown
  }
  isFirstCompile: boolean
}) => void

const createModule = (file: string, type = 'javascript/auto') => ({
  type,
  nameForCondition: () => file,
})

const createCompilation = () => {
  const story = createModule('/repo/src/Button.stories.tsx')
  const component = createModule('/repo/src/Button.tsx')

  return {
    modules: new Set([story, component]),
    moduleGraph: {
      getIncomingConnections(module: typeof component) {
        return module === component
          ? [{ originModule: story, resolvedModule: component }]
          : []
      },
      getOutgoingConnections(module: typeof component) {
        return module === story
          ? [{ originModule: story, resolvedModule: component }]
          : []
      },
    },
  }
}

const waitFor = async (predicate: () => boolean) => {
  const startedAt = Date.now()
  while (!predicate()) {
    if (Date.now() - startedAt > 1_000) {
      throw new Error('Timed out waiting for predicate')
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

const createStartArgs = () => {
  const presetValues = new Map<string, unknown>([
    [
      'core',
      {
        builder: {
          name: 'storybook-builder-rsbuild',
          options: {
            addonDocs: {},
            fsCache: false,
            lazyCompilation: false,
          },
        },
      },
    ],
    ['framework', {}],
    ['frameworkOptions', { renderer: '@storybook/react' }],
    ['env', {}],
    ['logLevel', 'info'],
    [
      'previewMainTemplate',
      '<!DOCTYPE html><html><head></head><body><div id="root"></div></body></html>',
    ],
    ['previewHead', ''],
    ['previewBody', ''],
    ['docs', {}],
    ['entries', []],
    [
      'stories',
      [
        {
          directory: './stories',
          files: '*.stories.tsx',
          titlePrefix: '',
        },
      ],
    ],
    ['previewAnnotations', []],
    ['tags', {}],
    ['build', { test: {} }],
  ])

  return {
    startTime: process.hrtime(),
    options: {
      host: '127.0.0.1',
      configType: 'DEVELOPMENT',
      configDir: process.cwd(),
      quiet: true,
      outputDir: 'storybook-static',
      packageJson: { version: '8.0.0-test' },
      presets: {
        apply: rs.fn(async (name: string, defaultValue?: unknown) => {
          if (name === 'mdxLoaderOptions' || name === 'typescript') {
            return defaultValue ?? {}
          }

          return presetValues.get(name) ?? defaultValue
        }),
      },
      previewUrl: 'http://localhost:6006/iframe.html',
      typescriptOptions: {
        check: false,
        skipCompiler: true,
      },
      features: {},
      build: {},
    } as never,
    router: {
      use: rs.fn(),
    } as never,
    server: {} as never,
  }
}

describe('onModuleGraphChange', () => {
  it('notifies listeners after dev recompiles and unsubscribes on bail', async () => {
    const callbacks: DevCompileDoneCallback[] = []
    const createDevServer = rs.fn(async () => ({
      middlewares: {},
      connectWebSocket: rs.fn(),
      afterListen: rs.fn(async () => undefined),
      close: rs.fn(async () => undefined),
    }))

    executor.get = rs.fn(async () => ({
      createRsbuild: rs.fn(async () => ({
        createDevServer,
        onDevCompileDone: (cb: DevCompileDoneCallback) => {
          callbacks.push(cb)
        },
      })),
    }))

    const listener = rs.fn()
    onModuleGraphChange(listener)

    const started = start(createStartArgs())
    await waitFor(() => callbacks.length > 0)

    callbacks[0]?.({
      stats: { compilation: createCompilation() },
      isFirstCompile: true,
    })
    await started
    listener.mockClear()

    callbacks[0]?.({
      stats: { compilation: createCompilation() },
      isFirstCompile: false,
    })

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0]?.[0].has('/repo/src/Button.tsx')).toBe(true)

    await bail()

    callbacks[0]?.({
      stats: { compilation: createCompilation() },
      isFirstCompile: false,
    })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('merges graphs from multi-stats payloads', async () => {
    const callbacks: DevCompileDoneCallback[] = []
    const createDevServer = rs.fn(async () => ({
      middlewares: {},
      connectWebSocket: rs.fn(),
      afterListen: rs.fn(async () => undefined),
      close: rs.fn(async () => undefined),
    }))

    executor.get = rs.fn(async () => ({
      createRsbuild: rs.fn(async () => ({
        createDevServer,
        onDevCompileDone: (cb: DevCompileDoneCallback) => {
          callbacks.push(cb)
        },
      })),
    }))

    const listener = rs.fn()
    onModuleGraphChange(listener)

    const started = start(createStartArgs())
    await waitFor(() => callbacks.length > 0)

    callbacks[0]?.({
      stats: {
        stats: [
          { compilation: createCompilation() },
          {
            compilation: {
              modules: new Set([createModule('/repo/src/Extra.tsx')]),
              moduleGraph: {
                getIncomingConnections() {
                  return []
                },
                getOutgoingConnections() {
                  return []
                },
              },
            },
          },
        ],
      },
      isFirstCompile: true,
    } as never)
    await started

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0]?.[0].has('/repo/src/Button.tsx')).toBe(true)
    expect(listener.mock.calls[0]?.[0].has('/repo/src/Extra.tsx')).toBe(true)

    await bail()
  })
})
