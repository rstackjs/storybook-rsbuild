import { define } from 'rstack'
import { createRslibConfig } from 'storybook-rsbuild-scripts/create-rslib-config'
import { sharedConfig } from '../../rstack.shared.ts'
import buildConfig from './build-config.ts'

define.extends([sharedConfig])

define.test({ name: 'rsbuild-plugin-react-native-web' })

define.lib(
  createRslibConfig(import.meta.dirname, buildConfig, {
    dtsBundleTsconfigPath: './tsconfig.dts-bundle.json',
  }),
)
