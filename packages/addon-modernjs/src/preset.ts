import type { AppNormalizedConfig, AppTools } from '@modern-js/app-tools'
import {
  builderPluginAdapterBasic,
  builderPluginAdapterHooks,
  parseRspackConfig as parseToRsbuildConfig,
} from '@modern-js/app-tools/builder'
// TODO: better import from `@modern-js/app-tools/builder`
import { mergeRsbuildConfig } from '@rsbuild/core'
import findUp from 'find-up'
import { logger } from 'rslog'
import type {
  RsbuildFinal,
  StorybookConfigRsbuild,
} from 'storybook-builder-rsbuild'
import type { AddonOptions } from './types'

type BaseOptions = Parameters<RsbuildFinal>[1]
type BuilderAdapterParams = Parameters<typeof builderPluginAdapterBasic>[0]

const MODERN_META_NAME = 'modern-js'
const MODERN_CONFIG_FILE = 'modern.config.ts'

type CreateStorybookOptions = <_T>(options: {
  cwd: string
  configFile: string
  metaName: string
}) => Promise<{
  config: AppNormalizedConfig & { builderPlugins?: unknown }
  getAppContext: () => unknown
}>

const loadCreateStorybookOptions =
  async (): Promise<CreateStorybookOptions> => {
    try {
      // @ts-expect-error Optional peer dependency for Modern.js v3 projects.
      return (await import('@modern-js/plugin/cli')).createStorybookOptions
    } catch {
      try {
        // @ts-expect-error Optional peer dependency for Modern.js v2 projects.
        return (await import('@modern-js/plugin-v2/cli')).createStorybookOptions
      } catch {
        throw new Error(
          'Cannot resolve Modern.js Storybook plugin entry. Install @modern-js/app-tools@^3 with @modern-js/plugin, or @modern-js/app-tools@^2 with @modern-js/plugin-v2, then retry.',
        )
      }
    }
  }

/**
 * Get @rsbuild/core version from different sources
 */
const PKG_NAME = '@rsbuild/core'
const getVersion = async (cwd: string) => {
  const pkgPath = await findUp('package.json', { cwd })
  const pkg = require(pkgPath!)
  if (pkg.name === PKG_NAME) {
    return pkg.version
  }
  return pkg.dependencies[PKG_NAME] || pkg.devDependencies[PKG_NAME]
}

const checkDependency = async () => {
  const projectVersion = await getVersion(process.cwd())
  const recommandVersion = await getVersion(
    require.resolve('@modern-js/app-tools'),
  )
  const installedVersion = await getVersion(require.resolve('@rsbuild/core'))

  if (!projectVersion) {
    logger.error(
      `Missing required dependency @rsbuild/core, please install @rsbuild/core@${recommandVersion}`,
    )
    return
  }

  if (recommandVersion !== installedVersion) {
    logger.warn(
      `@rsbuild/core version mismatch: expected ${recommandVersion}, got ${installedVersion}. Please install @rsbuild/core@${recommandVersion}`,
    )
  }
}

/**
 * Storybook addon for Modern.js, only support bundler `rspack`.
 */
export const rsbuildFinal: StorybookConfigRsbuild['rsbuildFinal'] = async (
  config,
  options: BaseOptions & AddonOptions,
) => {
  await checkDependency()

  const cwd = process.cwd()
  const createStorybookOptions = await loadCreateStorybookOptions()
  const { config: resolveConfig, getAppContext } =
    await createStorybookOptions<AppTools>({
      cwd,
      configFile: options.configPath || MODERN_CONFIG_FILE,
      metaName: MODERN_META_NAME,
    })

  const nonStandardConfig = {
    ...resolveConfig,
    plugins: [resolveConfig.builderPlugins],
  }
  // Parse the non-standardized config to rsbuild config
  const { rsbuildConfig, rsbuildPlugins } = await parseToRsbuildConfig(
    nonStandardConfig,
    {
      cwd,
    },
  )

  const appContext = getAppContext()
  const adapterParams: BuilderAdapterParams = {
    appContext: appContext as BuilderAdapterParams['appContext'],
    normalizedConfig: resolveConfig as AppNormalizedConfig,
  }

  // Inject the extra rsbuild plugins
  rsbuildConfig.plugins = [
    ...rsbuildPlugins,
    ...(rsbuildConfig.plugins || []),
    builderPluginAdapterBasic(adapterParams),
    builderPluginAdapterHooks(adapterParams),
  ]

  const finalConfig = mergeRsbuildConfig(config, rsbuildConfig)
  return finalConfig
}
