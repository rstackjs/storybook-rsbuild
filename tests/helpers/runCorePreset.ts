import { pathToFileURL } from 'node:url'
import { tsImport } from 'tsx/esm/api'

interface CoreResult {
  builderOptions: Record<string, unknown>
  builderName: string
  channelOptions: {
    wsToken?: string
  }
  disableTelemetry: boolean
  renderer: string
}

export async function runCorePreset(presetPath: string): Promise<CoreResult> {
  const { core } = await tsImport(
    pathToFileURL(presetPath).href,
    import.meta.url,
  )

  const config = {
    channelOptions: { wsToken: 'test-token' },
    disableTelemetry: true,
  }
  const framework = { options: { builder: { lazyCompilation: true } } }
  const options = {
    presets: {
      apply: async (name: string) =>
        name === 'framework' ? framework : undefined,
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
