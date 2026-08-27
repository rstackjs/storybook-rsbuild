import { createJiti } from 'jiti'

interface CoreResult {
  builderOptions: Record<string, unknown>
  builderName: string
  channelOptions: {
    wsToken?: string
  }
  disableTelemetry: boolean
  renderer: string
}

// jiti (not a bundled import or tsx's tsImport) because the preset must run
// as a real module in this process: it uses `import.meta.resolve`, which a
// bundled copy loses, and tsx's tsImport appends `?tsx-namespace` to `node:`
// builtins, which Rstest's module runner treats as file paths.
const jiti = createJiti(import.meta.url)

export async function runCorePreset(presetPath: string): Promise<CoreResult> {
  const { core } = await jiti.import<{
    core: (
      config: Record<string, unknown>,
      options: Record<string, unknown>,
    ) => Promise<{
      channelOptions: CoreResult['channelOptions']
      disableTelemetry: boolean
      builder: { options: Record<string, unknown>; name: string }
      renderer: string
    }>
  }>(presetPath)

  const config = {
    channelOptions: { wsToken: 'test-token' },
    disableTelemetry: true,
  }
  const frameworkOptions = { builder: { lazyCompilation: true } }
  const options = {
    presets: {
      apply: async (name: string) =>
        name === 'frameworkOptions' ? frameworkOptions : undefined,
    },
  }

  const result = await core(config, options)

  return {
    channelOptions: result.channelOptions,
    disableTelemetry: result.disableTelemetry,
    builderOptions: result.builder.options,
    builderName: result.builder.name,
    renderer: result.renderer,
  }
}
