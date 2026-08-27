import { fileURLToPath } from 'node:url'
import type { PresetProperty } from 'storybook/internal/types'
import type { FrameworkOptions, StorybookConfig } from './types'

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
    renderer: fileURLToPath(
      import.meta.resolve('@storybook/web-components/preset'),
    ),
  }
}

export const rsbuildFinal: StorybookConfig['rsbuildFinal'] = (
  config,
  _options,
) => {
  // Intentional divergence (local PR #207): drop inherited app HTML so its template cannot leak into the preview.
  // User main.ts rsbuildFinal runs later and survives; upstream web-components-vite has no HTML handling.
  // https://github.com/storybookjs/storybook/blob/0f8be9ce02f2e2d8d8730b8b3c7fecb61edc1fd7/code/frameworks/web-components-vite/src/preset.ts
  delete config.html
  return config
}
