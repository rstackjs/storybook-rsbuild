import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from '@rstest/core'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === 'object' && Array.isArray(value) === false

const normalizeModuleRef = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null
  }

  return value.replace(/^\.\//, '')
}

const hasModuleEntry = (
  moduleInfo: Record<string, unknown>,
  moduleName: string,
): boolean => {
  const moduleId = normalizeModuleRef(moduleInfo.id)
  const normalizedName = normalizeModuleRef(moduleInfo.name)

  return (
    moduleId === moduleName &&
    normalizedName != null &&
    normalizedName.startsWith(moduleName)
  )
}

const previewStatsJsonPath = resolve(
  __dirname,
  '../sandboxes/react-18/storybook-static/preview-stats.json',
)

const readPreviewStatsModules = async (): Promise<
  Record<string, unknown>[]
> => {
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
    const modules = await readPreviewStatsModules()

    expect(modules.length).toBeGreaterThan(0)
  })

  it('keeps storybook-config-entry in module graph', async () => {
    const modules = await readPreviewStatsModules()

    const plainConfigEntry = modules.find((moduleInfo) =>
      hasModuleEntry(moduleInfo, 'storybook-config-entry.js'),
    )
    expect(plainConfigEntry).toBeDefined()

    const storiesEntry = modules.find((moduleInfo) =>
      hasModuleEntry(moduleInfo, 'storybook-stories.js'),
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
