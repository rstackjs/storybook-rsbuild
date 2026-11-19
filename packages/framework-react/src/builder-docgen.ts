import {
  REACT_BUILDER_DOCGEN_PACKAGES,
  type ReactBuilderDocgenPackage,
} from '@storybook/react/internal/builder-docgen'
import {
  checkBuilderDocgenPackages,
  getTypeScriptForDocgenError,
  type TypeScriptDocgenApi,
} from 'storybook/internal/common'
import type { Options } from 'storybook/internal/types'

// The renderer does not export its `ReactDocgenConfig` type.
export type ReactDocgenConfig =
  'react-docgen' | 'react-docgen-typescript' | false

// Upstream's `REACT_DOCGEN_TYPESCRIPT_APIS`, mirrored because `@storybook/react`'s `exports` map
// exposes only `internal/builder-docgen`, not the module that declares it.
// https://github.com/storybookjs/storybook/blob/e0ecb3ec6ba3648e9e5d2cf74002adec6aefe561/code/renderers/react/src/docgen-typescript-apis.ts
const REACT_DOCGEN_TYPESCRIPT_APIS: readonly TypeScriptDocgenApi[] = [
  'compiler',
  'native',
]

/**
 * https://github.com/storybookjs/storybook/blob/e0ecb3ec6ba3648e9e5d2cf74002adec6aefe561/code/renderers/react/src/builder-docgen.ts#L70-L106
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
  options: Pick<Options, 'configDir' | 'presets'>
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
  // https://github.com/storybookjs/storybook/blob/e0ecb3ec6ba3648e9e5d2cf74002adec6aefe561/code/renderers/react/src/builder-docgen.ts#L37-L53
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
    apis: REACT_DOCGEN_TYPESCRIPT_APIS,
  })
  return missing.length > 0 ? undefined : mode
}
