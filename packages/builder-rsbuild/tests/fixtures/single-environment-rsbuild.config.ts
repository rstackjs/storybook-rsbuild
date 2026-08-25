import { defineConfig } from '@rsbuild/core'

export default defineConfig({
  environments: {
    web: {
      resolve: {
        alias: {
          'single-environment-alias': './single-environment-target.ts',
        },
      },
    },
  },
})
