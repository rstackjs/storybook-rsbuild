import path from 'node:path'
import { fileURLToPath } from 'node:url'
import remarkGfm from 'remark-gfm'
import type { StorybookConfig } from 'storybook-react-rsbuild'

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
  addons: [
    '@storybook/addon-onboarding',
    {
      name: '@storybook/addon-docs',
      options: {
        mdxPluginOptions: {
          mdxCompileOptions: {
            remarkPlugins: [remarkGfm],
          },
        },
      },
    },
    '@chromatic-com/storybook',
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
    // Disabled: this sandbox pins @types/react@16, but Storybook 10.4.x declares
    // @types/react as a peer, so its types resolve against @types/react@18/19 and
    // collide with 16 in one TS program (TS2786 on React.StrictMode). A React 16
    // fixture can't type-align with a React 18-typed framework; the build itself
    // still validates the stories at runtime.
    check: false,
  },
  staticDirs: ['../public'],
}

export default config
