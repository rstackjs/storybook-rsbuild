import { createRslibConfig } from '@storybook/scripts/create-rslib-config'
import buildConfig from './build-config.ts'

export default createRslibConfig(import.meta.dirname, buildConfig, {
  define:
    process.env.SB_RSBUILD_TEST_MINIMAL_DEV === 'true'
      ? {
          'process.env.SB_RSBUILD_TEST_MINIMAL_DEV': JSON.stringify('true'),
        }
      : {},
  disableUrlParsingFor: /builder-rsbuild[\\/]compiled/,
})
