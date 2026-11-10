import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'rstack/test'
import { REACT_BUILDER_DOCGEN_PACKAGES } from '../packages/framework-react/src/builder-docgen'

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

  it('declares the builder docgen packages of framework-react as optional peers with the supported ranges', () => {
    const pkg = readPackageJson('framework-react')

    for (const [name, range] of Object.entries(REACT_BUILDER_DOCGEN_PACKAGES)) {
      expect(pkg.peerDependencies?.[name]).toBe(range)
      expect(pkg.peerDependenciesMeta?.[name]?.optional).toBe(true)
      expect(pkg.dependencies?.[name]).toBeUndefined()
    }
  })

  it('declares the webpack react-docgen-typescript plugin as an optional peer, as upstream does', () => {
    const pkg = readPackageJson('framework-react')
    const name = '@storybook/react-docgen-typescript-plugin'

    expect(pkg.peerDependencies?.[name]).toBe('1.0.6--canary.9.0c3f3b7.0')
    expect(pkg.peerDependenciesMeta?.[name]?.optional).toBe(true)
    expect(pkg.dependencies?.[name]).toBeUndefined()
  })
})
