import { define } from 'rstack'
import { createRslibConfig } from 'storybook-rsbuild-scripts/create-rslib-config'
import buildConfig from './build-config.ts'

define.lib(createRslibConfig(import.meta.dirname, buildConfig))
