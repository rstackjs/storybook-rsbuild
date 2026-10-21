import type { WebComponentsFrameworkOptions } from '@storybook/web-components'
import type {
  BuilderOptions,
  StorybookConfigRsbuild,
  TypescriptOptions as TypescriptOptionsBuilder,
} from 'storybook-builder-rsbuild'
import type {
  CompatibleString,
  StorybookConfig as StorybookConfigBase,
  TypescriptOptions as TypescriptOptionsWebComponents,
} from 'storybook/internal/types'

type FrameworkName = CompatibleString<'storybook-web-components-rsbuild'>
type BuilderName = CompatibleString<'storybook-builder-rsbuild'>

export type FrameworkOptions = {
  builder?: BuilderOptions
} & WebComponentsFrameworkOptions

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
  typescript?: Partial<
    TypescriptOptionsWebComponents & TypescriptOptionsBuilder
  >
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
