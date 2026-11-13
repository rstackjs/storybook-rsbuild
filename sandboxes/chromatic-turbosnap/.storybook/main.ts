// Adapted from chromatic-cli e2e fixtures (MIT), commit f744971ec44e03fd4fef4d2e2fcadf2fefb04627:
//   e2e/fixtures/react-rsbuild and e2e/fixtures/monorepo-pnpm
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
  // MDX is included so TurboSnap story files are not only `*.stories.*`.
  stories: ['../src/**/*.mdx', '../src/**/*.stories.tsx'],
  addons: ['@storybook/addon-docs'],
  framework: {
    name: getAbsolutePath('storybook-react-rsbuild'),
    options: {},
  },
}

export default config
