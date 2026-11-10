import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'rstack/test'

type PackageJson = {
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
}

const readPackageJson = (dir: string): PackageJson =>
  JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL(`../packages/${dir}/package.json`, import.meta.url),
      ),
      'utf-8',
    ),
  )

// The supported ranges come from the renderer, resolved the way `framework-react` resolves it.
const requireFromFrameworkReact = createRequire(
  new URL('../packages/framework-react/package.json', import.meta.url),
)
const { REACT_BUILDER_DOCGEN_PACKAGES } = (await import(
  pathToFileURL(
    requireFromFrameworkReact.resolve(
      '@storybook/react/internal/builder-docgen',
    ),
  ).href
)) as { REACT_BUILDER_DOCGEN_PACKAGES: Record<string, string> }
// Only the packages this repo's builder docgen uses; the renderer also lists builder plugins.
const DOCGEN_PEERS = {
  'react-docgen': REACT_BUILDER_DOCGEN_PACKAGES['react-docgen'],
  'react-docgen-typescript':
    REACT_BUILDER_DOCGEN_PACKAGES['react-docgen-typescript'],
}

const TYPESCRIPT_PEER = '^5.9.0 || ^6.0.0 || ^7.0.0'

describe('docgen package contract', () => {
  it.each([
    'framework-react',
    'framework-vue3',
    'framework-react-native-web',
    'framework-web-components',
  ])('%s requires typescript as a peer dependency', (dir) => {
    const pkg = readPackageJson(dir)

    expect(pkg.peerDependencies?.typescript).toBe(TYPESCRIPT_PEER)
    expect(pkg.peerDependenciesMeta?.typescript?.optional).not.toBe(true)
  })

  it.each(['framework-react', 'framework-react-native-web'])(
    '%s declares the builder docgen packages as optional peers with the supported ranges',
    (dir) => {
      const pkg = readPackageJson(dir)

      for (const [name, range] of Object.entries(DOCGEN_PEERS)) {
        expect(pkg.peerDependencies?.[name]).toBe(range)
        expect(pkg.peerDependenciesMeta?.[name]?.optional).toBe(true)
        expect(pkg.dependencies?.[name]).toBeUndefined()
      }
    },
  )

  it('does not declare the webpack react-docgen-typescript plugin: the vendored plugin is used', () => {
    const pkg = readPackageJson('framework-react')
    const name = '@storybook/react-docgen-typescript-plugin'

    expect(pkg.dependencies?.[name]).toBeUndefined()
    expect(pkg.peerDependencies?.[name]).toBeUndefined()
    expect(pkg.peerDependenciesMeta?.[name]).toBeUndefined()
  })
})
