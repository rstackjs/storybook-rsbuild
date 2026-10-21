import { describe, expect, it } from '@rstest/core'
import { resolve } from 'node:path'
import { loadAllPresets, resolveAddonName } from 'storybook/internal/common'

const fixtureDir = resolve(__dirname, 'fixtures/vue3-preset-chain')
const configDir = resolve(fixtureDir, '.storybook')
const outputDir = resolve(fixtureDir, 'storybook-static')
const frameworkPreset = resolve(__dirname, '../preset.js')

type LoadOptions = Parameters<typeof loadAllPresets>[0]

const baseOptions = {
  configDir,
  outputDir,
  corePresets: [],
  overridePresets: [],
  packageJson: {},
} as unknown as LoadOptions

describe('Vue 3 preset chain', () => {
  it('composes the docgen provider once', async () => {
    const frameworkPresets = await loadAllPresets({
      ...baseOptions,
      corePresets: [frameworkPreset],
    })
    const { renderer } = (await frameworkPresets.apply('core', {})) as {
      renderer?: string
    }

    expect(renderer).toBeTruthy()

    const rendererPreset = resolveAddonName(configDir, renderer!, baseOptions)
    expect(rendererPreset).toBeTruthy()

    const presets = await loadAllPresets({
      ...baseOptions,
      corePresets: [rendererPreset!, frameworkPreset],
    })
    const providers = await presets.apply<Array<{ moduleSpecifier: string }>>(
      'experimental_docgenProvider',
      [],
    )

    expect(providers).toHaveLength(1)
  })
})
