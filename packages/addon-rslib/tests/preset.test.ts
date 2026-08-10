import type { RsbuildConfig } from '@rsbuild/core'
import { beforeEach, describe, expect, it, rs } from '@rstest/core'
import { rsbuildFinal } from '../src/preset'
import type { AddonOptions } from '../src/types'

type RsbuildFinalOptions = Parameters<NonNullable<typeof rsbuildFinal>>[1]

const loadConfigMock = rs.hoisted(() => rs.fn())

rs.mock('@rslib/core', () => ({
  loadConfig: loadConfigMock,
}))

const runRsbuildFinal = async (
  content: Record<string, unknown>,
  rslib?: AddonOptions['rslib'],
  config: RsbuildConfig = {},
) => {
  loadConfigMock.mockResolvedValueOnce({ content })
  return rsbuildFinal!(config, { rslib } as RsbuildFinalOptions)
}

describe('rsbuildFinal', () => {
  beforeEach(() => {
    loadConfigMock.mockReset()
  })

  it('uses an implicit lib and merges the top-level config', async () => {
    const storybookPlugin = { name: 'storybook-plugin', setup: rs.fn() }
    const rslibPlugin = { name: 'rslib-plugin', setup: rs.fn() }

    const result = await runRsbuildFinal(
      {
        output: { target: 'web' },
        plugins: [rslibPlugin],
        source: { alias: { '@shared': './src/shared' } },
      },
      undefined,
      { plugins: [storybookPlugin] },
    )

    expect(result).toMatchObject({
      output: { target: 'web' },
      plugins: [storybookPlugin, rslibPlugin],
      source: { alias: { '@shared': './src/shared' } },
    })
  })

  it('throws a friendly error for a missing implicit lib index', async () => {
    await expect(
      runRsbuildFinal({ output: { target: 'web' } }, { libIndex: 1 }),
    ).rejects.toThrow(
      'Lib config not found at index 1, expect a lib config but got undefined',
    )
  })

  it('selects an explicit lib by index', async () => {
    const result = await runRsbuildFinal(
      {
        source: { define: { SHARED: 'true' } },
        lib: [
          { source: { define: { FIRST_LIB: 'true' } } },
          { source: { define: { SECOND_LIB: 'true' } } },
        ],
      },
      { libIndex: 1 },
    )

    expect(result.source?.define).toEqual({
      SHARED: 'true',
      SECOND_LIB: 'true',
    })
  })

  it('ignores explicit libs when libIndex is false', async () => {
    const modifyLibConfig = rs.fn()
    const result = await runRsbuildFinal(
      {
        output: { target: 'web' },
        source: { define: { TOP_LEVEL: 'true' } },
        lib: [
          {
            output: { target: 'node' },
            source: { define: { LIB_ONLY: 'true' } },
          },
        ],
      },
      { libIndex: false, modifyLibConfig },
    )

    expect(modifyLibConfig).toHaveBeenCalledWith({})
    expect(result.output?.target).toBe('web')
    expect(result.source?.define).toEqual({ TOP_LEVEL: 'true' })
  })
})
