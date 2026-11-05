import { define } from 'rstack'
import { createRslibConfig } from 'storybook-rsbuild-scripts/create-rslib-config'
import { sharedConfigWithSetup } from '../../rstack.shared.ts'
import buildConfig from './build-config.ts'

define.extends([sharedConfigWithSetup])

define.lib(createRslibConfig(import.meta.dirname, buildConfig))
