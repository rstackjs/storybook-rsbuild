import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mergeRsbuildConfig } from '@rsbuild/core'
import { pluginBabel } from '@rsbuild/plugin-babel'
import type { StorybookConfig } from 'storybook-react-native-web-rsbuild'

const getAbsolutePath = (value: string): string => {
  return path.resolve(
    fileURLToPath(
      new URL(import.meta.resolve(`${value}/package.json`), import.meta.url),
    ),
    '..',
  )
}

// Resolve nativewind to absolute path for proper alias resolution in pnpm monorepos
const nativewindPath = getAbsolutePath('nativewind')

const config: StorybookConfig = {
  stories: ['../src/**/*.mdx', '../src/**/*.stories.@(js|jsx|mjs|ts|tsx)'],
  addons: ['@storybook/addon-docs'],
  framework: {
    name: getAbsolutePath(
      'storybook-react-native-web-rsbuild',
    ) as 'storybook-react-native-web-rsbuild',
    options: {
      pluginOptions: {
        // Set jsxImportSource for nativewind
        jsxImportSource: 'nativewind',
        // Include modules that need transpilation for web support
        modulesToTranspile: [
          'nativewind',
          'react-native-css-interop',
          'react-native-reanimated',
        ],
      },
    },
  },
  rsbuildFinal: (config) => {
    // Add alias for nativewind to ensure it can be resolved from anywhere
    // This is needed because react-native-reanimated (in modulesToTranspile)
    // gets its JSX transformed to use nativewind/jsx-runtime, but can't resolve
    // nativewind from deep within pnpm's .pnpm directory structure
    return mergeRsbuildConfig(config, {
      resolve: {
        alias: {
          nativewind: nativewindPath,
        },
      },
      plugins: [
        pluginBabel({
          // KEY: Only transform src files to avoid transforming Rsbuild internals
          // Use [\\/] to match both Unix (/) and Windows (\) path separators
          include: /[\\/]src[\\/]/,
          babelLoaderOptions: {
            presets: ['@babel/preset-typescript', 'nativewind/babel'],
            plugins: ['@babel/plugin-proposal-export-namespace-from'],
          },
        }),
      ],
    })
  },
}

export default config
