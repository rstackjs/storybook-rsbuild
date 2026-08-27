import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mergeRsbuildConfig } from '@rsbuild/core'
import { pluginSass } from '@rsbuild/plugin-sass'
import type { StorybookConfig } from 'storybook-next-rsbuild'

const getAbsolutePath = (value: string): any => {
  return path.resolve(
    fileURLToPath(
      new URL(import.meta.resolve(`${value}/package.json`, import.meta.url)),
    ),
    '..',
  )
}

const config: StorybookConfig = {
  stories: ['../src/**/*.mdx', '../src/**/*.stories.@(js|jsx|mjs|ts|tsx)'],
  addons: ['@storybook/addon-docs'],
  framework: {
    name: getAbsolutePath('storybook-next-rsbuild'),
    // Forward next.config webpack() plugins (e.g. DefinePlugin) into the build.
    options: { forwardNextConfigPlugins: true },
  },
  staticDirs: ['../public'],
  // Sass for the .module.scss story.
  rsbuildFinal: (config) =>
    mergeRsbuildConfig(config, { plugins: [pluginSass()] }),
  // Hand .svg to the SVGR rule added via next.config.webpack() by excluding it
  // from Rsbuild's default asset rule.
  webpackFinal: async (config) => {
    for (const rule of config.module?.rules ?? []) {
      if (
        rule &&
        typeof rule === 'object' &&
        rule.test instanceof RegExp &&
        rule.test.test('probe.svg') &&
        Array.isArray(rule.oneOf)
      ) {
        const prev = (rule as any).exclude
        ;(rule as any).exclude = Array.isArray(prev)
          ? [...prev, /\.svg$/]
          : prev
            ? [prev, /\.svg$/]
            : /\.svg$/
      }
    }
    return config
  },
}

export default config
