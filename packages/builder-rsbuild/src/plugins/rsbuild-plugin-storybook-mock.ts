import { fileURLToPath } from 'node:url'
import type { RsbuildConfig, RsbuildPlugin } from '@rsbuild/core'
import { RspackInjectMockerRuntimePlugin } from './rspack-inject-mocker-runtime-plugin'
import { RspackMockPlugin } from './rspack-mock-plugin'

export function pluginStorybookMock({
  previewConfigPath,
}: {
  previewConfigPath: string
}): RsbuildPlugin {
  return {
    name: 'storybook:mock',
    setup(api) {
      api.modifyRsbuildConfig((config) => {
        const applyMockingToRspack: NonNullable<
          RsbuildConfig['tools']
        >['rspack'] = (rspackConfig, utils) => {
          const mockTransformRule = {
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
          }
          utils.addRules(mockTransformRule)

          // Rsbuild's utils target the config from before tools.rspack reduction, so a prior
          // replacement callback requires adding the rule to the current config as well.
          if (!rspackConfig.module?.rules?.includes(mockTransformRule)) {
            rspackConfig.module ??= {}
            rspackConfig.module.rules ??= []
            rspackConfig.module.rules.unshift(mockTransformRule)
          }

          rspackConfig.plugins ??= []
          rspackConfig.plugins.push(
            new RspackMockPlugin({ previewConfigPath }),
            new RspackInjectMockerRuntimePlugin(),
          )

          return rspackConfig
        }
        const toolsRspack = config.tools?.rspack

        return {
          ...config,
          tools: {
            ...config.tools,
            rspack: Array.isArray(toolsRspack)
              ? [...toolsRspack, applyMockingToRspack]
              : toolsRspack
                ? [toolsRspack, applyMockingToRspack]
                : [applyMockingToRspack],
          },
        }
      })
    },
  }
}
