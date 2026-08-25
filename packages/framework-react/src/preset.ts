import { fileURLToPath } from 'node:url'
import type { PresetProperty } from 'storybook/internal/types'
import { rsbuildFinalDocs } from './react-docs'
import type { FrameworkOptions, StorybookConfig } from './types'

export const rsbuildFinal: NonNullable<
  StorybookConfig['rsbuildFinal']
> = async (config, options) => {
  const finalConfig = rsbuildFinalDocs(config, options)
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
