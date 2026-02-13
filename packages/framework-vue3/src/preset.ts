import { fileURLToPath } from 'node:url'
import type { PresetProperty } from 'storybook/internal/types'

export { rsbuildFinal } from './framework-preset-vue3'

export const core: PresetProperty<'core'> = async (config, options) => {
  const framework = await options.presets.apply('framework')

  return {
    ...config,
    builder: {
      name: fileURLToPath(import.meta.resolve('storybook-builder-rsbuild')),
      options:
        typeof framework === 'string' ? {} : framework.options.builder || {},
    },
    renderer: fileURLToPath(import.meta.resolve('@storybook/vue3/preset')),
  }
}

export const typescript: PresetProperty<'typescript'> = async (config) => ({
  ...config,
  skipCompiler: true,
})
