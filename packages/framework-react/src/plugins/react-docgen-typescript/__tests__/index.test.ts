import { readdirSync, readFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { describe, expect, it } from '@rstest/core'
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
const createMockApi = (fixture: any) => {
  const preHandlers: any[] = []
  let resultHandler: any

  const api = {
    modifyRsbuildConfig: async (fn: any) => {
      preHandlers.push(fn)
    },
    transform: async (_filter: any, handler: any) => {
      resultHandler = handler
    },
    onCloseBuild: () => {},
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

  return { api, runTasks }
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
