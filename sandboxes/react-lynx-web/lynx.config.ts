import { pluginReactLynx } from '@lynx-js/react-rsbuild-plugin'
import { defineConfig } from '@lynx-js/rspeedy'

export default defineConfig({
  plugins: [pluginReactLynx()],
  environments: {
    web: {},
    lynx: {},
  },
  source: {
    entry: {
      Button: './src/components/index.tsx',
    },
  },
})
