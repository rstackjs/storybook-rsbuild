import type {
  CompatibleString,
  StorybookConfig as StorybookConfigBase,
  TypescriptOptions as TypescriptOptionsBaseAndVue,
} from 'storybook/internal/types'
import type {
  BuilderOptions,
  StorybookConfigRsbuild,
  TypescriptOptions as TypescriptOptionsBuilder,
} from 'storybook-builder-rsbuild'

type FrameworkName = CompatibleString<'storybook-vue3-rsbuild'>
type BuilderName = CompatibleString<'storybook-builder-rsbuild'>

export type FrameworkOptions = {
  builder?: BuilderOptions
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
  typescript?: Partial<TypescriptOptionsBaseAndVue & TypescriptOptionsBuilder>
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
