import type { RsbuildConfig } from '@rsbuild/core'
import { logger } from 'storybook/internal/node-logger'

const inheritedConfigFieldPaths = [
  'source.entry',
  'output.distPath',
  'output.filename',
  'output.cleanDistPath',
  'output.externals',
  'output.assetPrefix',
  'server.publicDir',
  'dev.progressBar',
  'dev.assetPrefix',
  'dev.writeToDisk',
  'tools.htmlPlugin',
  'tools.rspack.output.library',
  'tools.rspack.output.globalObject',
  'tools.rspack.output.umdNamedDefine',
] as const

const stripConfigField = (
  value: unknown,
  segments: string[],
  segmentIndex = 0,
): boolean => {
  if (Array.isArray(value)) {
    let stripped = false
    for (const item of value) {
      stripped = stripConfigField(item, segments, segmentIndex) || stripped
    }
    return stripped
  }

  // Function values are opaque, so function-form tools.rspack entries cannot be stripped.
  if (!value || typeof value !== 'object') {
    return false
  }

  const target = value as Record<string, unknown>
  const field = segments[segmentIndex]
  if (!field) {
    return false
  }

  if (segmentIndex === segments.length - 1) {
    if (target[field] === undefined) {
      return false
    }
    delete target[field]
    return true
  }

  return stripConfigField(target[field], segments, segmentIndex + 1)
}

export const stripInheritedConfig = (
  config: RsbuildConfig,
  source: string,
): string[] => {
  const strippedFields = inheritedConfigFieldPaths.filter((path) =>
    stripConfigField(config, path.split('.')),
  )

  if (strippedFields.length > 0) {
    logger.warn(
      `Stripped incompatible fields from ${source} (${strippedFields.join(', ')}) because they can break the Storybook preview build.`,
    )
  }

  return strippedFields
}
