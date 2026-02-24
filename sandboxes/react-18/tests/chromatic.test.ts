import { resolve } from 'node:path'
import { expect, it } from '@rstest/core'

const previewStatsJsonPath = resolve(
  __dirname,
  '../storybook-static/preview-stats.json',
)

it('Entry for Chromatic should be correct', async () => {
  const { default: content } = (await import(previewStatsJsonPath, {
    with: { type: 'json' },
  })) as { default: Record<string, any> }
  const acceptedReasonTokens = [
    './storybook-config-entry.js + 1 modules',
    './storybook-config-entry.js',
    './storybook-stories.js',
    'storybook-stories.js',
  ]
  const lazyModule = content.modules.filter((module: any) => {
    const reasons = module.reasons || []
    const moduleNames: string[] = reasons.map(
      (reason: any) => reason.moduleName,
    )
    const isLazy = module?.id?.includes('lazy recursive')
    if (isLazy) {
      return acceptedReasonTokens.some((token) =>
        moduleNames.some((name) => name.includes(token)),
      )
    }

    return false
  })

  expect(lazyModule.length).toBe(2)
})
