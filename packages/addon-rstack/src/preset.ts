import { mergeRsbuildConfig, type ConfigParams } from '@rsbuild/core'
import { loadRstackConfig } from 'rstack/config'
import { rslibConfigToRsbuildConfig } from 'storybook-addon-rslib'
import {
  pickRsbuildEnvironment,
  stripInheritedConfig,
  type RsbuildFinal,
  type StorybookConfigRsbuild,
} from 'storybook-builder-rsbuild'
import type { AddonOptions, RstackStackOptions } from './types'

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

  const selected: RstackStackOptions = stack ?? {
    type: configs.app !== undefined ? 'app' : 'lib',
  }
  const definition = configs[selected.type]
  if (definition === undefined) {
    throw new Error(
      stack === undefined
        ? `No define.app() or define.lib() found in ${filePath}.`
        : `No define.${selected.type}() found in ${filePath}.`,
    )
  }

  // Same params Rsbuild's own config loader builds when no overrides are given.
  const env = process.env.NODE_ENV || ''
  const params: ConfigParams = {
    env,
    command: process.argv[2],
    envMode: env,
  }

  const resolved =
    typeof definition === 'function' ? await definition(params) : definition

  const source = `the loaded Rstack ${selected.type} config`
  const inherited =
    selected.type === 'app'
      ? pickRsbuildEnvironment(resolved, {
          environment: selected.environment,
          source,
        })
      : rslibConfigToRsbuildConfig(resolved, {
          libIndex: selected.libIndex,
        })
  stripInheritedConfig(inherited, source)

  return mergeRsbuildConfig(config, inherited)
}
