import { resolve } from 'node:path'
import { describe, expect, it } from '@rstest/core'
import type { RsbuildBuilderOptions } from './iframe-rsbuild.config'
import createIframeRsbuildConfig from './iframe-rsbuild.config'

const fixtureDir = resolve(__dirname, '../../tests/fixtures')
const fixtureRsbuildConfig = resolve(fixtureDir, 'rsbuild.config.ts')
const minifyDisabledRsbuildConfig = resolve(
  fixtureDir,
  'minify-disabled-rsbuild.config.ts',
)

const createOptions = ({
  configType,
  developmentModeForBuild = false,
  disableSourcemaps = false,
  rsbuildConfigPath = fixtureRsbuildConfig,
}: {
  configType: 'DEVELOPMENT' | 'PRODUCTION'
  developmentModeForBuild?: boolean
  disableSourcemaps?: boolean
  rsbuildConfigPath?: string
}) => {
  const presetValues = new Map<string, unknown>([
    [
      'core',
      {
        builder: {
          name: 'storybook-builder-rsbuild',
          options: {
            rsbuildConfigPath,
            addonDocs: {},
            fsCache: false,
            lazyCompilation: false,
          },
        },
      },
    ],
    ['frameworkOptions', {}],
    ['env', {}],
    ['logLevel', 'info'],
    ['previewHead', ''],
    ['previewBody', ''],
    [
      'previewMainTemplate',
      '<!doctype html><html><body><div id="root"></div></body></html>',
    ],
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
    ['build', { test: { disableSourcemaps } }],
    ['tags', {}],
    ['typescript', { check: false, skipCompiler: true }],
  ])

  const options: Partial<RsbuildBuilderOptions> = {
    configType,
    quiet: true,
    outputDir: 'storybook-static',
    packageJson: { version: '10.5.10-test' },
    presets: {
      apply: (async (name: string, defaultValue?: unknown) =>
        presetValues.has(name) ? presetValues.get(name) : defaultValue) as any,
    },
    previewUrl: 'http://localhost:6006/iframe.html',
    typescriptOptions: {
      check: false,
      skipCompiler: true,
    },
    features: { developmentModeForBuild },
    cache: {
      get: async (_key: string, fallback: number) => fallback,
    } as RsbuildBuilderOptions['cache'],
    configDir: fixtureDir,
    build: { test: { disableSourcemaps } },
  }

  return options as RsbuildBuilderOptions
}

describe('production build output', () => {
  it('preserves function names and keeps source maps gated', async () => {
    const config = await createIframeRsbuildConfig(
      createOptions({
        configType: 'PRODUCTION',
        disableSourcemaps: true,
      }),
    )

    expect(config.output?.minify).toMatchObject({
      jsOptions: {
        minimizerOptions: {
          compress: {
            keep_fnames: true,
          },
          mangle: false,
        },
      },
    })
    expect(config.output?.sourceMap).toEqual({
      js: false,
      css: false,
    })
  })

  it('preserves an inherited production minification opt-out', async () => {
    const config = await createIframeRsbuildConfig(
      createOptions({
        configType: 'PRODUCTION',
        rsbuildConfigPath: minifyDisabledRsbuildConfig,
      }),
    )

    expect(config.output?.minify).toBe(false)
  })

  it('defines process.env.NODE_ENV only for production builds', async () => {
    const productionConfig = await createIframeRsbuildConfig(
      createOptions({
        configType: 'PRODUCTION',
        developmentModeForBuild: true,
      }),
    )

    expect(productionConfig.source?.define?.['process.env.NODE_ENV']).toBe(
      JSON.stringify('development'),
    )

    const developmentConfig = await createIframeRsbuildConfig(
      createOptions({
        configType: 'DEVELOPMENT',
        developmentModeForBuild: true,
      }),
    )

    expect(developmentConfig.source?.define?.['process.env.NODE_ENV']).toBe(
      JSON.stringify(process.env.NODE_ENV),
    )
  })
})
