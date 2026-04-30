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
  /**
   * Configuration for the `next/image` mock. Accepted for compatibility with
   * `@storybook/nextjs` and `@storybook/nextjs-vite`; the runtime mock currently
   * falls through to upstream `next/image` defaults.
   */
  image?: {
    /** Default `loading` prop forwarded to `next/image`. */
    loading?: 'lazy' | 'eager'
    /** Glob patterns of image files to include for static handling. */
    includeFiles?: string[]
    /** Glob patterns of image files to exclude from static handling. */
    excludeFiles?: string[]
  }
}

/**
 * Mirrors the `reactDocgen` option consumed by `@storybook/react`'s preset.
 * `@storybook/react` does not export this type directly, so we redeclare it
 * here to make `typescript.reactDocgen` type-check on user `main.ts` configs.
 */
type TypescriptOptionsReact = {
  reactDocgen?: 'react-docgen' | 'react-docgen-typescript' | false
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
  typescript?: Partial<
    TypescriptOptionsBase & TypescriptOptionsBuilder & TypescriptOptionsReact
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

export interface NextJsParameters {
  nextjs?: {
    /** Next.js navigation configuration for next/navigation (app directory). */
    navigation?: Partial<NextRouter>
    /** Next.js router configuration for next/router (pages directory). */
    router?: Partial<NextRouter>
  }
}

export interface NextJsTypes {
  parameters: NextJsParameters
}
