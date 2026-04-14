import { defineConfig } from '@rsbuild/core'
import { pluginReact } from '@rsbuild/plugin-react'
// @ts-expect-error no type declarations
import rspackConfig from './rspack.config.mjs'

export default defineConfig({
  plugins: [pluginReact()],
  tools: {
    rspack: (config) => {
      // TODO: the ideal way it to directly merge the two configs
      // not cherry-picking certain fields like now.
      const lessLoader = rspackConfig.module.rules[2]
      config.module!.rules!.push(lessLoader)
      return config
    },
  },
})
