import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Rspack } from '@rsbuild/core'
import { describe, expect, it, rs } from '@rstest/core'
import type { RsbuildBuilderOptions } from '../../src/preview/iframe-rsbuild.config'
import createIframeRsbuildConfig from '../../src/preview/iframe-rsbuild.config'

const fixtureDir = resolve(__dirname, '../fixtures')
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
  configType: 'DEVELOPMENT' | 'PRODUCTION' = 'DEVELOPMENT',
  addons: unknown[] = [],
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
    ['addons', addons],
  ])

  const apply = rs.fn(
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
    get: rs.fn((_key: string, fallback: number) => fallback),
  } as unknown as Required<RsbuildBuilderOptions>['cache']

  const options: Partial<RsbuildBuilderOptions> = {
    configType,
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

const createOptionsWithoutCache = (
  lazyCompilation: LazyCompilationOption | 'unset' = false,
) => {
  const { options, apply } = createOptions(lazyCompilation)

  delete options.cache

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

  it('does not require cache from storybook options', async () => {
    const { options } = createOptionsWithoutCache()

    const config = await createIframeRsbuildConfig(
      options as RsbuildBuilderOptions,
    )

    expect(config.source?.entry).toBeDefined()
  })

  const runRspackTool = async (
    lazyCompilation: LazyCompilationOption | 'unset',
    addons: unknown[] = [],
  ) => {
    const { options } = createOptions(lazyCompilation, 'DEVELOPMENT', addons)
    const config = await createIframeRsbuildConfig(
      options as RsbuildBuilderOptions,
    )

    const rspackTool = config.tools?.rspack
    expect(typeof rspackTool).toBe('function')

    const baseConfig = {} as any
    const addRules = rs.fn()
    const appendRules = rs.fn()

    const result = (rspackTool as any)(baseConfig, {
      addRules,
      appendRules,
      rspack: {
        experiments: {
          VirtualModulesPlugin: class VirtualModulesPlugin {},
        },
        ProvidePlugin: class ProvidePlugin {},
      },
      mergeConfig: (c: any) => c,
    }) as any

    return { rspackConfig: result, addRules, appendRules }
  }

  it('uses entries:false when lazyCompilation is unset', async () => {
    const { rspackConfig } = await runRspackTool('unset')
    expect(rspackConfig.lazyCompilation).toEqual({ entries: false })
  })

  it('disables lazyCompilation when set to false', async () => {
    const { rspackConfig } = await runRspackTool(false)
    expect(rspackConfig.lazyCompilation).toBe(false)
  })

  it('passes through lazyCompilation when set to true', async () => {
    const { rspackConfig } = await runRspackTool(true)
    expect(rspackConfig.lazyCompilation).toBe(true)
  })

  it('passes through lazyCompilation options object', async () => {
    const { rspackConfig } = await runRspackTool({ entries: true })
    expect(rspackConfig.lazyCompilation).toEqual({ entries: true })
  })

  // MSW's Service Worker races with the dev-server lazy-compilation RPC and
  // leaves the preview iframe blank on cold story loads. Default-off when the
  // addon is present; respect an explicit user override.
  it('disables lazyCompilation when msw-storybook-addon is present and option is unset', async () => {
    const { rspackConfig } = await runRspackTool('unset', [
      'msw-storybook-addon',
    ])
    expect(rspackConfig.lazyCompilation).toBe(false)
  })

  it('respects explicit lazyCompilation even when msw-storybook-addon is present', async () => {
    const { rspackConfig } = await runRspackTool({ entries: true }, [
      'msw-storybook-addon',
    ])
    expect(rspackConfig.lazyCompilation).toEqual({ entries: true })
  })

  it('detects msw-storybook-addon when referenced via absolute path or object form', async () => {
    const { rspackConfig } = await runRspackTool('unset', [
      '/abs/path/to/node_modules/msw-storybook-addon',
      { name: 'some-other-addon', options: {} },
    ])
    expect(rspackConfig.lazyCompilation).toBe(false)
  })

  it('appends raw query fallback rule for asset/source imports', async () => {
    const { appendRules } = await runRspackTool(false)

    expect(appendRules).toHaveBeenCalledTimes(1)
    expect(appendRules).toHaveBeenCalledWith({
      resourceQuery: /[?&]raw(?:&|=|$)/,
      type: 'asset/source',
    })
  })

  // Regression tests for assetPrefix — guards against #66, #72, #75, #224.
  // The default assetPrefix must be '' (empty string) to produce relative paths,
  // enabling subpath/CDN deployment without manual config (#224).
  // Using '/' caused absolute paths that break non-root deployments.
  // See HANDOFF.md "Failed Approaches" for the full regression chain.
  describe('assetPrefix defaults to empty string for subpath deployment (#224)', () => {
    it('sets output.assetPrefix to empty string in dev mode (#72)', async () => {
      const { options } = createOptions(false, 'DEVELOPMENT')
      const config = await createIframeRsbuildConfig(
        options as RsbuildBuilderOptions,
      )
      expect(config.output?.assetPrefix).toBe('')
    })

    it('sets dev.assetPrefix to empty string in dev mode (#72)', async () => {
      const { options } = createOptions(false, 'DEVELOPMENT')
      const config = await createIframeRsbuildConfig(
        options as RsbuildBuilderOptions,
      )
      expect(config.dev?.assetPrefix).toBe('')
    })

    it('sets output.assetPrefix to empty string in production mode (#224)', async () => {
      const { options } = createOptions(false, 'PRODUCTION')
      const config = await createIframeRsbuildConfig(
        options as RsbuildBuilderOptions,
      )
      expect(config.output?.assetPrefix).toBe('')
    })
  })

  // Regression test for preview.ejs template — guards against #75 and #23481 (webpack5).
  // - Relative paths (default assetPrefix: '') must get './' prefix so they resolve
  //   correctly in subdirectory deployments.
  // - Absolute/root-relative URLs must NOT get './' prefix.
  describe('preview.ejs handles import paths correctly', () => {
    it('prepends "./" only for bare relative paths, preserves absolute and root-relative URLs', () => {
      const templatePath = resolve(__dirname, '../../templates/preview.ejs')
      const template = readFileSync(templatePath, 'utf-8')

      // Must contain conditional logic that adds './' only for relative paths
      expect(template).toContain('"./" + file')
      // Must use a regex that matches http(s)://, //, and root-relative /
      expect(template).toMatch(/\^.https.*\\\//)
    })
  })
})
