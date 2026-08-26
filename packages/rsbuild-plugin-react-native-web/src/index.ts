import type { RsbuildPlugin, RspackChain } from '@rsbuild/core'
import { normalize } from 'pathe'
import {
  transformCssInteropDoctorCheck,
  transformReanimatedWebUtils,
} from './transforms'

const webExtensions = [
  '.web.mjs',
  '.web.js',
  '.web.jsx',
  '.web.ts',
  '.web.tsx',
  '.mjs',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.json',
]

// Default modules that need to be transpiled (they ship untranspiled code)
const DEFAULT_MODULES_TO_TRANSPILE = [
  'react-native',
  '@react-native',
  'expo',
  '@expo',
]

// Default modules that should not be tree-shaken (they have side effects)
const DEFAULT_NO_TREESHAKE_MODULES = [
  'react-native-css-interop',
  'react-native-css',
  'expo-modules-core',
]

export interface PluginReactNativeWebOptions {
  /**
   * Whether React Native Web should run in development mode.
   * @default process.env.NODE_ENV !== 'production'
   */
  dev?: boolean

  /**
   * Additional node_modules that need to be transpiled.
   * By default, packages starting with `react-native`, `@react-native`, `expo`, and `@expo`
   * are already included.
   *
   * @example ['my-react-native-library']
   */
  modulesToTranspile?: string[]

  /**
   * The JSX runtime to use.
   * - 'automatic': Uses the new JSX transform (React 17+)
   * - 'classic': Uses React.createElement
   * @default 'automatic'
   */
  jsxRuntime?: 'automatic' | 'classic'

  /**
   * The source for JSX imports when using the automatic runtime.
   * @default 'react'
   * @example 'nativewind' for NativeWind v4+
   */
  jsxImportSource?: string

  /**
   * Modules that should not be tree-shaken.
   * Some React Native packages have side effects that may be incorrectly removed.
   * @default ['react-native-css-interop', 'expo-modules-core']
   */
  noTreeshakeModules?: string[]

  /**
   * Absolute path to the react-native-web package directory.
   * This is needed for pnpm/monorepo setups where react-native-reanimated
   * cannot resolve react-native-web internal modules.
   *
   * If provided, the plugin will rewrite import paths in transformed code
   * to use absolute paths, ensuring proper module resolution.
   *
   * @example '/path/to/node_modules/react-native-web'
   */
  reactNativeWebPath?: string
}

/**
 * Creates a regex pattern to match modules that should be transpiled.
 * This pattern excludes node_modules except for the specified modules.
 */
function createTranspileIncludePattern(modules: string[]): RegExp {
  const escapedModules = modules.map((m) =>
    m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  )
  return new RegExp(`node_modules[\\\\/](${escapedModules.join('|')})`)
}

/**
 * Rsbuild plugin for React Native Web support.
 * This plugin enables you to use React Native components in web applications.
 */
