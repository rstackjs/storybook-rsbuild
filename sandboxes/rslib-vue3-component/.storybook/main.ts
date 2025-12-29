import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mergeRsbuildConfig } from '@rsbuild/core'
import { pluginVue } from '@rsbuild/plugin-vue'
import type { StorybookConfig } from 'storybook-vue3-rsbuild'

const getAbsolutePath = (value: string): any => {
  return path.resolve(
    fileURLToPath(
      new URL(import.meta.resolve(`${value}/package.json`, import.meta.url)),
    ),
    '..',
  )
}

const config: StorybookConfig = {
  stories: ['../stories/*.mdx', '../stories/*.stories.@(js|jsx|mjs|ts|tsx)'],
  addons: [
    '@storybook/addon-onboarding',
    '@storybook/addon-docs',
    '@chromatic-com/storybook',
    {
      name: getAbsolutePath('storybook-addon-rslib') as any,
      options: {
        rslib: {
          include: ['**/stories/**'],
        },
      },
    },
  ],
  framework: {
    name: getAbsolutePath('storybook-vue3-rsbuild') as any,
    options: {},
  },
  rsbuildFinal: (config) => {
    // Since HMR for Rspack is not supported by unplugin-vue as of now (https://github.com/unplugin/unplugin-vue/issues/162),
    // it's better to remove rsbuild-plugin-unplugin-vue and use @rsbuild/plugin-vue to handle all Vue files.
    const filteredPlugins = (config.plugins || []).filter((p) => {
      if (p && 'name' in p) {
        return p.name !== 'plugin-unplugin-vue'
      }
      return true
    })
    return mergeRsbuildConfig(
      { ...config, plugins: filteredPlugins },
      {
        plugins: [pluginVue()],
      },
    )
  },
}

export default config
