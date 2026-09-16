import { mergeRsbuildConfig, type RsbuildConfig } from '@rsbuild/core'
import { stripInheritedConfig } from 'storybook-builder-rsbuild'
import type { AddonOptions } from './types'

/** Resolve the reusable configuration without running a library build. */
export function resolveLibRsbuildConfig(
  content: { [K in keyof RsbuildConfig]?: unknown } & { lib?: unknown },
  {
    libIndex = 0,
    modifyLibConfig,
    modifyLibRsbuildConfig,
    source,
  }: Pick<
    NonNullable<AddonOptions['rslib']>,
    'libIndex' | 'modifyLibConfig' | 'modifyLibRsbuildConfig'
  > & { source: string },
): RsbuildConfig {
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

  stripInheritedConfig(mergedLibConfig, source)

  // Explicit Storybook configuration is applied after inherited fields are stripped.
  if (typeof modifyLibRsbuildConfig === 'function') {
    modifyLibRsbuildConfig(mergedLibConfig)
  }

  return mergedLibConfig
}
