import path from 'node:path'
import { fileURLToPath } from 'node:url'
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
  stories: ['../src/**/*.stories.@(js|jsx|mjs|ts|tsx)'],
  addons: ['@storybook/addon-docs'],
  framework: {
    name: getAbsolutePath('storybook-next-rsbuild'),
    options: {},
  },
  staticDirs: ['../public'],
}

export default config
