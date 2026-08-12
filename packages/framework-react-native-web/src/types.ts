import type { PluginReactNativeWebOptions } from 'rsbuild-plugin-react-native-web'
import type {
  CompatibleString,
  StorybookConfig as StorybookConfigBase,
  TypescriptOptions as TypescriptOptionsBase,
} from 'storybook/internal/types'
import type {
  BuilderOptions,
  StorybookConfigRsbuild,
  TypescriptOptions as TypescriptOptionsBuilder,
} from 'storybook-builder-rsbuild'

type FrameworkName = CompatibleString<'storybook-react-native-web-rsbuild'>
type BuilderName = CompatibleString<'storybook-builder-rsbuild'>

export type FrameworkOptions = {
  builder?: BuilderOptions
  /**
   * Additional node_modules that need to be transpiled.
   * Many React Native packages ship untranspiled code.
   * By default, packages starting with `react-native`, `@react-native`, `expo`, and `@expo`
   * are already included.
   *
   * @example ['react-native-reanimated', 'nativewind']
   */
  modulesToTranspile?: string[]
  /**
   * Options passed to the React Native Web Rsbuild plugin.
   */
  pluginOptions?: PluginReactNativeWebOptions
}

type StorybookConfigFramework = {
  framework:
    | FrameworkName
    | {
        name: FrameworkName
        options: FrameworkOptions
      }
  core?: StorybookConfigBase['core'] & {
    builder?:
      | BuilderName
      | {
          name: BuilderName
          options: BuilderOptions
        }
  }
  typescript?: Partial<TypescriptOptionsBase & TypescriptOptionsBuilder>
}

/**
 * The interface for Storybook configuration in `main.ts` files.
 */
export type StorybookConfig = Omit<
  StorybookConfigBase,
  keyof StorybookConfigRsbuild | keyof StorybookConfigFramework
> &
  StorybookConfigRsbuild &
  StorybookConfigFramework
