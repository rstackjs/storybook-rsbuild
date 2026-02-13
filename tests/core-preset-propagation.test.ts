import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const workspaceRoot = fileURLToPath(new URL('..', import.meta.url))

interface CaseItem {
  name: string
  modulePath: string
  expectedRendererSegment: string
}

interface CoreResult {
  builderOptions: Record<string, unknown>
  channelOptions: {
    wsToken?: string
  }
  disableTelemetry: boolean
  renderer: string
}

const CASES: CaseItem[] = [
  {
    name: 'vue3',
    modulePath: './packages/framework-vue3/src/preset.ts',
    expectedRendererSegment: '@storybook/vue3',
  },
  {
    name: 'web-components',
    modulePath: './packages/framework-web-components/src/preset.ts',
    expectedRendererSegment: '@storybook/web-components',
  },
]

async function runCorePreset(modulePath: string): Promise<CoreResult> {
  const script = `
import { core } from '${modulePath}';

const config = {
  channelOptions: { wsToken: 'test-token' },
  disableTelemetry: true,
};
const framework = { options: { builder: { lazyCompilation: true } } };
const options = {
  presets: {
    apply: async (name) => (name === 'framework' ? framework : undefined),
  },
};

const result = await core(config, options);
console.log(
  JSON.stringify({
    channelOptions: result.channelOptions,
    disableTelemetry: result.disableTelemetry,
    builderOptions: result.builder.options,
    renderer: result.renderer,
  }),
);
`

  const { stdout } = await execFileAsync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '-e', script],
    {
      cwd: workspaceRoot,
    },
  )

  const output = stdout.trim().split('\n').at(-1)
  if (!output) {
    throw new Error(`No output from core preset runner for ${modulePath}`)
  }
  return JSON.parse(output)
}

function normalizePathSeparators(value: string): string {
  return value.replaceAll('\\', '/')
}

describe.each(CASES)('$name core preset', ({
  modulePath,
  expectedRendererSegment,
}) => {
  it('preserves incoming core config while applying builder settings', async () => {
    const result = await runCorePreset(modulePath)

    expect(result.channelOptions).toEqual({ wsToken: 'test-token' })
    expect(result.disableTelemetry).toBe(true)
    expect(result.builderOptions).toEqual({ lazyCompilation: true })
    expect(normalizePathSeparators(result.renderer)).toContain(
      expectedRendererSegment,
    )
  })
})
