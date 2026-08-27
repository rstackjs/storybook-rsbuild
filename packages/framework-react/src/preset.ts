import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { mergeRsbuildConfig } from '@rsbuild/core'
import type { PresetProperty } from 'storybook/internal/types'
import { rsbuildFinalDocs } from './react-docs'
import type { FrameworkOptions, StorybookConfig } from './types'

const require = createRequire(import.meta.url)

export const rsbuildFinal: NonNullable<
  StorybookConfig['rsbuildFinal']
> = async (config, options) => {
  const finalConfig = await rsbuildFinalDocs(
    mergeRsbuildConfig(
      {
        resolve: {
          alias: {
            '@storybook/react': require.resolve('@storybook/react'),
          },
        },
      },
      config,
    ),
    options,
  )

  if (options.features?.developmentModeForBuild) {
    return mergeRsbuildConfig(finalConfig, {
      source: {
        define: {
          'process.env.NODE_ENV': JSON.stringify('development'),
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
