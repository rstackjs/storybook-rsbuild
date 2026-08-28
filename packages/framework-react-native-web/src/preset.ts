import { mergeRsbuildConfig } from '@rsbuild/core'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pluginReactNativeWeb } from 'rsbuild-plugin-react-native-web'
import { rsbuildFinal as reactRsbuildFinal } from 'storybook-react-rsbuild/preset'
import type { PresetProperty } from 'storybook/internal/types'
import type { FrameworkOptions, StorybookConfig } from './types'

/**
 * Resolve the absolute path to react-native-web package root from the user's project.
 * This is needed for pnpm/monorepo setups where the alias 'react-native' -> 'react-native-web'
 * may not resolve correctly from deep within node_modules.
 */
function resolveReactNativeWeb(configDir: string): string {
  try {
    // Create require from the config directory (user's project context)
    const require = createRequire(`${configDir}/package.json`)
    // Resolve package.json to get the package root directory
    // This avoids issues where the entry file is in a subdirectory (e.g., dist/cjs/)
    const packageJsonPath = require.resolve('react-native-web/package.json')
    return dirname(packageJsonPath)
  } catch {
    // Fallback to package name if resolution fails
    return 'react-native-web'
  }
}

export const rsbuildFinal: StorybookConfig['rsbuildFinal'] = async (
  config,
  options,
) => {
  // Apply the react framework's rsbuildFinal for docgen support
  const reactConfig = await reactRsbuildFinal(config, options)

  // Get framework options
  const frameworkOptions = await options.presets.apply<FrameworkOptions | null>(
    'frameworkOptions',
  )

  // Resolve react-native-web to absolute path for proper alias resolution in monorepos
  const reactNativeWebPath = resolveReactNativeWeb(options.configDir)

  // Apply React Native Web plugin
  return mergeRsbuildConfig(reactConfig, {
    plugins: [
      pluginReactNativeWeb({
        modulesToTranspile: frameworkOptions?.modulesToTranspile,
        dev:
          options.features?.developmentModeForBuild &&
          options.configType === 'PRODUCTION'
            ? true
            : undefined,
        // Pass the resolved path to enable absolute imports in transformed code
        reactNativeWebPath,
        ...frameworkOptions?.pluginOptions,
      }),
    ],
    resolve: {
      alias: {
        // Use absolute path to ensure proper resolution in pnpm/monorepo setups
        'react-native': reactNativeWebPath,
      },
    },
  })
}

export const core: PresetProperty<'core'> = async (config, options) => {
  const frameworkOptions = await options.presets.apply<FrameworkOptions | null>(
    'frameworkOptions',
  )
  return {
    ...config,
    builder: {
      name: fileURLToPath(import.meta.resolve('storybook-builder-rsbuild')),
      options: frameworkOptions?.builder || {},
    },
    renderer: fileURLToPath(import.meta.resolve('@storybook/react/preset')),
  }
}
