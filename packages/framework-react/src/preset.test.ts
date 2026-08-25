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
  it('defines NODE_ENV as development when the feature is enabled', async () => {
    const config: RsbuildConfig = {
      source: {
        define: {
          EXISTING: JSON.stringify(true),
        },
      },
    }

    await expect(rsbuildFinal(config, createOptions(true))).resolves.toEqual({
      source: {
        define: {
          EXISTING: JSON.stringify(true),
          NODE_ENV: JSON.stringify('development'),
        },
      },
    })
  })

  it('leaves NODE_ENV unchanged when the feature is disabled', async () => {
    const config: RsbuildConfig = {
      source: {
        define: {
          NODE_ENV: JSON.stringify('production'),
        },
      },
    }

    await expect(rsbuildFinal(config, createOptions(false))).resolves.toBe(
      config,
    )
  })
})
