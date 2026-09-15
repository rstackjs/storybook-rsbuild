import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { StorybookConfig } from 'storybook-web-components-rsbuild'

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
  framework: {
    name: getAbsolutePath('storybook-web-components-rsbuild'),
    options: {},
  },
}

export default config
