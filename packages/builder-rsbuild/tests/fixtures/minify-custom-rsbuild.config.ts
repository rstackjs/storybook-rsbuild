import { defineConfig } from '@rsbuild/core'

export default defineConfig({
  output: {
    minify: {
      jsOptions: {
        minimizerOptions: {
          compress: false,
        },
      },
    },
  },
})
