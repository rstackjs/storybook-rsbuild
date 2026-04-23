import { resolve } from 'node:path'
import { describe, expect, it } from '@rstest/core'
import { loadAllPresets } from 'storybook/internal/common'
import type { Options } from 'storybook/internal/types'
import { isMswActive } from '../../src/preview/detect-msw'

// Uses real loadAllPresets rather than a mocked apply stub so the preset chain
// actually passes staticDirs through. See detect-msw.ts for why the `addons`
// field cannot be observed this way.

const fixtureRoot = resolve(__dirname, '../fixtures')

async function buildOptions(fixture: 'msw-active' | 'msw-absent') {
  const configDir = resolve(fixtureRoot, fixture, '.storybook')
  const presets = await loadAllPresets({
    configDir,
    outputDir: resolve(fixtureRoot, fixture, 'storybook-static'),
    ignorePreview: true,
    corePresets: [],
    overridePresets: [],
    packageJson: {},
  } as unknown as Parameters<typeof loadAllPresets>[0])

  return { configDir, presets }
}

describe('isMswActive (real Storybook presets)', () => {
  it('returns true when mockServiceWorker.js exists in a staticDirs entry', async () => {
    const { configDir, presets } = await buildOptions('msw-active')
    const options = { configDir, presets } as unknown as Options
    await expect(isMswActive(options)).resolves.toBe(true)
  })

  it('returns false when staticDirs is declared but mockServiceWorker.js is absent', async () => {
    const { configDir, presets } = await buildOptions('msw-absent')
    const options = { configDir, presets } as unknown as Options
    await expect(isMswActive(options)).resolves.toBe(false)
  })

  it('returns false when staticDirs is empty', async () => {
    // Drive the contract shape without going through loadAllPresets so we
    // can assert the defensive-default branch.
    const options = {
      configDir: resolve(fixtureRoot, 'msw-active', '.storybook'),
      presets: {
        apply: async <T>(_name: string, fallback?: T) => fallback,
      },
    } as unknown as Options
    await expect(isMswActive(options)).resolves.toBe(false)
  })
})
