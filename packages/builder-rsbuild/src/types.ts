import type { DevConfig, RsbuildConfig } from '@rsbuild/core'
import type { PluginTypeCheckerOptions } from '@rsbuild/plugin-type-check'
import type {
  Builder,
  BuilderResult as BuilderResultBase,
  Options,
  StorybookConfigRaw,
  TypescriptOptions as TypeScriptOptionsBase,
} from 'storybook/internal/types'
import type { Stats } from './index'

// Storybook's Stats are optional Webpack related property
type RsbuildStats = {
  toJson: (...args: any[]) => any
}

/**
 * Options for TypeScript usage within Storybook.
 */
export interface TypescriptOptions extends TypeScriptOptionsBase {
  /**
   * Configures `@rsbuild/plugin-type-check`, using `fork-ts-checker-webpack-plugin` under the hood.
   */
  checkOptions?: PluginTypeCheckerOptions
}

export type RsbuildBuilder = Builder<RsbuildConfig, RsbuildStats>

export type RsbuildFinal = (
  config: RsbuildConfig,
  options: Options,
) => RsbuildConfig | Promise<RsbuildConfig>

export type StorybookConfigRsbuild = {
  rsbuildFinal?: RsbuildFinal
  webpackAddons?: StorybookConfigRaw['addons']
}

export type BuilderOptions = {
  /**
   * Path to rsbuild.config file, relative to CWD.
   */
  rsbuildConfigPath?: string
  /**
   * Pass-through Rsbuild `dev.lazyCompilation` options.
   */
  lazyCompilation?: DevConfig['lazyCompilation']
  /**
   * Enable Rspack's [persistent cache(experimental)](https://rspack.dev/config/experiments#experimentscache).
   * We continue to use the name `fsCache` here to maintain better compatibility with the webpack builder.
   */
  fsCache?: boolean
  /**
   * Which environment to use from the Rsbuild config.
   */
  environment?: string
  /**
   * @storybook/addon-docs options
   */
  addonDocs?: any
}

export interface BuilderResult extends BuilderResultBase {
  stats?: Stats
}
