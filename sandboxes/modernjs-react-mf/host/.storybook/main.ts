import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { StorybookConfig } from 'storybook-react-rsbuild'
import moduleFederationConfig from '../module-federation.config.ts'

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
    {
      // For this repo, you can use `storybook-addon-modernjs` directly.
      name: getAbsolutePath('storybook-addon-modernjs'),
      options: {},
    },
    {
      name: '@module-federation/storybook-addon',
      options: {
        remotes: moduleFederationConfig.remotes,
      },
    },
  ],
  framework: {
    // For this repo, you can use `storybook-react-rsbuild` directly.
    name: getAbsolutePath('storybook-react-rsbuild'),
    options: {},
  },
  typescript: {
    reactDocgen: 'react-docgen-typescript',
    reactDocgenTypescriptOptions: {
      shouldExtractLiteralValuesFromEnum: true,
      shouldRemoveUndefinedFromOptional: true,
      propFilter: () => true,
    },
    check: true,
  },
}

export default config
