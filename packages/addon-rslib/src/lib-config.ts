import type { RsbuildConfig } from '@rsbuild/core'
import { pickRsbuildEnvironment } from 'storybook-builder-rsbuild'
import type { AddonOptions } from './types'

/** Convert an Rslib config into the Rsbuild config of one lib entry, without running a library build. */
export function rslibConfigToRsbuildConfig(
  rslibConfig: { [K in keyof RsbuildConfig]?: unknown } & { lib?: unknown },
  {
    libIndex = 0,
    modifyLibConfig,
  }: Pick<NonNullable<AddonOptions['rslib']>, 'libIndex' | 'modifyLibConfig'>,
): RsbuildConfig {
  const libConfigs = Array.isArray(rslibConfig.lib) ? rslibConfig.lib : [{}]
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
  const { lib: _lib, environments: _environments, ...topLevel } = rslibConfig
  return pickRsbuildEnvironment(
    { ...topLevel, environments: { lib: libConfig } },
    { environment: 'lib', source: 'the loaded Rslib config' },
  )
}
