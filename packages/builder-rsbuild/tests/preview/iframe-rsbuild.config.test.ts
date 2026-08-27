import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  mergeRsbuildConfig,
  type RsbuildConfig,
  type Rspack,
} from '@rsbuild/core'
import { describe, expect, it, rs } from '@rstest/core'
import { getConfig } from '../../src/index'
import type { RsbuildBuilderOptions } from '../../src/preview/iframe-rsbuild.config'
import createIframeRsbuildConfig from '../../src/preview/iframe-rsbuild.config'

const fixtureDir = resolve(__dirname, '../fixtures')
const fixtureRsbuildConfig = resolve(fixtureDir, 'rsbuild.config.ts')
const minifyCustomRsbuildConfig = resolve(
  fixtureDir,
  'minify-custom-rsbuild.config.ts',
)
const minifyDisabledRsbuildConfig = resolve(
  fixtureDir,
  'minify-disabled-rsbuild.config.ts',
)
const inheritanceBoundaryRsbuildConfig = resolve(
  fixtureDir,
  'inheritance-boundary-rsbuild.config.ts',
)
const singleEnvironmentRsbuildConfig = resolve(
  fixtureDir,
  'single-environment-rsbuild.config.ts',
)

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
  staticDirs: unknown = [],
  builderOptionOverrides: Record<string, unknown> = {},
  developmentModeForBuild = false,
  disableSourcemaps = false,
  rsbuildFinal?: (config: RsbuildConfig) => RsbuildConfig,
) => {
  const builderCoreOptions: Record<string, unknown> = {
    rsbuildConfigPath: fixtureRsbuildConfig,
    addonDocs: {},
    fsCache: false,
    ...(lazyCompilation === 'unset' ? {} : { lazyCompilation }),
    ...builderOptionOverrides,
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
    ['frameworkOptions', { renderer: '@storybook/react', legacyRootApi: true }],
    [
      'env',
      {
        STORYBOOK_ENV: 'development',
        STORYBOOK_SECOND_ENV: 'defined-per-key',
        NODE_PATH: ['/workspace/shared', '/workspace/generated'],
      },
    ],
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
    ['build', { test: { disableSourcemaps } }],
    ['previewAnnotations', []],
    ['staticDirs', staticDirs],
    ['typescript', { check: false, skipCompiler: true }],
  ])

  const apply = rs.fn(
    async (name: string, defaultValue?: unknown): Promise<unknown> => {
      if (name === 'rsbuildFinal' && rsbuildFinal) {
        return rsbuildFinal(defaultValue as RsbuildConfig)
      }

      if (name === 'mdxLoaderOptions') {
        return defaultValue
      }

      if (presetValues.has(name)) {
        return presetValues.get(name)
      }

      return defaultValue
    },
  )

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
    features: { developmentModeForBuild },
    configDir: fixtureDir,
    build: { test: { disableSourcemaps } },
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

  it('defines process.env as an object while preserving per-key user defines', async () => {
    const { options } = createOptions()

    const config = await createIframeRsbuildConfig(
      options as RsbuildBuilderOptions,
    )

    expect(config.source?.define).toMatchObject({
      'process.env': `(${JSON.stringify({
        STORYBOOK_ENV: 'development',
        STORYBOOK_SECOND_ENV: 'defined-per-key',
        NODE_PATH: ['/workspace/shared', '/workspace/generated'],
      })})`,
      'process.env.STORYBOOK_ENV': JSON.stringify('user-defined'),
      'process.env.STORYBOOK_SECOND_ENV': JSON.stringify('defined-per-key'),
    })
  })

  it('strips library output fields that are incompatible with the preview build', async () => {
    const { options } = createOptions(false, 'DEVELOPMENT', [], {
      rsbuildConfigPath: inheritanceBoundaryRsbuildConfig,
    })

    const config = await createIframeRsbuildConfig(
      options as RsbuildBuilderOptions,
    )
    const rspackConfigs = Array.isArray(config.tools?.rspack)
      ? config.tools.rspack
      : [config.tools?.rspack]
    const inheritedRspackConfig = rspackConfigs.find(
      (item) => typeof item === 'object' && item.output?.uniqueName,
    )

    expect(inheritedRspackConfig).toBeDefined()
    expect(inheritedRspackConfig).not.toHaveProperty('output.library')
    expect(inheritedRspackConfig).not.toHaveProperty('output.globalObject')
    expect(inheritedRspackConfig).not.toHaveProperty('output.umdNamedDefine')
    expect(config.tools?.htmlPlugin).not.toBe(false)
    expect(config.dev?.writeToDisk).toBeUndefined()
  })

  it('inherits plugins from the loaded Rsbuild config', async () => {
    const { options } = createOptions(false, 'DEVELOPMENT', [], {
      rsbuildConfigPath: inheritanceBoundaryRsbuildConfig,
    })

    const config = await createIframeRsbuildConfig(
      options as RsbuildBuilderOptions,
    )

    expect(config.plugins).toContainEqual(
      expect.objectContaining({ name: 'write-build-id' }),
    )
    expect(config.plugins).toContainEqual(
      expect.objectContaining({ name: 'keep-for-storybook' }),
    )
  })

  it('inherits config from a single named Rsbuild environment', async () => {
    const { options } = createOptions(false, 'DEVELOPMENT', [], {
      rsbuildConfigPath: singleEnvironmentRsbuildConfig,
    })

    const config = await createIframeRsbuildConfig(
      options as RsbuildBuilderOptions,
    )

    expect(config.resolve?.alias).toMatchObject({
      'single-environment-alias': './single-environment-target.ts',
    })
  })

  it('preserves config explicitly restored by rsbuildFinal', async () => {
    const explicitPlugin = { name: 'explicit-plugin', setup() {} }
    const { options } = createOptions(
      false,
      'DEVELOPMENT',
      [],
      { rsbuildConfigPath: inheritanceBoundaryRsbuildConfig },
      false,
      false,
      (config) =>
        mergeRsbuildConfig(config, {
          output: { externals: ['explicit-external'] },
          plugins: [explicitPlugin],
        }),
    )

    const config = await getConfig(options as RsbuildBuilderOptions)

    expect(config.output?.externals).toContain('explicit-external')
    expect(config.plugins).toContain(explicitPlugin)
  })

  const runRspackTool = async (
    lazyCompilation: LazyCompilationOption | 'unset',
    staticDirs: unknown = [],
    baseConfig: Rspack.Configuration = {},
  ) => {
    const { options } = createOptions(
      lazyCompilation,
      'DEVELOPMENT',
      staticDirs,
    )
    const config = await createIframeRsbuildConfig(
      options as RsbuildBuilderOptions,
    )

    const rspackTool = config.tools?.rspack
    expect(typeof rspackTool).toBe('function')

    const addRules = rs.fn()
    const appendRules = rs.fn()
    let virtualModules: Record<string, string> = {}

    const result = (rspackTool as any)(baseConfig, {
      addRules,
      appendRules,
      rspack: {
        experiments: {
          VirtualModulesPlugin: class VirtualModulesPlugin {
            constructor(modules: Record<string, string>) {
              virtualModules = modules
            }
          },
        },
        ProvidePlugin: class ProvidePlugin {},
      },
      mergeConfig: (c: any) => c,
    }) as any

    return { rspackConfig: result, addRules, appendRules, virtualModules }
  }

  const runSwcTool = async (
    swcConfig: Record<string, any>,
    babelRemoveBugfixes = false,
  ) => {
    const { options } = createOptions()
    options.features = {
      ...options.features,
      babelRemoveBugfixes,
    } as typeof options.features
    const config = await createIframeRsbuildConfig(
      options as RsbuildBuilderOptions,
    )

    const swcTool = config.tools?.swc
    expect(typeof swcTool).toBe('function')
    ;(swcTool as any)(swcConfig)

    return swcConfig
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

  it('disables pipelined imports when MSW disables default lazyCompilation', async () => {
    const mswStaticDir = resolve(fixtureDir, 'msw-active/public')
    const { rspackConfig, virtualModules } = await runRspackTool('unset', [
      mswStaticDir,
    ])
    const storiesModule =
      virtualModules[resolve(process.cwd(), 'storybook-stories.js')]

    expect(rspackConfig.lazyCompilation).toBe(false)
    expect(storiesModule).toContain('const pipeline = (x) => x();')
    expect(storiesModule).not.toContain('const importPipeline =')
  })

  it('handles bare Markdown imports as source assets', async () => {
    const { addRules } = await runRspackTool(false)

    expect(addRules).toHaveBeenCalledWith(
      expect.arrayContaining([
        {
          test: /\.md$/,
          type: 'asset/source',
        },
      ]),
    )
  })

  it('relaxes strict ESM resolution for JavaScript modules', async () => {
    const { addRules } = await runRspackTool(false)

    expect(addRules).toHaveBeenCalledWith(
      expect.arrayContaining([
        {
          test: /\.m?js$/,
          type: 'javascript/auto',
        },
        {
          test: /\.m?js$/,
          resolve: {
            fullySpecified: false,
          },
        },
      ]),
    )
  })

  it('resolves modules from NODE_PATH', async () => {
    const { rspackConfig } = await runRspackTool(false)

    expect(rspackConfig.resolve.modules).toEqual([
      'node_modules',
      '/workspace/shared',
      '/workspace/generated',
    ])
  })

  it('enables side-effects analysis in development', async () => {
    const { rspackConfig } = await runRspackTool(false)

    expect(rspackConfig.optimization.sideEffects).toBe(true)
  })

  it.each([false, 'flag'] as const)(
    'preserves user-provided side-effects analysis value %s',
    async (sideEffects) => {
      const { rspackConfig } = await runRspackTool(false, [], {
        optimization: { sideEffects },
      })

      expect(rspackConfig.optimization.sideEffects).toBe(sideEffects)
    },
  )

  it('merges fallback defaults without overriding user values', async () => {
    const { rspackConfig } = await runRspackTool(false, [], {
      resolve: {
        fallback: {
          assert: 'user-assert',
          custom: 'user-custom',
        },
      },
    })

    expect(rspackConfig.resolve.fallback).toMatchObject({
      crypto: false,
      stream: false,
      path: expect.any(String),
      assert: 'user-assert',
      util: expect.any(String),
      url: expect.any(String),
      fs: false,
      constants: expect.any(String),
      custom: 'user-custom',
    })
  })

  it('preserves a user-provided SWC bugfixes value', async () => {
    const swcConfig = await runSwcTool({
      env: {
        targets: ['chrome >= 100'],
        bugfixes: false,
      },
    })

    expect(swcConfig.env).toEqual({
      targets: ['chrome >= 100'],
      bugfixes: false,
    })
  })

  it('omits the SWC bugfixes default when the feature opts out', async () => {
    const swcConfig = await runSwcTool(
      {
        env: {
          targets: ['chrome >= 100'],
        },
      },
      true,
    )

    expect(swcConfig.env).toEqual({
      targets: ['chrome >= 100'],
    })
  })

  it('appends raw query fallback rule for asset/source imports', async () => {
    const { appendRules } = await runRspackTool(false)

    expect(appendRules).toHaveBeenCalledTimes(1)
    expect(appendRules).toHaveBeenCalledWith({
      resourceQuery: /[?&]raw(?:&|=|$)/,
      type: 'asset/source',
    })
  })

  describe('production build output', () => {
    it('preserves function names and keeps source maps gated', async () => {
      const { options } = createOptions(
        false,
        'PRODUCTION',
        [],
        {},
        false,
        true,
      )
      const config = await createIframeRsbuildConfig(
        options as RsbuildBuilderOptions,
      )

      expect(config.output?.minify).toMatchObject({
        jsOptions: {
          minimizerOptions: {
            compress: {
              keep_fnames: true,
            },
            mangle: {
              keep_classnames: true,
              keep_fnames: true,
            },
          },
        },
      })
      expect(config.output?.sourceMap).toEqual({
        js: false,
        css: false,
      })
    })

    it('preserves an inherited production minification opt-out', async () => {
      const { options } = createOptions(false, 'PRODUCTION', [], {
        rsbuildConfigPath: minifyDisabledRsbuildConfig,
      })
      const config = await createIframeRsbuildConfig(
        options as RsbuildBuilderOptions,
      )

      expect(config.output?.minify).toBe(false)
    })

    it('preserves inherited custom JavaScript minification options', async () => {
      const { options } = createOptions(false, 'PRODUCTION', [], {
        rsbuildConfigPath: minifyCustomRsbuildConfig,
      })
      const config = await createIframeRsbuildConfig(
        options as RsbuildBuilderOptions,
      )

      expect(config.output?.minify).toEqual({
        jsOptions: {
          minimizerOptions: {
            compress: false,
          },
        },
      })
    })

    it('defines process.env.NODE_ENV only for production builds', async () => {
      const { options: productionOptions } = createOptions(
        false,
        'PRODUCTION',
        [],
        {},
        true,
      )
      const productionConfig = await createIframeRsbuildConfig(
        productionOptions as RsbuildBuilderOptions,
      )

      expect(productionConfig.source?.define?.['process.env.NODE_ENV']).toBe(
        JSON.stringify('development'),
      )

      const { options: developmentOptions } = createOptions(
        false,
        'DEVELOPMENT',
        [],
        {},
        true,
      )
      const developmentConfig = await createIframeRsbuildConfig(
        developmentOptions as RsbuildBuilderOptions,
      )

      expect(developmentConfig.source?.define?.['process.env.NODE_ENV']).toBe(
        JSON.stringify(process.env.NODE_ENV),
      )
    })
  })

  // Regression tests for assetPrefix — guards against #66, #72, #75, #224.
  // The default assetPrefix must be '' (empty string) to produce relative paths,
  // enabling subpath/CDN deployment without manual config (#224).
  // Using '/' caused absolute paths that break non-root deployments.
  // '' only works with a flat output layout, which the distPath tests below
  // lock in (#522).
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

  // Regression tests for the flat output layout — guards against #522 (and #28).
  // Restoring Rsbuild's nested defaults (static/js, static/js/async, static/css)
  // reintroduces #522: relative chunk URLs get resolved against the worker script
  // or the CSS file instead of the document, producing paths such as
  // /static/js/async/static/js/async/<id>.iframe.bundle.js. Asserted as a whole
  // object so a newly added nesting key fails the test instead of slipping past.
  describe('flattens output.distPath so assetPrefix "" resolves everywhere (#522)', () => {
    const flatDistPath = {
      root: resolve(process.cwd(), 'storybook-static'),
      js: '',
      jsAsync: '',
      css: '',
      cssAsync: '',
      svg: '',
      font: '',
      image: '',
      media: '',
      wasm: '',
      assets: '',
    }

    for (const configType of ['DEVELOPMENT', 'PRODUCTION'] as const) {
      it(`sets every output.distPath key to '' in ${configType.toLowerCase()} mode`, async () => {
        const { options } = createOptions(false, configType)
        const config = await createIframeRsbuildConfig(
          options as RsbuildBuilderOptions,
        )

        expect(config.output?.distPath).toEqual(flatDistPath)
      })
    }
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
