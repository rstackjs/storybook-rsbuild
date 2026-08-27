/**
 * Code taken from https://github.com/storybookjs/storybook/tree/next/code/presets/react-webpack/src/loaders
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, rs } from '@rstest/core'
import * as docgenResolverActual from '../../src/loaders/docgen-resolver' with {
  rstest: 'importActual',
}
import reactDocgenLoader, {
  getReactDocgenImporter,
} from '../../src/loaders/react-docgen-loader'

const { reactDocgenActual } = rs.hoisted(() => {
  return {
    reactDocgenActual: require('react-docgen') as typeof import('react-docgen'),
  }
})

const reactDocgenMock = rs.hoisted(() => {
  return {
    makeFsImporter: rs.fn().mockImplementation((fn) => fn),
    parse: rs.fn().mockReturnValue([]),
  }
})

const reactDocgenResolverMock = rs.hoisted(() => {
  return {
    defaultLookupModule: rs.fn(),
  }
})

rs.mock('../../src/loaders/docgen-resolver', () => {
  return {
    ...docgenResolverActual,
    defaultLookupModule: reactDocgenResolverMock.defaultLookupModule,
  }
})

rs.mock('react-docgen', () => {
  return {
    ...reactDocgenActual,
    makeFsImporter: reactDocgenMock.makeFsImporter,
    parse: reactDocgenMock.parse,
  }
})

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('reactDocgenLoader function', () => {
  it('uses the referenced tsconfig that owns each file', async () => {
    const dir = createTempProject({
      'tsconfig.json': JSON.stringify({
        files: [],
        references: [{ path: './apps/first' }, { path: './apps/second' }],
      }),
      'apps/first/tsconfig.json': JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          paths: {
            '@ui/props': ['./src/first-props.ts'],
          },
        },
        include: ['src'],
      }),
      'apps/first/src/Button.tsx': 'export const Button = () => null',
      'apps/first/src/first-props.ts': 'export interface Props {}',
      'apps/second/tsconfig.json': JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          paths: {
            '@ui/props': ['./src/second-props.ts'],
          },
        },
        include: ['src'],
      }),
      'apps/second/src/Button.tsx': 'export const Button = () => null',
      'apps/second/src/second-props.ts': 'export interface Props {}',
    })
    const resourcePaths = [
      join(dir, 'apps/first/src/Button.tsx'),
      join(dir, 'apps/second/src/Button.tsx'),
    ]
    const importedPaths: string[] = []

    reactDocgenResolverMock.defaultLookupModule.mockImplementation(
      (filename: string) => filename,
    )
    reactDocgenMock.parse.mockImplementation(
      (
        _source: string,
        options: {
          filename: string
          importer: (filename: string, basedir: string) => string
        },
      ) => {
        importedPaths.push(
          options.importer('@ui/props', dirname(options.filename)),
        )
        return []
      },
    )

    for (const resourcePath of resourcePaths) {
      await runLoader(resourcePath)
    }

    expect(importedPaths).toEqual([
      join(dir, 'apps/first/src/first-props.ts'),
      join(dir, 'apps/second/src/second-props.ts'),
    ])
  })
})

describe('getReactDocgenImporter function', () => {
  it('should not map the request if a tsconfig path mapping is not available', () => {
    const filename = './src/components/Button.tsx'
    const basedir = '/src'
    const imported = getReactDocgenImporter(undefined)
    reactDocgenResolverMock.defaultLookupModule.mockImplementation(
      (filen: string) => filen,
    )
    const result = (imported as any)(filename, basedir)
    expect(result).toBe(filename)
  })

  it('should map the request', () => {
    const mappedFile = './mapped-file.tsx'
    const matchPath = rs.fn().mockReturnValue(mappedFile)
    const filename = './src/components/Button.tsx'
    const basedir = '/src'
    const imported = getReactDocgenImporter(matchPath)
    reactDocgenResolverMock.defaultLookupModule.mockImplementation(
      (filen: string) => filen,
    )
    const result = (imported as any)(filename, basedir)
    expect(result).toBe(mappedFile)
  })

  it('remaps the React Native entry to React Native Web', () => {
    const dir = createTempProject({
      'node_modules/react-native-web/dist/index.js': '',
    })
    const reactNativeEntry = join(dir, 'node_modules/react-native/index.js')
    const reactNativeWebEntry = join(
      dir,
      'node_modules/react-native-web/dist/index.js',
    )
    const imported = getReactDocgenImporter(undefined)
    reactDocgenResolverMock.defaultLookupModule.mockReturnValue(
      reactNativeEntry,
    )

    const result = (imported as any)('react-native', dir)

    expect(result).toBe(reactNativeWebEntry)
  })
})

async function runLoader(resourcePath: string) {
  await reactDocgenLoader.call(
    {
      async: () => rs.fn(),
      getOptions: () => ({}),
      resourcePath,
    } as never,
    'export const Button = () => null',
    undefined,
  )
}

function createTempProject(files: Record<string, string>) {
  const dir = mkdtempSync(join(process.cwd(), '.tmp-react-docgen-loader-'))
  tempDirs.push(dir)

  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = join(dir, relativePath)
    mkdirSync(dirname(fullPath), { recursive: true })
    writeFileSync(fullPath, content, 'utf-8')
  }

  return dir
}
