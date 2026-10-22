import { afterEach, describe, expect, it, rs } from '@rstest/core'
import { readdirSync, readFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import type { ComponentDoc } from 'react-docgen-typescript'
import ts from 'typescript'
import reactDocgenTypescript from '../index'
import { generateDocgenCodeBlock } from '../utils/generate'

const tsconfigPathForTest = resolve(__dirname, 'tsconfig.test.json')
const fixturesPath = resolve(__dirname, '__fixtures__')

const fixtureTests = readdirSync(fixturesPath)
  .map((filename) => join(fixturesPath, filename))
  .map((filename) => ({
    id: filename,
    code: readFileSync(filename, 'utf-8'),
  }))

const defaultPropValueFixture = fixtureTests.find(
  (f) => basename(f.id) === 'DefaultPropValue.tsx',
)

// A simple mocked Rsbuild hook api to get test result.
const createMockApi = (fixture: any, action?: 'dev' | 'build') => {
  const preHandlers: any[] = []
  const closeHandlers: any[] = []
  const closeDevServerHandlers: any[] = []
  let resultHandler: any

  const api = {
    context: { action },
    modifyRsbuildConfig: async (fn: any) => {
      preHandlers.push(fn)
    },
    transform: async (_filter: any, handler: any) => {
      resultHandler = handler
    },
    onCloseBuild: (fn: any) => {
      closeHandlers.push(fn)
    },
    onCloseDevServer: (fn: any) => {
      closeDevServerHandlers.push(fn)
    },
  }

  const fire = (handlers: any[]) => () => {
    for (const handler of handlers) {
      handler()
    }
  }

  const runTasks = async () => {
    for (const handler of preHandlers) {
      await handler()
    }

    const res = await resultHandler({
      code: fixture.code,
      resource: fixture.id,
    })

    return res
  }

  return {
    api,
    runTasks,
    close: fire(closeHandlers),
    closeDevServer: fire(closeDevServerHandlers),
  }
}

const isUnix = process.platform !== 'win32'

describe.runIf(isUnix)('component fixture', () => {
  for (const fixture of fixtureTests) {
    it(`${basename(fixture.id)} has code block generated`, async () => {
      const plugin = reactDocgenTypescript({
        tsconfigPath: tsconfigPathForTest,
      })

      const { api, runTasks } = createMockApi(fixture)
      plugin.setup(api as any)
      const res = await runTasks()
      expect(res).toMatchSnapshot()
    })
  }
})

describe('generateDocgenCodeBlock', () => {
  const createDoc = (displayName: string) =>
    ({
      displayName,
      description: '',
      props: {},
    }) as unknown as ComponentDoc

  it('separates the generated block from a source without a trailing newline', () => {
    const source =
      'export const Button = ({ label }: ButtonProps) => {\n  return <button>{label}</button>\n}'

    const { code } = generateDocgenCodeBlock({
      filename: 'Button.tsx',
      source,
      componentDocs: [createDoc('Button')],
      setDisplayName: false,
      typePropName: 'type',
    })

    expect(code.startsWith(`${source}\n`)).toBe(true)
    expect(code).not.toContain('}try')
  })

  it('separates multiple generated blocks with a newline', () => {
    const source = 'export const Button = () => null\n'
    const { code } = generateDocgenCodeBlock({
      filename: 'Button.tsx',
      source,
      componentDocs: [createDoc('Button'), createDoc('OtherButton')],
      setDisplayName: false,
      typePropName: 'type',
    })

    expect(code).not.toContain('}try')
    expect(code.split('try {')).toHaveLength(3)
  })
})

it.runIf(isUnix)('generates value info for enums', async () => {
  const plugin = reactDocgenTypescript({
    tsconfigPath: tsconfigPathForTest,
    shouldExtractLiteralValuesFromEnum: true,
  })

  const { api, runTasks } = createMockApi(defaultPropValueFixture)
  plugin.setup(api as any)
  const res = await runTasks()
  expect(res).toMatchSnapshot()
})

describe.runIf(isUnix)('file watchers', () => {
  afterEach(() => {
    rs.restoreAllMocks()
  })

  // Runs the plugin on one fixture and reports how many ts.sys watchers it
  // opened and how many are still open after the given close hook fired.
  const run = async (
    action: 'dev' | 'build',
    closeHook: 'close' | 'closeDevServer' = 'close',
  ) => {
    const open = new Set<ts.FileWatcher>()
    let opened = 0
    const track = (watcher: ts.FileWatcher): ts.FileWatcher => {
      opened++
      const tracked: ts.FileWatcher = {
        close: () => {
          open.delete(tracked)
          watcher.close()
        },
      }
      open.add(tracked)
      return tracked
    }
    const { watchFile, watchDirectory } = ts.sys
    rs.spyOn(ts.sys, 'watchFile').mockImplementation((...args) =>
      track(watchFile!(...args)),
    )
    rs.spyOn(ts.sys, 'watchDirectory').mockImplementation((...args) =>
      track(watchDirectory!(...args)),
    )
    const plugin = reactDocgenTypescript({
      tsconfigPath: tsconfigPathForTest,
    })

    const mock = createMockApi(defaultPropValueFixture, action)
    plugin.setup(mock.api as any)
    const res = await mock.runTasks()
    mock[closeHook]()

    return { res, opened, stillOpen: open.size }
  }

  it('creates no file watchers during a static build', async () => {
    const dev = await run('dev')
    rs.restoreAllMocks()
    const build = await run('build')

    expect(dev.opened).toBeGreaterThan(0)
    expect(build.opened).toBe(0)
    expect(build.res).toEqual(dev.res)
  })

  it('closes every file watcher when the dev server closes', async () => {
    const dev = await run('dev', 'closeDevServer')

    expect(dev.opened).toBeGreaterThan(0)
    expect(dev.stillOpen).toBe(0)
  })
})
