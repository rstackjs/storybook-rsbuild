import type { RsbuildPlugin, Rspack } from '@rsbuild/core'
import { fileURLToPath } from 'node:url'
import { RspackInjectMockerRuntimePlugin } from './rspack-inject-mocker-runtime-plugin'
import { AUTOMOCK_QUERY_MARKER, RspackMockPlugin } from './rspack-mock-plugin'

/**
 * Rules selecting the automock loader for modules marked by `RspackMockPlugin`.
 *
 * DIVERGES FROM UPSTREAM — upstream injects the automock loader as an inline
 * `loader?spy=...!resource` request and re-resolves it in `afterResolve`. Rspack cannot
 * re-resolve there, so `beforeResolve` appends a marker query and these post rules apply
 * the loader. `enforce: 'post'` puts it after swc/normal loaders and before other post
 * loaders such as export-order-loader, matching upstream's inline loader position.
 * https://github.com/storybookjs/storybook/blob/bc5ae1af0f074bf2b81e3ab64ab07f0237937e2d/code/builders/builder-webpack5/src/plugins/webpack-mock-plugin.ts#L101-L106
 */
export function createAutomockRules(loader: string): Rspack.RuleSetRule[] {
  return [
    {
      resourceQuery: new RegExp(`${AUTOMOCK_QUERY_MARKER}&spy=true`),
      enforce: 'post',
      use: [{ loader, options: { spy: 'true' } }],
    },
    {
      resourceQuery: new RegExp(`${AUTOMOCK_QUERY_MARKER}&spy=false`),
      enforce: 'post',
      use: [{ loader, options: { spy: 'false' } }],
    },
  ]
}

function getAutomockRules() {
  const loader = fileURLToPath(
    import.meta
      .resolve('storybook-builder-rsbuild/loaders/rsbuild-automock-loader'),
  )
  return createAutomockRules(loader)
}

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
        addRules([
          {
            test: /preview\.(t|j)sx?$/,
            use: [
              {
                loader: fileURLToPath(
                  import.meta
                    .resolve('storybook-builder-rsbuild/loaders/storybook-mock-transform-loader'),
                ),
              },
            ],
          },
          ...getAutomockRules(),
        ])

        appendPlugins([
          new RspackMockPlugin({ previewConfigPath }),
          new RspackInjectMockerRuntimePlugin(),
        ])
      })
    },
  }
}
