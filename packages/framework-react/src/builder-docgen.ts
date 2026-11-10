import {
  checkBuilderDocgenPackages,
  getTypeScriptForDocgenError,
  isPackageInstalledInRange,
} from 'storybook/internal/common'
import type { Options } from 'storybook/internal/types'

export type ReactDocgenConfig =
  'react-docgen' | 'react-docgen-typescript' | false

/**
 * Packages that only React's deprecated builder docgen (`features.docgenServer: false`) uses, with
 * the version range Storybook supports. `storybook-react-rsbuild` declares them as optional peer
 * dependencies with these ranges, which a test checks.
 * @see https://github.com/storybookjs/storybook/blob/4b5e9a60c55c6d3659ffa3118881b8904b41c021/code/renderers/react/src/builder-docgen.ts#L16-L21
 */
export const REACT_BUILDER_DOCGEN_PACKAGES = {
  'react-docgen': '^8.0.2',
  'react-docgen-typescript': '^2.2.2',
} as const

export type ReactBuilderDocgenPackage =
  keyof typeof REACT_BUILDER_DOCGEN_PACKAGES

/**
 * Return the packages that builder docgen needs for a `typescript.reactDocgen` mode.
 *
 * Intentional divergence: upstream also requires its builder plugin (`@storybook/react-docgen-typescript-plugin`
 * on webpack, `@joshwooding/vite-plugin-react-docgen-typescript` on Vite) in `react-docgen-typescript`
 * mode. This repo runs its vendored plugin, so only `react-docgen-typescript` is needed.
 * https://github.com/storybookjs/storybook/blob/4b5e9a60c55c6d3659ffa3118881b8904b41c021/code/renderers/react/src/builder-docgen.ts#L32-L48
 */
export function getReactBuilderDocgenPackages(
  reactDocgen: ReactDocgenConfig | undefined,
): ReactBuilderDocgenPackage[] {
  if (reactDocgen === 'react-docgen') {
    return ['react-docgen']
  }
  if (reactDocgen === 'react-docgen-typescript') {
    return ['react-docgen-typescript']
  }
  return []
}

/** Return whether a builder docgen package resolves in a version Storybook supports. */
export const isReactBuilderDocgenPackageInstalled = (
  resolve: (specifier: string) => string,
  packageName: ReactBuilderDocgenPackage,
) =>
  isPackageInstalledInRange(
    resolve,
    packageName,
    REACT_BUILDER_DOCGEN_PACKAGES[packageName],
  )

/**
 * Decide which `typescript.reactDocgen` mode builder docgen runs in, check that its packages are
 * installed, and report it when they are not. Call it from a framework preset once builder docgen
 * is active.
 *
 * @returns The mode builder docgen runs in, or `undefined` when it must not run.
 * @throws {BuilderDocgenPackagesMissingError} When the main config sets `features.docgenServer:
 *   false` and packages are missing.
 * @see https://github.com/storybookjs/storybook/blob/4b5e9a60c55c6d3659ffa3118881b8904b41c021/code/renderers/react/src/builder-docgen.ts#L56-L100
 */
export async function prepareReactBuilderDocgen({
  reactDocgen,
  resolve,
  options,
}: {
  reactDocgen: Exclude<ReactDocgenConfig, false>
  /** Resolve from the framework package, which declares the packages as optional peers. */
  resolve: (specifier: string) => string
  options: Pick<Options, 'configDir'>
}): Promise<Exclude<ReactDocgenConfig, false> | undefined> {
  // react-docgen-typescript runs the TypeScript compiler API, so it falls back to react-docgen
  // without a usable `typescript`.
  const mode =
    reactDocgen === 'react-docgen-typescript' &&
    getTypeScriptForDocgenError(resolve)
      ? 'react-docgen'
      : reactDocgen
  const packages = getReactBuilderDocgenPackages(mode)
  const missing = await checkBuilderDocgenPackages({
    packages: Object.fromEntries(
      packages.map((name) => [name, REACT_BUILDER_DOCGEN_PACKAGES[name]]),
    ),
    resolve,
    options,
    builderDocgen: `typescript.reactDocgen: '${reactDocgen}'`,
    disableBuilderDocgen: 'typescript.reactDocgen: false',
    documentation:
      'https://storybook.js.org/docs/api/main-config/main-config-typescript#reactdocgen',
    note:
      mode !== reactDocgen
        ? '`react-docgen-typescript` needs the TypeScript compiler API, which your `typescript` package does not have, so builder docgen uses `react-docgen` instead.'
        : undefined,
  })
  return missing.length > 0 ? undefined : mode
}
