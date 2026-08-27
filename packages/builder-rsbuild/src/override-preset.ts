import { fileURLToPath } from 'node:url'
import type { RsbuildConfig } from '@rsbuild/core'
import { findConfigFile } from 'storybook/internal/common'
import type { Options } from 'storybook/internal/types'
import { RspackInjectMockerRuntimePlugin } from './plugins/rspack-inject-mocker-runtime-plugin'
import { RspackMockPlugin } from './plugins/rspack-mock-plugin'

export async function rsbuildFinal(
  config: RsbuildConfig,
  options: Options,
): Promise<RsbuildConfig> {
  const previewConfigPath = findConfigFile('preview', options.configDir)

  if (!previewConfigPath) {
    return config
  }

  const applyMocking: NonNullable<RsbuildConfig['tools']>['rspack'] = (
    rspackConfig,
    utils,
  ) => {
    utils.addRules({
      test: /preview\.(t|j)sx?$/,
      use: [
        {
          loader: fileURLToPath(
            import.meta.resolve(
              'storybook-builder-rsbuild/loaders/storybook-mock-transform-loader',
            ),
          ),
        },
      ],
    })

    rspackConfig.plugins ??= []
    rspackConfig.plugins.push(new RspackMockPlugin({ previewConfigPath }))
    rspackConfig.plugins.push(new RspackInjectMockerRuntimePlugin())

    return rspackConfig
  }

  return {
    ...config,
    tools: {
      ...config.tools,
      rspack: Array.isArray(config.tools?.rspack)
        ? [...config.tools.rspack, applyMocking]
        : [config.tools?.rspack, applyMocking].filter(
            <T>(v: T): v is NonNullable<T> => Boolean(v),
          ),
    },
  }
}
