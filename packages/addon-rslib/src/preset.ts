import { mergeRsbuildConfig } from '@rsbuild/core'
import { loadConfig } from '@rslib/core'
import {
  type RsbuildFinal,
  type StorybookConfigRsbuild,
} from 'storybook-builder-rsbuild'
import { resolveLibRsbuildConfig } from './lib-config'
import type { AddonOptions } from './types'

type BaseOptions = Parameters<RsbuildFinal>[1]

export const rsbuildFinal: StorybookConfigRsbuild['rsbuildFinal'] = async (
  config,
  options: BaseOptions & AddonOptions,
) => {
  const { rslib = {} } = options
  const { cwd, configPath, ...libOptions } = rslib
  const { content } = await loadConfig({ cwd, path: configPath })

  const mergedLibConfig = resolveLibRsbuildConfig(content, {
    ...libOptions,
    source: 'the loaded Rslib config',
  })
  return mergeRsbuildConfig(config, mergedLibConfig)
}
