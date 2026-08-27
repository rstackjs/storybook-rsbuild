import { defineConfig } from '@rsbuild/core'

export default defineConfig({
  source: {
    define: {
      'process.env.STORYBOOK_ENV': JSON.stringify('user-defined'),
    },
    entry: {
      custom: ['./user-defined-entry.js'],
    },
  },
})
