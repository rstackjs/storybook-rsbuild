import { createRslibConfig } from '@storybook/scripts/create-rslib-config'
import buildConfig from './build-config.ts'

export default createRslibConfig(import.meta.dirname, buildConfig)
