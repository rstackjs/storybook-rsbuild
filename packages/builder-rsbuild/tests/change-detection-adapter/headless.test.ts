// Tests the headless Rsbuild ChangeDetectionAdapter used by `storybook tools`: resolve config is read
// from a real development-mode Rspack compiler created without a server.
import * as rsbuildReal from '@rsbuild/core'
import { describe, expect, it, rs } from '@rstest/core'
import { fileURLToPath } from 'node:url'
import { createHeadlessRsbuildChangeDetectionAdapter } from '../../src/change-detection-adapter/headless'
import { createTestOptions } from '../fixtures/options'

rs.mock('../../src/index', () => ({
  executor: { get: async () => rsbuildReal },
  getConfig: async () => ({
    source: { entry: { index: fileURLToPath(import.meta.url) } },
    resolve: { alias: { '@': '/repo/src' } },
  }),
}))

describe('createHeadlessRsbuildChangeDetectionAdapter', () => {
  it('reads the normalised resolve config from a real Rspack compiler', async () => {
    const { options } = createTestOptions()

    const config =
      await createHeadlessRsbuildChangeDetectionAdapter(
        options,
      ).getResolveConfig()

    expect(config.projectRoot).toBe(process.cwd())
    expect(config.conditions).toEqual(
      expect.arrayContaining(['development', 'browser']),
    )
    expect(config.conditions).not.toContain('...')
    expect(config.alias).toEqual(expect.any(Object))
    expect(Array.isArray(config.alias)).toBe(false)
  })
})
