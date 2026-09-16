import { mergeRsbuildConfig } from '@rsbuild/core'
import { loadConfig } from '@rslib/core'
import {
  stripInheritedConfig,
  type RsbuildFinal,
  type StorybookConfigRsbuild,
} from 'storybook-builder-rsbuild'
import { rslibConfigToRsbuildConfig } from './lib-config'
import type { AddonOptions } from './types'

type BaseOptions = Parameters<RsbuildFinal>[1]

export const rsbuildFinal: StorybookConfigRsbuild['rsbuildFinal'] = async (
  config,
  options: BaseOptions & AddonOptions,
) => {
  const { rslib = {} } = options
  const { cwd, configPath, modifyLibRsbuildConfig, ...libOptions } = rslib
  const { content } = await loadConfig({ cwd, path: configPath })

  const inherited = rslibConfigToRsbuildConfig(content, libOptions)
  stripInheritedConfig(inherited, 'the loaded Rslib config')
  // Explicit Storybook configuration is applied after inherited fields are stripped.
  if (typeof modifyLibRsbuildConfig === 'function') {
    modifyLibRsbuildConfig(inherited)
  }
  return mergeRsbuildConfig(config, inherited)
}
