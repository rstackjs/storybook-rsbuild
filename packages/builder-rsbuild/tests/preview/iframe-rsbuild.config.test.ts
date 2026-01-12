import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Rspack } from '@rsbuild/core'
import { describe, expect, it, vi } from 'vitest'
import type { RsbuildBuilderOptions } from '../../src/preview/iframe-rsbuild.config'
import createIframeRsbuildConfig from '../../src/preview/iframe-rsbuild.config'

const fixtureDir = fileURLToPath(new URL('../fixtures/', import.meta.url))
const fixtureRsbuildConfig = resolve(fixtureDir, 'rsbuild.config.ts')

const storybookEntries = ['storybook-entry.js']
const storiesConfig = [
  {
    directory: './stories',
    files: '*.stories.tsx',
    titlePrefix: '',
  },
]

type LazyCompilationOption = Rspack.Configuration['lazyCompilation']

const createOptions = (
  lazyCompilation: LazyCompilationOption | 'unset' = false,
) => {
  const builderCoreOptions: Record<string, unknown> = {
    rsbuildConfigPath: fixtureRsbuildConfig,
    addonDocs: {},
    fsCache: false,
    ...(lazyCompilation === 'unset' ? {} : { lazyCompilation }),
  }

  const presetValues = new Map<string, unknown>([
    [
      'core',
      {
        builder: {
          name: 'storybook-builder-rsbuild',
          options: builderCoreOptions,
        },
      },
    ],
    ['framework', {}],
    ['frameworkOptions', { renderer: '@storybook/react' }],
    ['env', { STORYBOOK_ENV: 'development' }],
    ['logLevel', 'info'],
    ['previewHead', '<!-- head -->'],
    ['previewBody', '<!-- body -->'],
    [
      'previewMainTemplate',
      '<!DOCTYPE html><html><head></head><body><div id="root"></div></body></html>',
    ],
    ['docs', {}],
    ['entries', storybookEntries],
    ['stories', storiesConfig],
    ['tags', {}],
    ['build', { test: {} }],
    ['previewAnnotations', []],
  ])

  const apply = vi.fn(
    async (name: string, defaultValue?: unknown): Promise<unknown> => {
      if (name === 'mdxLoaderOptions') {
        return defaultValue
      }

      if (presetValues.has(name)) {
        return presetValues.get(name)
      }

      return defaultValue
    },
  )

  const cache = {
    get: vi.fn((_key: string, fallback: number) => fallback),
  } as unknown as Required<RsbuildBuilderOptions>['cache']

  const options: Partial<RsbuildBuilderOptions> = {
    configType: 'DEVELOPMENT',
    quiet: true,
    outputDir: 'storybook-static',
    packageJson: { version: '8.0.0-test' },
    presets: {
      apply:
        apply as unknown as Required<RsbuildBuilderOptions>['presets']['apply'],
    },
    previewUrl: 'http://localhost:6006/iframe.html',
    typescriptOptions: {
      check: false,
      skipCompiler: true,
    },
    features: {},
    cache,
    configDir: fixtureDir,
    build: {},
  }

  return { options, apply }
}

describe('iframe-rsbuild.config', () => {
  it('overrides rsbuild source.entry with Storybook entry', async () => {
    const { options } = createOptions()

    const config = await createIframeRsbuildConfig(
      options as RsbuildBuilderOptions,
    )

    const expectedDynamicEntry = resolve(
      process.cwd(),
      'storybook-config-entry.js',
    )

    expect(config.source?.entry).toEqual({
      main: [storybookEntries[0], expectedDynamicEntry],
    })
  })

  const runRspackTool = async (
    lazyCompilation: LazyCompilationOption | 'unset',
  ) => {
    const { options } = createOptions(lazyCompilation)
    const config = await createIframeRsbuildConfig(
      options as RsbuildBuilderOptions,
    )

    const rspackTool = config.tools?.rspack
    expect(typeof rspackTool).toBe('function')

    const baseConfig = {} as any

    return (rspackTool as any)(baseConfig, {
      addRules: vi.fn(),
      rspack: {
        experiments: {
          VirtualModulesPlugin: class VirtualModulesPlugin {},
        },
        ProvidePlugin: class ProvidePlugin {},
      },
      mergeConfig: (c: any) => c,
    }) as any
  }

  it('uses entries:false when lazyCompilation is unset', async () => {
    const rspackConfig = await runRspackTool('unset')
    expect(rspackConfig.lazyCompilation).toEqual({ entries: false })
  })

  it('disables lazyCompilation when set to false', async () => {
    const rspackConfig = await runRspackTool(false)
    expect(rspackConfig.lazyCompilation).toBe(false)
  })

  it('passes through lazyCompilation when set to true', async () => {
    const rspackConfig = await runRspackTool(true)
    expect(rspackConfig.lazyCompilation).toBe(true)
  })

  it('passes through lazyCompilation options object', async () => {
    const rspackConfig = await runRspackTool({ entries: true })
    expect(rspackConfig.lazyCompilation).toEqual({ entries: true })
  })
})
