import type { BuildEntries } from '@storybook/scripts/create-rslib-config'

const config: BuildEntries = {
  entries: {
    browser: [],
    node: [
      {
        exportEntries: ['.'],
        entryPoint: './src/index.ts',
      },
    ],
  },
}

export default config
