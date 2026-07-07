import type { BuildEntries } from '../../scripts/build/utils/entry-utils'

const config: BuildEntries = {
  // Raw JS files that bypass the bundler — they run in the user's Storybook
  // build and must resolve `next` from the user's project, not ours.
  extraOutputs: {
    './empty-module': './loaders/empty-module.cjs',
    './image-context': {
      types: './loaders/image-context.d.cts',
      default: './loaders/image-context.cjs',
    },
    './next-image-loader-stub': './loaders/next-image-loader-stub.cjs',
    './next-image-mock': './loaders/next-image-mock.js',
    './storybook-nextjs-font-loader':
      './loaders/storybook-nextjs-font-loader.cjs',
    './react-refresh-entry': './loaders/react-refresh-entry.cjs',
    './swc-loader-shim': './loaders/swc-loader-shim.cjs',
  },
  entries: {
    browser: [
      {
        exportEntries: ['.'],
        entryPoint: './src/index.ts',
      },
      {
        exportEntries: ['./preview'],
        entryPoint: './src/preview.tsx',
      },
      {
        exportEntries: ['./config/preview'],
        entryPoint: './src/config/preview.ts',
      },
      {
        exportEntries: ['./navigation.mock'],
        entryPoint: './src/export-mocks/navigation/index.ts',
      },
      {
        exportEntries: ['./router.mock'],
        entryPoint: './src/export-mocks/router/index.ts',
      },
      {
        exportEntries: ['./cache.mock'],
        entryPoint: './src/export-mocks/cache/index.ts',
      },
      {
        exportEntries: ['./headers.mock'],
        entryPoint: './src/export-mocks/headers/index.ts',
      },
    ],
    node: [
      {
        exportEntries: ['./preset'],
        entryPoint: './src/preset.ts',
      },
      {
        exportEntries: ['./node'],
        entryPoint: './src/node/index.ts',
      },
    ],
  },
}

export default config
