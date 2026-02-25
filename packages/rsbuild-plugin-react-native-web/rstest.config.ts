import { defineConfig } from '@rstest/core'
import { rstestCommonConfig } from '../../rstest.config'

export default defineConfig({
  ...rstestCommonConfig,
  name: 'rsbuild-plugin-react-native-web',
})
