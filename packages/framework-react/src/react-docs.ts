import type { RsbuildConfig } from '@rsbuild/core'
import { mergeRsbuildConfig } from '@rsbuild/core'
import { requirer } from './requirer'
import type { StorybookConfig } from './types'

export const rsbuildFinalDocs: NonNullable<
  StorybookConfig['rsbuildFinal']
> = async (config, options): Promise<RsbuildConfig> => {
  const features = await options.presets.apply('features', {})
  if (features?.experimentalDocgenServer) {
    // The docgen service owns React metadata extraction for this mode. Do not inject
    // `Component.__docgenInfo` into the preview bundle, otherwise preview argTypes would include
    // docgen data that the UI is now responsible for merging from the service.
    return config
  }

  const typescriptOptions = await options.presets.apply('typescript', {} as any)
  const debug = options.loglevel === 'debug'

  const { reactDocgen, reactDocgenTypescriptOptions } = typescriptOptions || {}

  if (typeof reactDocgen !== 'string') {
    return config
  }

  //#region react-docgen
  if (reactDocgen !== 'react-docgen-typescript') {
    return mergeRsbuildConfig(config, {
      tools: {
        rspack: {
          module: {
            rules: [
              {
                test: /\.(cjs|mjs|tsx?|jsx?)$/,
                enforce: 'pre',
                loader: requirer(
                  require.resolve,
                  'storybook-react-rsbuild/loaders/react-docgen-loader',
                ),
                options: {
                  debug,
                },
                exclude: /(\.(stories|story)\.(js|jsx|ts|tsx))|(node_modules)/,
              },
            ],
          },
        },
      },
    })
  }
  //#endregion

  //#region react-docgen-typescript
  let typescriptPresent: boolean
  try {
    require.resolve('typescript')
    typescriptPresent = true
  } catch (_e) {
    typescriptPresent = false
  }

  if (reactDocgen === 'react-docgen-typescript' && typescriptPresent) {
  }

  const reactDocGenTsPlugin = await import('./plugins/react-docgen-typescript')

  // TODO: Rspack doesn't support the hooks `react-docgen-typescript`' required.
  // Currently, using `transform` hook to implement the same behavior.
  return mergeRsbuildConfig(config, {
    plugins: [
      await reactDocGenTsPlugin.default({
        ...reactDocgenTypescriptOptions,
        // We *need* this set so that RDT returns default values in the same format as react-docgen
        savePropValueAsString: true,
      }),
    ],
  })
  //#endregion

  //#region webpack flavor react-docgen-typescript implementation, lacking support for hooks.
  // it's now superseded by the `transform` hook implementation of Vite flavor.

  // const { ReactDocgenTypeScriptPlugin } = await import(
  //   '@storybook/react-docgen-typescript-plugin'
  // )

  // const { reactDocgenTypescriptOptions } = typescriptOptions || {}

  // return mergeRsbuildConfig(config, {
  //   tools: {
  //     rspack: {
  //       module: {
  //         rules: [
  //           {
  //             test: /\.(cjs|mjs|jsx?)$/,
  //             enforce: 'pre',
  //             loader: requirer(
  //               require.resolve,
  //               'storybook-react-rsbuild/loaders/react-docgen-loader',
  //             ),
  //             options: {
  //               debug,
  //             },
  //             exclude: /(\.(stories|story)\.(js|jsx|ts|tsx))|(node_modules)/,
  //           },
  //         ],
  //       },
  //       plugins: [
  //         new ReactDocgenTypeScriptPlugin({
  //           ...reactDocgenTypescriptOptions,
  //           // We *need* this set so that RDT returns default values in the same format as react-docgen
  //           savePropValueAsString: true,
  //         }),
  //       ],
  //     },
  //   },
  // })
  //#endregion
}
