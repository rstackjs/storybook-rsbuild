import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, rs } from 'rstack/test'
import { logger, once } from 'storybook/internal/node-logger'
import { prepareReactBuilderDocgen } from '../src/builder-docgen'

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
  // Only unscoped package names are resolved in these tests.
  const resolve = (specifier: string) => {
    const [name, ...rest] = specifier.split('/')
    const file = join(
      dir,
      'node_modules',
      name,
      ...(rest.length ? rest : ['index.js']),
    )
    if (!existsSync(file)) {
      throw new Error(`Cannot find ${specifier}`)
    }
    return pathToFileURL(file).href
  }
  const run = (reactDocgen: 'react-docgen' | 'react-docgen-typescript') =>
    prepareReactBuilderDocgen({ reactDocgen, resolve, options: { configDir } })
  return { run }
}

const TS_5 = { typescript: '5.9.3' }
const TS_7 = { typescript: '7.0.0' }

describe('prepareReactBuilderDocgen', () => {
  it('keeps react-docgen-typescript when typescript has a compiler API', async () => {
    const { run } = createProject({
      packages: {
        ...TS_5,
        'react-docgen-typescript': '2.2.2',
      },
    })

    await expect(run('react-docgen-typescript')).resolves.toBe(
      'react-docgen-typescript',
    )
  })

  it('falls back to react-docgen when typescript is TypeScript 7', async () => {
    const { run } = createProject({
      packages: { ...TS_7, 'react-docgen': '8.0.4' },
    })

    await expect(run('react-docgen-typescript')).resolves.toBe('react-docgen')
  })

  it('falls back to react-docgen when typescript is missing', async () => {
    const { run } = createProject({
      packages: { 'react-docgen': '8.0.4' },
    })

    await expect(run('react-docgen-typescript')).resolves.toBe('react-docgen')
  })

  it('throws when the main config sets docgenServer: false and packages are missing', async () => {
    const { run } = createProject({
      packages: TS_5,
      docgenServer: false,
    })

    await expect(run('react-docgen')).rejects.toThrow(/react-docgen/)
  })

  it('does not run builder docgen, and does not throw, when packages are missing without an explicit docgenServer: false', async () => {
    const warn = rs.spyOn(logger, 'warn').mockImplementation(() => {})
    const { run } = createProject({ packages: TS_5 })

    await expect(run('react-docgen')).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
  })

  it('warns about the deprecation only when the main config sets docgenServer: false', async () => {
    const warn = rs.spyOn(logger, 'warn').mockImplementation(() => {})
    const { run } = createProject({
      packages: { ...TS_5, 'react-docgen': '8.0.4' },
      docgenServer: false,
    })

    await expect(run('react-docgen')).resolves.toBe('react-docgen')
    expect(String(warn.mock.calls[0]?.[0])).toContain(
      'features.docgenServer: false',
    )
  })

  it('stays quiet when builder docgen is the default fallback', async () => {
    const warn = rs.spyOn(logger, 'warn').mockImplementation(() => {})
    const { run } = createProject({
      packages: { ...TS_5, 'react-docgen': '8.0.4' },
    })

    await expect(run('react-docgen')).resolves.toBe('react-docgen')
    expect(warn).not.toHaveBeenCalled()
  })
})
