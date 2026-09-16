import type { RsbuildConfig } from '@rsbuild/core'
import { resolveInheritedRsbuildConfig } from 'storybook-builder-rsbuild'
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
  const libConfigs = Array.isArray(content.lib) ? content.lib : [{}]
  const libConfig = libIndex === false ? {} : libConfigs[libIndex]
  if (libConfig === undefined) {
    throw new Error(
      `Lib config not found at index ${libIndex}, expect a lib config but got ${libConfig}`,
    )
  }

  if (typeof modifyLibConfig === 'function') {
    modifyLibConfig(libConfig)
  }

  // Rslib ignores a user-written `environments` key: each lib entry is the environment.
  const { lib: _lib, environments: _environments, ...topLevel } = content
  const resolved = resolveInheritedRsbuildConfig(
    { ...topLevel, environments: { lib: libConfig } },
    { environment: 'lib', source },
  )

  // Explicit Storybook configuration is applied after inherited fields are stripped.
  if (typeof modifyLibRsbuildConfig === 'function') {
    modifyLibRsbuildConfig(resolved)
  }

  return resolved
}
