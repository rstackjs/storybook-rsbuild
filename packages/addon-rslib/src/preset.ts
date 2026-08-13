import { mergeRsbuildConfig, type RsbuildConfig } from '@rsbuild/core'
import { loadConfig } from '@rslib/core'
import {
  type RsbuildFinal,
  type StorybookConfigRsbuild,
  stripInheritedConfig,
} from 'storybook-builder-rsbuild'
import type { AddonOptions } from './types'

type BaseOptions = Parameters<RsbuildFinal>[1]

export const rsbuildFinal: StorybookConfigRsbuild['rsbuildFinal'] = async (
  config,
  options: BaseOptions & AddonOptions,
) => {
  const { rslib = {} } = options
  const {
    cwd,
    configPath,
    libIndex = 0,
    modifyLibConfig,
    modifyLibRsbuildConfig,
  } = rslib
  const { content } = await loadConfig({
    cwd: cwd,
    path: configPath,
  })

  const libConfigs = content.lib === undefined ? [{}] : content.lib
  const libConfig =
    libIndex === false
      ? {}
      : Array.isArray(libConfigs)
        ? libConfigs[libIndex]
        : undefined
  if (!libConfig) {
    throw new Error(
      `Lib config not found at index ${libIndex}, expect a lib config but got ${libConfig}`,
    )
  }

  if (typeof modifyLibConfig === 'function') {
    modifyLibConfig(libConfig)
  }

  const { lib: _lib, ...nonLibConfig } = content
  const mergedLibConfig: RsbuildConfig = mergeRsbuildConfig(
    nonLibConfig as RsbuildConfig,
    libConfig as RsbuildConfig,
  )

  stripInheritedConfig(mergedLibConfig, 'the loaded Rslib config')

  // Explicit Storybook configuration is applied after inherited fields are stripped.
  if (typeof modifyLibRsbuildConfig === 'function') {
    modifyLibRsbuildConfig(mergedLibConfig)
  }

  return mergeRsbuildConfig(config, mergedLibConfig)
}
