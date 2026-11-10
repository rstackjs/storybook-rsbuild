import {
  REACT_BUILDER_DOCGEN_PACKAGES,
  type ReactBuilderDocgenPackage,
} from '@storybook/react/internal/builder-docgen'
import {
  checkBuilderDocgenPackages,
  getTypeScriptForDocgenError,
} from 'storybook/internal/common'
import type { Options } from 'storybook/internal/types'

// The renderer does not export its `ReactDocgenConfig` type.
export type ReactDocgenConfig =
  'react-docgen' | 'react-docgen-typescript' | false

/**
 * Return the packages that builder docgen needs for a `typescript.reactDocgen` mode.
 *
 * Intentional divergence: upstream's `getReactBuilderDocgenPackages` adds a builder plugin package
 * (`@storybook/react-docgen-typescript-plugin` on webpack, `@joshwooding/vite-plugin-react-docgen-typescript`
 * on Vite) in `react-docgen-typescript` mode. This repo runs its vendored plugin, so only
 * `react-docgen-typescript` is needed.
 * https://github.com/storybookjs/storybook/blob/4b5e9a60c55c6d3659ffa3118881b8904b41c021/code/renderers/react/src/builder-docgen.ts#L32-L48
 */
export function getRsbuildBuilderDocgenPackages(
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

/**
 * Decide which `typescript.reactDocgen` mode builder docgen runs in, check that its packages are
 * installed, and report it when they are not. Call it from a framework preset once builder docgen
 * is active.
 *
 * Mirrors upstream's `prepareReactBuilderDocgen` except for the package list, which comes from
 * {@link getRsbuildBuilderDocgenPackages}.
 * https://github.com/storybookjs/storybook/blob/4b5e9a60c55c6d3659ffa3118881b8904b41c021/code/renderers/react/src/builder-docgen.ts#L56-L100
 *
 * @returns The mode builder docgen runs in, or `undefined` when it must not run.
 * @throws {BuilderDocgenPackagesMissingError} When the main config sets `features.docgenServer:
 *   false` and packages are missing.
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
  const packages = getRsbuildBuilderDocgenPackages(mode)
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
