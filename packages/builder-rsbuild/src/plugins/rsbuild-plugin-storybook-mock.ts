import type { RsbuildPlugin } from '@rsbuild/core'
import { fileURLToPath } from 'node:url'
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
      // NOTE: A tools.rspack function returning a replacement config silently drops this wiring.
      // That pattern is unsupported; mutate the provided config or merge it instead (see docs).
      api.modifyRspackConfig((_config, { addRules, appendPlugins }) => {
        addRules({
          test: /preview\.(t|j)sx?$/,
          use: [
            {
              loader: fileURLToPath(
                import.meta
                  .resolve('storybook-builder-rsbuild/loaders/storybook-mock-transform-loader'),
              ),
            },
          ],
        })

        appendPlugins([
          new RspackMockPlugin({ previewConfigPath }),
          new RspackInjectMockerRuntimePlugin(),
        ])
      })
    },
  }
}
