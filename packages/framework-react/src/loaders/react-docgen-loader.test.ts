/**
 * Code taken from https://github.com/storybookjs/storybook/tree/next/code/presets/react-webpack/src/loaders
 */

import { describe, expect, it, rs } from '@rstest/core'
import * as docgenResolverActual from './docgen-resolver' with {
  rstest: 'importActual',
}
import { getReactDocgenImporter } from './react-docgen-loader'

const { reactDocgenActual } = rs.hoisted(() => {
  return {
    reactDocgenActual: require('react-docgen') as typeof import('react-docgen'),
  }
})

const reactDocgenMock = rs.hoisted(() => {
  return {
    makeFsImporter: rs.fn().mockImplementation((fn) => fn),
  }
})

const reactDocgenResolverMock = rs.hoisted(() => {
  return {
    defaultLookupModule: rs.fn(),
  }
})

rs.mock('./docgen-resolver', () => {
  return {
    ...docgenResolverActual,
    defaultLookupModule: reactDocgenResolverMock.defaultLookupModule,
  }
})

rs.mock('react-docgen', () => {
  return {
    ...reactDocgenActual,
    makeFsImporter: reactDocgenMock.makeFsImporter,
  }
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
})
