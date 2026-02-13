import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runCorePreset } from './helpers/runCorePreset'

const workspaceRoot = fileURLToPath(new URL('..', import.meta.url))

interface CaseItem {
  name: string
  modulePath: string
  expectedRendererSegment: string
}

const CASES: CaseItem[] = [
  {
    name: 'html',
    modulePath: './packages/framework-html/src/preset.ts',
    expectedRendererSegment: '@storybook/html/dist/preset',
  },
  {
    name: 'react',
    modulePath: './packages/framework-react/src/preset.ts',
    expectedRendererSegment: '@storybook/react/dist/preset',
  },
  {
    name: 'react-native-web',
    modulePath: './packages/framework-react-native-web/src/preset.ts',
    expectedRendererSegment: '@storybook/react/dist/preset',
  },
  {
    name: 'vue3',
    modulePath: './packages/framework-vue3/src/preset.ts',
    expectedRendererSegment: '@storybook/vue3/dist/preset',
  },
  {
    name: 'web-components',
    modulePath: './packages/framework-web-components/src/preset.ts',
    expectedRendererSegment: '@storybook/web-components/dist/preset',
  },
]
function normalizePathSeparators(value: string): string {
  return value.replaceAll('\\', '/')
}

describe.each(CASES)('$name core preset', ({
  modulePath,
  expectedRendererSegment,
}) => {
  it('preserves incoming core config while applying builder settings', async () => {
    const result = await runCorePreset(resolve(workspaceRoot, modulePath))

    expect(result.channelOptions).toEqual({ wsToken: 'test-token' })
    expect(result.disableTelemetry).toBe(true)
    expect(result.builderOptions).toEqual({ lazyCompilation: true })
    expect(result.builderName).toBeTruthy()
    expect(normalizePathSeparators(result.renderer)).toContain(
      expectedRendererSegment,
    )
  })
})
