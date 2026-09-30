import { afterEach, describe, expect, it, rs } from '@rstest/core'
import { readdirSync, readFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import ts from 'typescript'
import reactDocgenTypescript from '../index'

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
  }

  const close = () => {
    for (const handler of closeHandlers) {
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

  return { api, runTasks, close }
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

  const run = async (action: 'dev' | 'build') => {
    const watchFile = rs.spyOn(ts.sys, 'watchFile')
    const watchDirectory = rs.spyOn(ts.sys, 'watchDirectory')
    const plugin = reactDocgenTypescript({
      tsconfigPath: tsconfigPathForTest,
    })

    const { api, runTasks, close } = createMockApi(
      defaultPropValueFixture,
      action,
    )
    plugin.setup(api as any)
    const res = await runTasks()
    const watchers =
      watchFile.mock.calls.length + watchDirectory.mock.calls.length
    close()

    return { res, watchers }
  }

  it('creates no file watchers during a static build', async () => {
    const dev = await run('dev')
    rs.restoreAllMocks()
    const build = await run('build')

    expect(dev.watchers).toBeGreaterThan(0)
    expect(build.watchers).toBe(0)
    expect(build.res).toEqual(dev.res)
  })
})
