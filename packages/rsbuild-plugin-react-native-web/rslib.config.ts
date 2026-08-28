import { createRslibConfig } from 'storybook-rsbuild-scripts/create-rslib-config'
import buildConfig from './build-config.ts'

export default createRslibConfig(import.meta.dirname, buildConfig, {
  dtsBundleTsconfigPath: './tsconfig.dts-bundle.json',
})
