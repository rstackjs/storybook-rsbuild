import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, rs } from 'rstack/test'
import { logger, once } from 'storybook/internal/node-logger'
import {
  getReactBuilderDocgenPackages,
  isReactBuilderDocgenPackageInstalled,
  prepareReactBuilderDocgen,
  REACT_BUILDER_DOCGEN_PACKAGES,
} from '../src/builder-docgen'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
  rs.restoreAllMocks()
  // `once` remembers messages for the whole process.
  once.clear()
})

/** Create a project with fake installed packages and a main config. */
function createProject({
  packages,
  docgenServer,
}: {
  packages: Record<string, string>
  docgenServer?: boolean
}) {
  const dir = mkdtempSync(join(tmpdir(), 'sb-rsbuild-builder-docgen-'))
  tempDirs.push(dir)
  for (const [name, version] of Object.entries(packages)) {
    const packageDir = join(dir, 'node_modules', name)
    mkdirSync(packageDir, { recursive: true })
    writeFileSync(
      join(packageDir, 'package.json'),
      JSON.stringify({ name, version, main: 'index.js' }),
    )
    writeFileSync(join(packageDir, 'index.js'), '')
  }
  const configDir = join(dir, '.storybook')
  mkdirSync(configDir)
  writeFileSync(
    join(configDir, 'main.js'),
    `export default { stories: [], features: ${JSON.stringify(
      docgenServer === undefined ? {} : { docgenServer },
    )} }`,
  )
  const resolve = (specifier: string) => {
    const [scope, name] = specifier.split('/')
    const packageName = specifier.startsWith('@') ? `${scope}/${name}` : scope
    const rest = specifier.slice(packageName.length + 1) || 'index.js'
    const file = join(dir, 'node_modules', packageName, rest)
    try {
      statSync(file)
    } catch {
      throw new Error(`Cannot find ${specifier}`)
    }
    return pathToFileURL(file).href
  }
  return { configDir, resolve }
}

const TS_5 = { typescript: '5.9.3' }
const TS_7 = { typescript: '7.0.0' }

describe('getReactBuilderDocgenPackages', () => {
  it('needs react-docgen for the react-docgen mode', () => {
    expect(getReactBuilderDocgenPackages('react-docgen')).toEqual([
      'react-docgen',
    ])
  })

  it('needs only react-docgen-typescript for the react-docgen-typescript mode, since the plugin is vendored', () => {
    expect(getReactBuilderDocgenPackages('react-docgen-typescript')).toEqual([
      'react-docgen-typescript',
    ])
  })

  it.each([false, undefined] as const)('needs nothing for %s', (mode) => {
    expect(getReactBuilderDocgenPackages(mode)).toEqual([])
  })
})

describe('isReactBuilderDocgenPackageInstalled', () => {
  it('rejects a version outside the supported range', () => {
    const { resolve } = createProject({ packages: { 'react-docgen': '5.4.3' } })
    expect(isReactBuilderDocgenPackageInstalled(resolve, 'react-docgen')).toBe(
      false,
    )
  })

  it('accepts a supported version', () => {
    const { resolve } = createProject({ packages: { 'react-docgen': '8.0.4' } })
    expect(isReactBuilderDocgenPackageInstalled(resolve, 'react-docgen')).toBe(
      true,
    )
  })
})

describe('prepareReactBuilderDocgen', () => {
  it('keeps react-docgen-typescript when typescript has a compiler API', async () => {
    const { configDir, resolve } = createProject({
      packages: {
        ...TS_5,
        'react-docgen-typescript': REACT_BUILDER_DOCGEN_PACKAGES[
          'react-docgen-typescript'
        ].replace('^', ''),
      },
    })

    await expect(
      prepareReactBuilderDocgen({
        reactDocgen: 'react-docgen-typescript',
        resolve,
        options: { configDir },
      }),
    ).resolves.toBe('react-docgen-typescript')
  })

  it('falls back to react-docgen when typescript is TypeScript 7', async () => {
    const { configDir, resolve } = createProject({
      packages: { ...TS_7, 'react-docgen': '8.0.4' },
    })

    await expect(
      prepareReactBuilderDocgen({
        reactDocgen: 'react-docgen-typescript',
        resolve,
        options: { configDir },
      }),
    ).resolves.toBe('react-docgen')
  })

  it('falls back to react-docgen when typescript is missing', async () => {
    const { configDir, resolve } = createProject({
      packages: { 'react-docgen': '8.0.4' },
    })

    await expect(
      prepareReactBuilderDocgen({
        reactDocgen: 'react-docgen-typescript',
        resolve,
        options: { configDir },
      }),
    ).resolves.toBe('react-docgen')
  })

  it('throws when the main config sets docgenServer: false and packages are missing', async () => {
    const { configDir, resolve } = createProject({
      packages: TS_5,
      docgenServer: false,
    })

    await expect(
      prepareReactBuilderDocgen({
        reactDocgen: 'react-docgen',
        resolve,
        options: { configDir },
      }),
    ).rejects.toThrow(/react-docgen/)
  })

  it('does not run builder docgen, and does not throw, when packages are missing without an explicit docgenServer: false', async () => {
    const warn = rs.spyOn(logger, 'warn').mockImplementation(() => {})
    const { configDir, resolve } = createProject({ packages: TS_5 })

    await expect(
      prepareReactBuilderDocgen({
        reactDocgen: 'react-docgen',
        resolve,
        options: { configDir },
      }),
    ).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
  })

  it('warns about the deprecation only when the main config sets docgenServer: false', async () => {
    const warn = rs.spyOn(logger, 'warn').mockImplementation(() => {})
    const { configDir, resolve } = createProject({
      packages: { ...TS_5, 'react-docgen': '8.0.4' },
      docgenServer: false,
    })

    await expect(
      prepareReactBuilderDocgen({
        reactDocgen: 'react-docgen',
        resolve,
        options: { configDir },
      }),
    ).resolves.toBe('react-docgen')
    expect(String(warn.mock.calls[0]?.[0])).toContain(
      'features.docgenServer: false',
    )
  })

  it('stays quiet when builder docgen is the default fallback', async () => {
    const warn = rs.spyOn(logger, 'warn').mockImplementation(() => {})
    const { configDir, resolve } = createProject({
      packages: { ...TS_5, 'react-docgen': '8.0.4' },
    })

    await expect(
      prepareReactBuilderDocgen({
        reactDocgen: 'react-docgen',
        resolve,
        options: { configDir },
      }),
    ).resolves.toBe('react-docgen')
    expect(warn).not.toHaveBeenCalled()
  })
})
