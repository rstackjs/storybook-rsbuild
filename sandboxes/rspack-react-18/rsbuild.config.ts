import { defineConfig } from '@rsbuild/core'
import { pluginReact } from '@rsbuild/plugin-react'
// @ts-expect-error no type declarations
import rspackConfig from './rspack.config.mjs'

const LESS_RULE_SOURCE = String.raw`\.less$`

export default defineConfig({
  plugins: [pluginReact()],
  tools: {
    rspack: (config) => {
      // Take only the `.less` rule from the standalone Rspack config; merging the
      // whole config would clash with Storybook's Rsbuild wiring.
      const lessRule = rspackConfig.module.rules.find(
        (rule: { test?: RegExp }) => rule.test?.source === LESS_RULE_SOURCE,
      )

      if (!lessRule) {
        throw new Error(
          'sandboxes/rspack-react-18: no `.less` rule found in rspack.config.mjs (looked for test source "\\.less$").',
        )
      }

      config.module!.rules!.push(lessRule)
      return config
    },
  },
})
