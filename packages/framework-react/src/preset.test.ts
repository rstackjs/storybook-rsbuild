import type { RsbuildConfig } from '@rsbuild/core'
import { describe, expect, it } from '@rstest/core'
import { rsbuildFinal } from './preset'

type RsbuildFinalOptions = Parameters<typeof rsbuildFinal>[1]

const createOptions = (developmentModeForBuild: boolean) =>
  ({
    features: { developmentModeForBuild },
    presets: {
      apply: async (name: string, defaultValue?: unknown) =>
        name === 'features' ? { experimentalDocgenServer: true } : defaultValue,
    },
  }) as RsbuildFinalOptions

describe('rsbuildFinal', () => {
  it('defines process.env.NODE_ENV only when the feature is enabled', async () => {
    const enabledConfig: RsbuildConfig = {
      source: {
        define: {
          EXISTING: JSON.stringify(true),
        },
      },
    }

    await expect(
      rsbuildFinal(enabledConfig, createOptions(true)),
    ).resolves.toEqual({
      source: {
        define: {
          EXISTING: JSON.stringify(true),
          'process.env.NODE_ENV': JSON.stringify('development'),
        },
      },
    })

    const disabledConfig: RsbuildConfig = {
      source: {
        define: {
          'process.env.NODE_ENV': JSON.stringify('production'),
        },
      },
    }

    await expect(
      rsbuildFinal(disabledConfig, createOptions(false)),
    ).resolves.toBe(disabledConfig)
  })
})
