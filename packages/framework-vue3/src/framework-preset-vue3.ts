import { mergeRsbuildConfig, type RsbuildConfig } from '@rsbuild/core'
import { deprecate } from 'storybook/internal/node-logger'
import {
  resolveDocgenContext,
  VUE_COMPONENT_META,
  VUE_DOCGEN_API_DEPRECATION,
} from './docgen/options'
import {
  vueComponentMeta,
  type VueDocgenEngine,
} from './plugins/vue-component-meta'
import type { StorybookConfig } from './types'

const rsbuildFinalDoc: StorybookConfig['rsbuildFinal'] = async (
  _config,
  options,
): Promise<RsbuildConfig> => {
  const { docgen, docgenServerActive } = await resolveDocgenContext(options)

  // Server-side docgen (features.experimentalDocgenServer) extracts docgen for every
  // `docgen` value through the @storybook/vue3 docgen worker; skip the loader to avoid double docgen.
  if (docgen === false || docgenServerActive) {
    return {}
  }
  const engine = await options.presets.apply<VueDocgenEngine>(
    'experimental_vueDocgenEngine',
  )

  if (docgen.plugin === VUE_COMPONENT_META) {
    return { plugins: [await vueComponentMeta(engine, docgen.tsconfig)] }
  }

  deprecate(VUE_DOCGEN_API_DEPRECATION)

  // Intentional divergence: keep the documented legacy addon-docs vueDocgenOptions user channel.
  // A future sync must not remove this scan.
  // https://github.com/storybookjs/storybook/blob/0f8be9ce02f2e2d8d8730b8b3c7fecb61edc1fd7/code/addons/docs/docs/frameworks/VUE3.md
  let vueDocgenOptions = {}

  for (const preset of options.presetsList || []) {
    if (preset.name.includes('addon-docs') && preset.options.vueDocgenOptions) {
      const appendableOptions = preset.options.vueDocgenOptions
      vueDocgenOptions = {
        ...vueDocgenOptions,
        ...appendableOptions,
      }
    }
  }

  return {
    tools: {
      rspack: (config, { mergeConfig }) => {
        return mergeConfig(config, {
          module: {
            rules: [
              {
                test: /\.vue$/,
                loader: require.resolve('vue-docgen-loader', {
                  // paths: [require.resolve('@storybook/preset-vue3-webpack')],
                }),
                enforce: 'post',
                options: {
                  docgenOptions: {
                    alias: config.resolve?.alias,
                    ...vueDocgenOptions,
                  },
                },
              },
            ],
          },
        })
      },
    },
  }
}

const rsbuildFinalBase: StorybookConfig['rsbuildFinal'] = (
  _config,
  _options,
): RsbuildConfig => {
  return {
    resolve: {
      alias: {
        // https://github.com/fengyuanchen/vue-feather/issues/8
        // Port https://github.com/storybookjs/storybook/blob/4224713c21c1f1ada8aca68db1b855dfad7f6975/code/presets/vue3-webpack/src/framework-preset-vue3.ts#L59.
        vue$: require.resolve('vue/dist/vue.esm-bundler.js'),
      },
    },
  }
}

export const rsbuildFinal: StorybookConfig['rsbuildFinal'] = async (
  config,
  options,
) => {
  return mergeRsbuildConfig(
    config,
    rsbuildFinalBase(config, options),
    await rsbuildFinalDoc(config, options),
  )
}
