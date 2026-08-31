import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { StorybookConfig } from 'storybook-react-rsbuild'

const getAbsolutePath = (value: string): string => {
  return path.resolve(
    fileURLToPath(
      new URL(import.meta.resolve(`${value}/package.json`, import.meta.url)),
    ),
    '..',
  )
}

const config: StorybookConfig = {
  stories: ['../src/**/*.mdx', '../src/**/*.stories.@(js|jsx|mjs|ts|tsx)'],
  addons: [
    '@storybook/addon-onboarding',
    '@storybook/addon-docs',
    '@chromatic-com/storybook',
  ],
  webpackAddons: [
    {
      name: getAbsolutePath('@storybook/addon-coverage'),
      options: {
        istanbul: {
          include: ['src/**/*.stories.@(js|jsx|ts|tsx|mdx)'],
          exclude: [],
        },
      },
    },
  ],
  framework: {
    name: getAbsolutePath('storybook-react-rsbuild'),
    options: {
      builder: {
        lazyCompilation: true,
      },
    },
  },
  docs: {
    defaultName: 'Docs',
    docsMode: false,
  },
  typescript: {
    reactDocgen: 'react-docgen',
    check: true,
  },
  staticDirs: ['../public'],
}

export default config
