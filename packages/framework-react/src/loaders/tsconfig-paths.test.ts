import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from '@rstest/core'
import { getTsconfigPathsBaseDir } from './tsconfig-paths'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('getTsconfigPathsBaseDir', () => {
  it('uses the parent config directory when paths are inherited without baseUrl', () => {
    const dir = createTempProject({
      'tsconfig.base.json': JSON.stringify({
        compilerOptions: {
          paths: {
            '@tools/my-plugin': ['./tools/my-plugin/src'],
            '@tools/my-plugin/*': ['./tools/my-plugin/src/*'],
          },
        },
      }),
      'test-app/tsconfig.json': JSON.stringify({
        extends: '../tsconfig.base.json',
        compilerOptions: {
          module: 'esnext',
        },
      }),
    })

    expect(getTsconfigPathsBaseDir(join(dir, 'test-app/tsconfig.json'))).toBe(
      dir,
    )
  })

  it('uses the resolved parent baseUrl when the parent defines both baseUrl and paths', () => {
    const dir = createTempProject({
      'tsconfig.base.json': JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          paths: {
            '@tools/my-plugin/*': ['./tools/my-plugin/src/*'],
          },
        },
      }),
      'test-app/tsconfig.json': JSON.stringify({
        extends: '../tsconfig.base.json',
      }),
    })

    expect(getTsconfigPathsBaseDir(join(dir, 'test-app/tsconfig.json'))).toBe(
      dir,
    )
  })

  it('uses the leaf directory when a single tsconfig defines paths without baseUrl', () => {
    const dir = createTempProject({
      'tsconfig.json': JSON.stringify({
        compilerOptions: {
          paths: {
            '@lib/*': ['./src/lib/*'],
          },
        },
      }),
    })

    expect(getTsconfigPathsBaseDir(join(dir, 'tsconfig.json'))).toBe(dir)
  })

  it('resolves an explicit baseUrl relative to the config that defined it', () => {
    const dir = createTempProject({
      'tsconfig.json': JSON.stringify({
        compilerOptions: {
          baseUrl: 'src',
          paths: {
            '@/*': ['./*'],
          },
        },
      }),
    })

    expect(getTsconfigPathsBaseDir(join(dir, 'tsconfig.json'))).toBe(
      join(dir, 'src'),
    )
  })

  it('uses the leaf directory when the child defines its own paths', () => {
    const dir = createTempProject({
      'tsconfig.base.json': JSON.stringify({
        compilerOptions: {
          paths: {
            '@tools/*': ['./tools/*'],
          },
        },
      }),
      'test-app/tsconfig.json': JSON.stringify({
        extends: '../tsconfig.base.json',
        compilerOptions: {
          paths: {
            '@app/*': ['./src/*'],
          },
        },
      }),
    })

    expect(getTsconfigPathsBaseDir(join(dir, 'test-app/tsconfig.json'))).toBe(
      join(dir, 'test-app'),
    )
  })
})

function createTempProject(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'storybook-tsconfig-'))
  tempDirs.push(dir)

  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = join(dir, relativePath)
    mkdirSync(dirname(fullPath), { recursive: true })
    writeFileSync(fullPath, content, 'utf-8')
  }

  return dir
}
