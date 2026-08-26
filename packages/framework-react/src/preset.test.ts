import type { RsbuildConfig } from '@rsbuild/core'
import { describe, expect, it } from '@rstest/core'
import { rsbuildFinal } from './preset'

type RsbuildFinalOptions = Parameters<typeof rsbuildFinal>[1]

const createOptions = (developmentModeForBuild: boolean) =>
  ({
    features: { developmentModeForBuild },
    presets: {
      apply: async () => ({ experimentalDocgenServer: true }),
    },
  }) as unknown as RsbuildFinalOptions

describe('rsbuildFinal', () => {
  it('adds a development NODE_ENV define when the feature is enabled', async () => {
    const config: RsbuildConfig = {
      source: {
        define: {
          EXISTING: JSON.stringify(true),
        },
      },
    }

    const result = await rsbuildFinal(config, createOptions(true))

    expect(result.source?.define).toMatchObject({
      EXISTING: JSON.stringify(true),
      'process.env.NODE_ENV': JSON.stringify('development'),
    })
  })

  it('leaves the config unchanged when the feature is disabled', async () => {
    const disabledConfig: RsbuildConfig = {}

    await expect(
      rsbuildFinal(disabledConfig, createOptions(false)),
    ).resolves.toBe(disabledConfig)
  })
})
