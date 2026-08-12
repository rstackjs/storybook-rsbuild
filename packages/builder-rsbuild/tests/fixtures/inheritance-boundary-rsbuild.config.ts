import { defineConfig } from '@rsbuild/core'

export default defineConfig({
  dev: {
    writeToDisk: true,
  },
  plugins: [
    {
      name: 'write-build-id',
      setup() {},
    },
    {
      name: 'keep-for-storybook',
      setup() {},
    },
  ],
  tools: {
    htmlPlugin: false,
    rspack: {
      output: {
        globalObject: 'this',
        library: {
          name: 'FixtureLibrary',
          type: 'umd',
        },
        umdNamedDefine: true,
        uniqueName: 'inheritance-boundary-fixture',
      },
    },
  },
})
