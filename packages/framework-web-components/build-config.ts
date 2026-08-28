import type { BuildEntries } from 'storybook-rsbuild-scripts/create-rslib-config'

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
        dts: false,
      },
      {
        exportEntries: ['./node'],
        entryPoint: './src/node/index.ts',
      },
    ],
  },
}

export default config
