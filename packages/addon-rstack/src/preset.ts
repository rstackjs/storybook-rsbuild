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
  const {
    configFilePath,
    configType: definitionType,
    environment,
    libIndex,
  } = options.rstack ?? {}
  const { configs, filePath } = await loadRstackConfig({ configFilePath })
  if (filePath === null) {
    throw new Error(
      `Rstack config file not found (configFilePath: ${configFilePath ?? 'rstack.config.*'} in ${process.cwd()}).`,
    )
  }

  const selectedType =
    definitionType ?? (configs.app !== undefined ? 'app' : 'lib')
  const env = process.env.NODE_ENV || ''
  const params: ConfigParams = {
    env,
    command: options.configType === 'PRODUCTION' ? 'build' : 'dev',
    envMode: env,
  }

  let inherited: RsbuildConfig
  if (selectedType === 'app' && configs.app !== undefined) {
    const definition = configs.app
    const resolved =
      typeof definition === 'function' ? await definition(params) : definition
    inherited = resolveInheritedRsbuildConfig(resolved, {
      environment,
      source: 'the loaded Rstack app config',
    })
  } else if (selectedType === 'lib' && configs.lib !== undefined) {
    const definition = configs.lib
    const resolved =
      typeof definition === 'function' ? await definition(params) : definition
    inherited = resolveLibRsbuildConfig(resolved, {
      libIndex,
      source: 'the loaded Rstack lib config',
    })
  } else {
    throw new Error(
      definitionType === undefined
        ? `No define.app() or define.lib() found in ${filePath}.`
        : `No define.${selectedType}() found in ${filePath}.`,
    )
  }

  return mergeRsbuildConfig(config, inherited)
}
