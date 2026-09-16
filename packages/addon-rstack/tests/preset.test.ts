import type { RsbuildConfig } from '@rsbuild/core'
import { afterEach, beforeEach, describe, expect, it, rs } from '@rstest/core'
import { fileURLToPath } from 'node:url'
import * as actualRstackConfig from 'rstack/config' with {
  rstest: 'importActual',
}
import { rsbuildFinal } from '../src/preset'
import type { AddonOptions } from '../src/types'

type RsbuildFinalOptions = Parameters<NonNullable<typeof rsbuildFinal>>[1]
type RstackOptions = NonNullable<AddonOptions['rstack']>
const loadRstackConfigMock = rs.hoisted(() => rs.fn())
rs.mock('rstack/config', () => ({ loadRstackConfig: loadRstackConfigMock }))

const runRsbuildFinal = async (
  configs: Record<string, unknown>,
  rstack?: RstackOptions,
  config: RsbuildConfig = {},
) => {
  loadRstackConfigMock.mockResolvedValueOnce({
    configs,
    dependencies: [],
    filePath: '/project/rstack.config.ts',
  })
  return rsbuildFinal!(config, {
    configType: 'DEVELOPMENT',
    rstack,
  } as unknown as RsbuildFinalOptions)
}

describe('rsbuildFinal', () => {
  const originalNodeEnv = process.env.NODE_ENV
  beforeEach(() => {
    loadRstackConfigMock.mockReset()
    process.env.NODE_ENV = 'development'
  })
  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = originalNodeEnv
  })

  it('throws when no Rstack config file is found', async () => {
    loadRstackConfigMock.mockResolvedValueOnce({
      configs: {},
      dependencies: [],
      filePath: null,
    })
    await expect(
      rsbuildFinal!({}, {
        rstack: { configFilePath: '/missing/rstack.config.ts' },
      } as unknown as RsbuildFinalOptions),
    ).rejects.toThrow(/Rstack config.*not found/i)
  })

  it('throws when the config only defines unrelated tools', async () => {
    await expect(runRsbuildFinal({ lint: {}, test: {} })).rejects.toThrow(
      /define\.app|define\.lib/i,
    )
  })

  it('throws when explicitly selected app config is absent', async () => {
    await expect(
      runRsbuildFinal({ lib: {} }, { stack: { type: 'app' } }),
    ).rejects.toThrow('No define.app()')
  })

  it('prefers app by default and does not execute the lib definition', async () => {
    const app = rs.fn(async () => ({
      source: { define: { SELECTED: '"app"' } },
    }))
    const lib = rs.fn(async () => ({}))
    const result = await runRsbuildFinal({ app, lib })
    expect(app).toHaveBeenCalledTimes(1)
    expect(lib).not.toHaveBeenCalled()
    expect(result.source?.define?.SELECTED).toBe('"app"')
  })

  it('executes only lib when explicitly selected alongside app', async () => {
    const app = rs.fn(() => ({}))
    const lib = rs.fn(async () => ({
      source: { define: { SELECTED: '"lib"' } },
    }))
    const result = await runRsbuildFinal(
      { app, lib },
      { stack: { type: 'lib' } },
    )
    expect(app).not.toHaveBeenCalled()
    expect(lib).toHaveBeenCalledTimes(1)
    expect(result.source?.define?.SELECTED).toBe('"lib"')
  })

  it('delegates app environment selection and stripping while preserving Storybook config', async () => {
    const result = await runRsbuildFinal(
      {
        app: {
          environments: {
            node: { source: { define: { SELECTED: '"node"' } } },
            web: {
              source: {
                entry: { app: './app.ts' },
                define: { SELECTED: '"web"' },
              },
            },
          },
          source: { define: { SELECTED: '"top"' } },
        },
      },
      { stack: { type: 'app', environment: 'web' } },
      { source: { entry: { preview: './preview.ts' } } },
    )
    expect(result.source?.define?.SELECTED).toBe('"web"')
    expect(result.source?.entry).toEqual({ preview: './preview.ts' })
    expect(result.environments).toBeUndefined()
  })

  it('delegates libIndex selection and merges the result', async () => {
    const result = await runRsbuildFinal(
      {
        lib: {
          lib: [
            { source: { define: { SELECTED: '"first"' } } },
            { source: { define: { SELECTED: '"second"' } } },
          ],
        },
      },
      { stack: { type: 'lib', libIndex: 1 } },
      { source: { define: { STORYBOOK: 'true' } } },
    )
    expect(result.source?.define).toEqual({
      SELECTED: '"second"',
      STORYBOOK: 'true',
    })
  })

  it('loads an async lib definition through the real Rstack loader', async () => {
    loadRstackConfigMock.mockImplementationOnce(
      actualRstackConfig.loadRstackConfig,
    )
    process.env.NODE_ENV = 'integration'
    const configFilePath = fileURLToPath(
      new URL('./fixtures/rstack.config.ts', import.meta.url),
    )
    const result = await rsbuildFinal!({}, {
      configType: 'PRODUCTION',
      rstack: { configFilePath },
    } as unknown as RsbuildFinalOptions)
    expect(result.source?.define).toMatchObject({
      FIXTURE_COMMAND: JSON.stringify(process.argv[2]),
      FIXTURE_ENV: JSON.stringify('integration'),
      FIXTURE_ENV_MODE: JSON.stringify('integration'),
      FIXTURE_LIB: JSON.stringify('loaded'),
    })
  })
})
