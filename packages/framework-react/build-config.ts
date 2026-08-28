import type { BuildEntries } from '@storybook/scripts/create-rslib-config'

const config: BuildEntries = {
  entries: {
    browser: [
      {
        exportEntries: ['.'],
        entryPoint: './src/index.ts',
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
      {
        exportEntries: ['./loaders/react-docgen-loader'],
        entryPoint: './src/loaders/react-docgen-loader.ts',
      },
    ],
  },
}

export default config
