import { fileURLToPath } from 'node:url'
import type { PresetProperty } from 'storybook/internal/types'
import type { FrameworkOptions } from './types'

export { rsbuildFinal } from './framework-preset-vue3'

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
    renderer: fileURLToPath(import.meta.resolve('@storybook/vue3/preset')),
  }
}

export const typescript: PresetProperty<'typescript'> = async (config) => ({
  ...config,
  // Intentional divergence: generic ts-checker skips .vue SFCs; upstream Vue3 Vite has no SFC check.
  // Users can set typescript.skipCompiler=false and
  // typescript.checkOptions.tsCheckerOptions.typescript.typescriptPath='@esctn/vue-tsc-api' in main.ts.
  // https://github.com/storybookjs/storybook/blob/0f8be9ce02f2e2d8d8730b8b3c7fecb61edc1fd7/code/frameworks/vue3-vite/src/preset.ts
  skipCompiler: true,
})
