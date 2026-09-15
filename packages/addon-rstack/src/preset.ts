import {
  mergeRsbuildConfig,
  type ConfigParams,
  type RsbuildConfig,
} from '@rsbuild/core'
import { loadRstackConfig } from 'rstack/config'
import { resolveLibRsbuildConfig } from 'storybook-addon-rslib'
import {
  resolveInheritedRsbuildConfig,
  type RsbuildFinal,
  type StorybookConfigRsbuild,
} from 'storybook-builder-rsbuild'
import type { AddonOptions } from './types'

type BaseOptions = Parameters<RsbuildFinal>[1]

export const rsbuildFinal: StorybookConfigRsbuild['rsbuildFinal'] = async (
  config,
  options: BaseOptions & AddonOptions,
) => {
  const { configFilePath, stack } = options.rstack ?? {}
  const { configs, filePath } = await loadRstackConfig({ configFilePath })
  if (filePath === null) {
    throw new Error(
      `Rstack config file not found (configFilePath: ${configFilePath ?? 'rstack.config.*'} in ${process.cwd()}).`,
    )
  }

  const selectedType =
    stack?.type ?? (configs.app !== undefined ? 'app' : 'lib')
  // Same params Rsbuild's own config loader builds when no overrides are given.
  const env = process.env.NODE_ENV || ''
  const params: ConfigParams = {
    env,
    command: process.argv[2],
    envMode: env,
  }

  let inherited: RsbuildConfig
  if (selectedType === 'app' && configs.app !== undefined) {
    const definition = configs.app
    const resolved =
      typeof definition === 'function' ? await definition(params) : definition
    inherited = resolveInheritedRsbuildConfig(resolved, {
      environment: stack?.type === 'app' ? stack.environment : undefined,
      source: 'the loaded Rstack app config',
    })
  } else if (selectedType === 'lib' && configs.lib !== undefined) {
    const definition = configs.lib
    const resolved =
      typeof definition === 'function' ? await definition(params) : definition
    inherited = resolveLibRsbuildConfig(resolved, {
      libIndex: stack?.type === 'lib' ? stack.libIndex : undefined,
      source: 'the loaded Rstack lib config',
    })
  } else {
    throw new Error(
      stack === undefined
        ? `No define.app() or define.lib() found in ${filePath}.`
        : `No define.${selectedType}() found in ${filePath}.`,
    )
  }

  return mergeRsbuildConfig(config, inherited)
}
