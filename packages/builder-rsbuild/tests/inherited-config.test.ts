import type { RsbuildConfig } from '@rsbuild/core'
import { describe, expect, it, rs } from '@rstest/core'
import { logger } from 'storybook/internal/node-logger'
import { stripInheritedConfig } from '../src/inherited-config'

const inheritedConfig = (): RsbuildConfig =>
  ({
    source: {
      entry: { index: './src/index.ts' },
    },
    output: {
      distPath: { root: 'dist' },
      filename: { js: '[name].js' },
      cleanDistPath: true,
      externals: ['react'],
      assetPrefix: '/assets/',
    },
    server: {
      publicDir: { name: 'public' },
    },
    dev: {
      progressBar: true,
      assetPrefix: '/dev-assets/',
      writeToDisk: true,
    },
    plugins: [{ name: 'inherited-plugin', setup() {} }],
    tools: {
      htmlPlugin: false,
      rspack: [
        {
          output: {
            library: { name: 'Library', type: 'umd' },
            globalObject: 'this',
            umdNamedDefine: true,
            uniqueName: 'keep-me',
          },
        },
        (config: unknown) => config,
      ],
    },
  }) as unknown as RsbuildConfig

describe('stripInheritedConfig', () => {
  it('strips every field in the inherited config boundary', () => {
    const config = inheritedConfig()
    const warn = rs.spyOn(logger, 'warn').mockImplementation(() => {})

    const strippedFields = stripInheritedConfig(config, 'a test config')

    expect(strippedFields).toEqual([
      'source.entry',
      'output.distPath',
      'output.filename',
      'output.cleanDistPath',
      'output.externals',
      'output.assetPrefix',
      'server.publicDir',
      'dev.progressBar',
      'dev.assetPrefix',
      'dev.writeToDisk',
      'tools.htmlPlugin',
      'tools.rspack.output.library',
      'tools.rspack.output.globalObject',
      'tools.rspack.output.umdNamedDefine',
    ])
    expect(config.source?.entry).toBeUndefined()
    expect(config.output?.distPath).toBeUndefined()
    expect(config.output?.filename).toBeUndefined()
    expect(config.output?.cleanDistPath).toBeUndefined()
    expect(config.output?.externals).toBeUndefined()
    expect(config.output?.assetPrefix).toBeUndefined()
    expect(config.server?.publicDir).toBeUndefined()
    expect(config.dev?.progressBar).toBeUndefined()
    expect(config.dev?.assetPrefix).toBeUndefined()
    expect(config.dev?.writeToDisk).toBeUndefined()
    expect(config.plugins).toEqual([
      expect.objectContaining({ name: 'inherited-plugin' }),
    ])
    expect(config.tools?.htmlPlugin).toBeUndefined()
    expect(config.tools?.rspack).toEqual([
      { output: { uniqueName: 'keep-me' } },
      expect.any(Function),
    ])
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(
      `Stripped incompatible fields from a test config (${strippedFields.join(', ')}) because they can break the Storybook preview build.`,
    )
  })
})
