import { createRequire } from 'node:module'
import type { RsbuildConfig } from '@rsbuild/core'
import { describe, expect, it } from '@rstest/core'
import { rsbuildFinal } from '../src/preset'

const require = createRequire(import.meta.url)

type RsbuildFinalOptions = Parameters<typeof rsbuildFinal>[1]

const createOptions = (developmentModeForBuild: boolean) =>
  ({
    features: { developmentModeForBuild },
    presets: {
      apply: async () => ({ experimentalDocgenServer: true }),
    },
  }) as unknown as RsbuildFinalOptions

describe('rsbuildFinal', () => {
  it('aliases the framework-resolved renderer without overriding users', async () => {
    const defaultResult = await rsbuildFinal({}, createOptions(false))
    const userResult = await rsbuildFinal(
      {
        resolve: {
          alias: {
            '@storybook/react': '/user/storybook-react',
          },
        },
      },
      createOptions(false),
    )

    expect(defaultResult.resolve?.alias).toMatchObject({
      '@storybook/react': require.resolve('@storybook/react'),
    })
    expect(userResult.resolve?.alias).toMatchObject({
      '@storybook/react': '/user/storybook-react',
    })
  })

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

  it('does not add a development NODE_ENV define when disabled', async () => {
    const disabledConfig: RsbuildConfig = {}

    const result = await rsbuildFinal(disabledConfig, createOptions(false))

    expect(result.source?.define?.['process.env.NODE_ENV']).toBeUndefined()
  })
})