export function pluginReactNativeWeb(
  options: PluginReactNativeWebOptions = {},
): RsbuildPlugin {
  const modulesToTranspile = [
    ...new Set([
      ...DEFAULT_MODULES_TO_TRANSPILE,
      ...(options.modulesToTranspile || []),
    ]),
  ]

  const includePattern = createTranspileIncludePattern(modulesToTranspile)
  const jsxRuntime = options.jsxRuntime ?? 'automatic'
  const jsxImportSource = options.jsxImportSource
  const noTreeshakeModules = [
    ...new Set([
      ...DEFAULT_NO_TREESHAKE_MODULES,
      ...(options.noTreeshakeModules || []),
    ]),
  ]
  const noTreeshakePattern = createTranspileIncludePattern(noTreeshakeModules)
  const reactNativeWebPath = options.reactNativeWebPath

  /**
   * Creates a module resolver function that rewrites react-native-web
   * module paths to absolute paths when reactNativeWebPath is provided.
   */
  function createModuleResolver():
    | ((modulePath: string) => string)
    | undefined {
    if (!reactNativeWebPath) {
      return undefined
    }

    // Normalize path to use forward slashes for ESM compatibility
    // This is important for Windows where paths use backslashes
    const normalizedReactNativeWebPath = normalize(reactNativeWebPath)

    return (modulePath: string) => {
      // Only rewrite react-native-web paths
      if (modulePath.startsWith('react-native-web/')) {
        // Replace 'react-native-web/' with the absolute path
        const relativePart = modulePath.slice('react-native-web/'.length)
        return `${normalizedReactNativeWebPath}/${relativePart}`
      }
      return modulePath
    }
  }

  return {
    name: 'rsbuild:react-native-web',

    setup(api) {
      let isProduction = false

      api.modifyRsbuildConfig((config) => {
        // 1. Define global variables required by React Native
        config.source ??= {}
        const isDevelopment =
          options.dev ?? process.env.NODE_ENV !== 'production'
        const nodeEnvDefine =
          config.source.define?.['process.env.NODE_ENV'] ??
          JSON.stringify(
            options.dev != null
              ? isDevelopment
                ? 'development'
                : 'production'
              : process.env.NODE_ENV || 'development',
          )
        config.source.define = {
          ...config.source.define,
          __DEV__: JSON.stringify(isDevelopment),
          'process.env.NODE_ENV': nodeEnvDefine,
          EXPO_OS: JSON.stringify('web'),
          'process.env.EXPO_OS': JSON.stringify('web'),
          _WORKLET: 'false',
          _frameTimestamp: 'undefined',
          'global.Error': 'Error',
          'global.__x': '{}',
        }

        // 2. Add web-specific extensions with higher priority
        // Note: The alias 'react-native' -> 'react-native-web' should be configured
        // by the framework/user with an absolute path for pnpm/monorepo compatibility
        config.resolve ??= {}
        config.resolve.extensions = webExtensions

        // 4. Include RN modules in transpilation
        config.source.include = [
          ...(config.source.include || []),
          includePattern,
        ]

        return config
      })

      api.onBeforeCreateCompiler(() => {
        isProduction =
          api.context.bundlerType === 'rspack'
            ? process.env.NODE_ENV === 'production'
            : false
      })

      // Configure SWC to handle JSX in React Native packages
      api.modifyBundlerChain((chain: RspackChain) => {
        // Get the existing JS rule and modify it to handle RN packages
        const jsRule = chain.module.rule('js')

        if (jsRule) {
          // Add include pattern for RN modules
          jsRule.include.add(includePattern)
        }

        // Build JSX config based on options
        const reactConfig: Record<string, unknown> = {
          runtime: jsxRuntime,
        }
        if (jsxImportSource && jsxRuntime === 'automatic') {
          reactConfig.importSource = jsxImportSource
        }

        // Add a rule for React Native packages to handle JSX in .js files
        // This ensures RN packages that ship JSX in .js files are properly transpiled
        chain.module
          .rule('react-native-jsx')
          .test(/\.(js|mjs|jsx)$/)
          .include.add(includePattern)
          .end()
          .use('swc')
          .loader('builtin:swc-loader')
          .options({
            jsc: {
              parser: {
                syntax: 'ecmascript',
                jsx: true,
              },
              transform: {
                react: reactConfig,
              },
            },
          })

        // Mark certain modules as having side effects to prevent tree-shaking issues
        chain.module
          .rule('react-native-no-treeshake')
          .test(/\.(js|mjs|jsx|ts|tsx)$/)
          .include.add(noTreeshakePattern)
          .end()
          .set('sideEffects', true)
      })

      // Apply code transformations for compatibility fixes
      const moduleResolver = createModuleResolver()

      api.transform(
        {
          test: /\.(js|mjs|jsx|ts|tsx)$/,
        },
        ({ code, resource }) => {
          // Transform react-native-css-interop doctor check
          const cssInteropResult = transformCssInteropDoctorCheck(
            code,
            resource,
            {
              source: resource,
            },
          )
          if (cssInteropResult.changed) {
            return {
              code: cssInteropResult.code,
              map: cssInteropResult.map ?? undefined,
            }
          }

          // Transform React Native Reanimated webUtils
          const reanimatedResult = transformReanimatedWebUtils(
            code,
            resource,
            isProduction,
            {
              source: resource,
              resolveModule: moduleResolver,
            },
          )
          if (reanimatedResult.changed) {
            return {
              code: reanimatedResult.code,
              map: reanimatedResult.map ?? undefined,
            }
          }

          return { code }
        },
      )
    },
  }
}

export type { TransformResult } from './transforms'
