import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runSandboxInspect } from './helpers/runSandboxInspect'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === 'object' && Array.isArray(value) === false

const readPreviewStatsModules = async (
  sandboxName: string,
): Promise<Record<string, unknown>[]> => {
  const inspectResult = await runSandboxInspect(sandboxName)
  const previewStatsJsonPath = join(
    inspectResult.outputDir,
    'preview-stats.json',
  )
  const previewStatsJson = JSON.parse(
    await readFile(previewStatsJsonPath, 'utf8'),
  ) as unknown

  if (!isRecord(previewStatsJson) || !Array.isArray(previewStatsJson.modules)) {
    return []
  }

  return previewStatsJson.modules.filter(isRecord)
}

describe('chromatic stats integration', () => {
  it('emits preview stats with modules list for Chromatic', async () => {
    const modules = await readPreviewStatsModules('react-18')

    expect(modules.length).toBeGreaterThan(0)
  })

  it('keeps storybook-config-entry in module graph', async () => {
    const modules = await readPreviewStatsModules('react-18')

    const plainConfigEntry = modules.find(
      (moduleInfo) =>
        moduleInfo.id === './storybook-config-entry.js' &&
        moduleInfo.name === './storybook-config-entry.js',
    )
    expect(plainConfigEntry).toBeDefined()

    const storiesEntry = modules.find(
      (moduleInfo) =>
        moduleInfo.id === './storybook-stories.js' &&
        moduleInfo.name === './storybook-stories.js',
    )
    expect(storiesEntry).toBeDefined()

    const hasConfigEntryReason = modules.some((moduleInfo) => {
      if (!Array.isArray(moduleInfo.reasons)) {
        return false
      }

      return moduleInfo.reasons.some(
        (reason) =>
          isRecord(reason) &&
          typeof reason.moduleName === 'string' &&
          reason.moduleName.includes('./storybook-config-entry.js'),
      )
    })
    expect(hasConfigEntryReason).toBe(true)
  })
})
