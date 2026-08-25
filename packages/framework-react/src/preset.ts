import { fileURLToPath } from 'node:url'
import { mergeRsbuildConfig } from '@rsbuild/core'
import type { PresetProperty } from 'storybook/internal/types'
import { rsbuildFinalDocs } from './react-docs'
import type { FrameworkOptions, StorybookConfig } from './types'

export const rsbuildFinal: NonNullable<
  StorybookConfig['rsbuildFinal']
> = async (config, options) => {
  const finalConfig = await rsbuildFinalDocs(config, options)

  if (options.features?.developmentModeForBuild) {
    return mergeRsbuildConfig(finalConfig, {
      source: {
        define: {
          NODE_ENV: JSON.stringify('development'),
        },
      },
    })
  }

  return finalConfig
}

export const core: PresetProperty<'core'> = async (config, options) => {
  const frameworkOptions = await options.presets.apply<FrameworkOptions | null>(
    'frameworkOptions',
  )
  return {
    ...config,
    builder: {
      name: fileURLToPath(import.meta.resolve('storybook-builder-rsbuild')),
      options: frameworkOptions?.builder || {},
    },
    renderer: fileURLToPath(import.meta.resolve('@storybook/react/preset')),
  }
}
