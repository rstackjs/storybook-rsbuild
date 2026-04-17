// Adapted from @storybook/nextjs-vite/src/types.ts
import type { NextRouter } from 'next/router'
import type {
  StorybookConfig as StorybookConfigBase,
  TypescriptOptions as TypescriptOptionsBase,
} from 'storybook/internal/types'
import type {
  BuilderOptions,
  StorybookConfigRsbuild,
  TypescriptOptions as TypescriptOptionsBuilder,
} from 'storybook-builder-rsbuild'

type FrameworkName = 'storybook-next-rsbuild'
type BuilderName = 'storybook-builder-rsbuild'

export type FrameworkOptions = {
  builder?: BuilderOptions
  /** Path to the Next.js configuration file. */
  nextConfigPath?: string
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

export interface NextJsParameters {
  nextjs?: {
    /** Enable App Directory features. Required when importing components using next/navigation. */
    appDirectory?: boolean
    /** Next.js navigation configuration for next/navigation (app directory only). */
    navigation?: Partial<NextRouter>
    /** Next.js router configuration for next/router (pages directory). */
    router?: Partial<NextRouter>
  }
}

export interface NextJsTypes {
  parameters: NextJsParameters
}
