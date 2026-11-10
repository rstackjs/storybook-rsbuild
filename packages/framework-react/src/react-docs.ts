import type { RsbuildConfig } from '@rsbuild/core'
import { mergeRsbuildConfig } from '@rsbuild/core'
import {
  isReactBuilderDocgenPackageInstalled,
  prepareReactBuilderDocgen,
  type ReactDocgenConfig,
} from './builder-docgen'
import { requirer } from './requirer'
import type { StorybookConfig } from './types'

/** Resolve from this package, which declares the builder docgen packages as optional peers. */
const resolve = (specifier: string) => import.meta.resolve(specifier)

export const rsbuildFinalDocs: NonNullable<
  StorybookConfig['rsbuildFinal']
> = async (config, options): Promise<RsbuildConfig> => {
  const features = await options.presets.apply('features', {})
  if (features?.docgenServer) {
    // The docgen service owns React metadata extraction for this mode. Do not inject
    // `Component.__docgenInfo` into the preview bundle, otherwise preview argTypes would include
    // docgen data that the UI is now responsible for merging from the service.
    return config
  }

  const typescriptOptions = await options.presets.apply<{
    reactDocgen?: ReactDocgenConfig
    reactDocgenTypescriptOptions?: Record<string, unknown>
  }>('typescript', {})
  const debug = options.loglevel === 'debug'

  const { reactDocgen, reactDocgenTypescriptOptions } = typescriptOptions || {}

  if (typeof reactDocgen !== 'string') {
    return config
  }

  const reactDocgenLoaderRule = (test: RegExp) => ({
    test,
    enforce: 'pre' as const,
    loader: requirer(
      require.resolve,
      'storybook-react-rsbuild/loaders/react-docgen-loader',
    ),
    options: {
      debug,
    },
    exclude: /(\.(stories|story)\.(js|jsx|ts|tsx))|(node_modules)/,
  })

  // Builder docgen packages are optional peers: the loader and plugin import them only once
  // builder docgen runs, so projects on the docgen server never resolve them.
  // https://github.com/storybookjs/storybook/blob/4b5e9a60c55c6d3659ffa3118881b8904b41c021/code/presets/react-webpack/src/framework-preset-react-docs.ts#L39-L50
  const mode = await prepareReactBuilderDocgen({
    reactDocgen,
    resolve,
    options,
  })
  if (!mode) {
    return config
  }
  const useReactDocgenTypescript = mode === 'react-docgen-typescript'

  //#region react-docgen
  if (!useReactDocgenTypescript) {
    return mergeRsbuildConfig(config, {
      tools: {
        rspack: {
          module: {
            rules: [reactDocgenLoaderRule(/\.(cjs|mjs|tsx?|jsx?)$/)],
          },
        },
      },
    })
  }
  //#endregion

  //#region react-docgen-typescript
  const reactDocGenTsPlugin = await import('./plugins/react-docgen-typescript')

  // TODO: Rspack doesn't support the hooks `react-docgen-typescript`' required.
  // Currently, using `transform` hook to implement the same behavior.
  return mergeRsbuildConfig(config, {
    tools: {
      rspack: {
        module: {
          // The vendored react-docgen-typescript plugin only matches `**/**.tsx`, so non-TS
          // files still need plain react-docgen. In this mode react-docgen is optional.
          // @see https://github.com/storybookjs/storybook/blob/4b5e9a60c55c6d3659ffa3118881b8904b41c021/code/presets/react-webpack/src/framework-preset-react-docs.ts#L77-L92
          rules: isReactBuilderDocgenPackageInstalled(resolve, 'react-docgen')
            ? [reactDocgenLoaderRule(/\.(cjs|mjs|jsx?)$/)]
            : [],
        },
      },
    },
    plugins: [
      reactDocGenTsPlugin.default({
        ...reactDocgenTypescriptOptions,
        // We *need* this set so that RDT returns default values in the same format as react-docgen
        savePropValueAsString: true,
      }),
    ],
  })
  //#endregion

  //#region webpack flavor react-docgen-typescript implementation, lacking support for hooks.
  // it's now superseded by the `transform` hook implementation of Vite flavor.

  // Reference only: `@storybook/react-docgen-typescript-plugin` is not a dependency of this package.
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
