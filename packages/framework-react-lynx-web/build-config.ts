import type { BuildEntries } from '../../scripts/build/utils/entry-utils'

const config: BuildEntries = {
  entries: {
    browser: [
      {
        exportEntries: ['.'],
        entryPoint: './src/index.ts',
      },
      {
        exportEntries: ['./preview'],
        entryPoint: './src/preview.ts',
      },
      {
        exportEntries: ['./preview-runtime'],
        entryPoint: './src/preview-runtime.ts',
        dts: false,
      },
      {
        exportEntries: ['./runtime'],
        entryPoint: './src/runtime.ts',
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
