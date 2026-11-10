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
 * https://github.com/storybookjs/storybook/blob/4b5e9a60c55c6d3659ffa3118881b8904b41c021/code/renderers/react/src/builder-docgen.ts#L56-L100
 *
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
  // Intentional divergence: upstream's `getReactBuilderDocgenPackages` adds a builder plugin package in
  // `react-docgen-typescript` mode; this repo runs its vendored plugin, so the mode is the only package.
  // https://github.com/storybookjs/storybook/blob/4b5e9a60c55c6d3659ffa3118881b8904b41c021/code/renderers/react/src/builder-docgen.ts#L32-L48
  const packages: ReactBuilderDocgenPackage[] = [mode]
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
