import { mergeRsbuildConfig, type RsbuildConfig } from '@rsbuild/core'
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

/**
 * Strips fields that are unsafe to inherit into the Storybook preview build.
 *
 * @internal For use by official Storybook Rsbuild packages only. This API is subject to change at
 * any time and should not be used in user configuration.
 */
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

/**
 * Merges the selected environment over the top-level config and drops `environments`.
 * Stripping is the caller's job; see `stripInheritedConfig`.
 *
 * @internal For use by official Storybook Rsbuild packages only. This API is subject to change at
 * any time and should not be used in user configuration.
 */
export function pickRsbuildEnvironment(
  config: { [K in keyof RsbuildConfig]?: unknown },
  { environment, source }: { environment?: string; source: string },
): RsbuildConfig {
  // Accept configs from another installed Rsbuild version at this shared boundary.
  const { environments = {}, ...topLevel } = config as RsbuildConfig
  const names = Object.keys(environments)
  if (environment !== undefined && !names.includes(environment)) {
    throw new Error(
      `The specified environment "${environment}" is not found in ${source}.`,
    )
  }
  if (names.length > 1 && environment === undefined) {
    throw new Error(
      `You must specify an environment when there are multiple environments in ${source}.`,
    )
  }
  const selected = environment ?? names[0]
  return selected
    ? mergeRsbuildConfig(topLevel, environments[selected])
    : topLevel
}
