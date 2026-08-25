import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import stripJsonComments from 'strip-json-comments'

type TsconfigConfig = {
  compilerOptions?: {
    baseUrl?: unknown
    paths?: unknown
  }
  extends?: unknown
}

type PathsBaseResolution = {
  absoluteBaseUrl?: string
  pathsBasePath?: string
}

/**
 * Backport of Storybook's tsconfig paths base resolution. Replace this helper
 * with the official export when the minimum Storybook version provides it.
 *
 * @see https://github.com/storybookjs/storybook/blob/aa5790bb3484153ce3e9fe409e0ab516c2853e58/code/core/src/common/utils/tsconfig.ts
 */
export const getTsconfigPathsBaseDir = (configPath: string): string => {
  const normalizedConfigPath = resolve(configPath)
  const resolved = resolvePathsBase(normalizedConfigPath, new Set())
  return (
    resolved.absoluteBaseUrl ??
    resolved.pathsBasePath ??
    dirname(normalizedConfigPath)
  )
}

function resolvePathsBase(
  configPath: string,
  seen: Set<string>,
): PathsBaseResolution {
  const normalizedConfigPath = resolve(configPath)
  if (seen.has(normalizedConfigPath)) {
    return {}
  }
  seen.add(normalizedConfigPath)

  const config = readTsconfigConfig(normalizedConfigPath)
  if (!config) {
    return {}
  }

  let inherited: PathsBaseResolution = {}
  for (const extendsPath of getExtendsPaths(normalizedConfigPath, config)) {
    const base = resolvePathsBase(extendsPath, seen)
    inherited = {
      absoluteBaseUrl: base.absoluteBaseUrl ?? inherited.absoluteBaseUrl,
      pathsBasePath: base.pathsBasePath ?? inherited.pathsBasePath,
    }
  }

  const ownBaseUrl = config.compilerOptions?.baseUrl
  const ownPaths = config.compilerOptions?.paths

  return {
    absoluteBaseUrl:
      typeof ownBaseUrl === 'string' && ownBaseUrl.length > 0
        ? resolve(dirname(normalizedConfigPath), ownBaseUrl)
        : inherited.absoluteBaseUrl,
    pathsBasePath:
      ownPaths !== undefined &&
      ownPaths !== null &&
      typeof ownPaths === 'object'
        ? dirname(normalizedConfigPath)
        : inherited.pathsBasePath,
  }
}

function getExtendsPaths(configPath: string, config: TsconfigConfig) {
  const rawExtends =
    typeof config.extends === 'string'
      ? [config.extends]
      : Array.isArray(config.extends)
        ? config.extends.filter(
            (value): value is string => typeof value === 'string',
          )
        : []

  return rawExtends.map((extendsPath) =>
    resolveExtendsPath(configPath, extendsPath),
  )
}

function resolveExtendsPath(configPath: string, extendsPath: string) {
  const resolved = resolve(dirname(configPath), extendsPath)
  if (existsSync(resolved)) {
    return resolved
  }

  if (!resolved.endsWith('.json')) {
    const withJson = `${resolved}.json`
    if (existsSync(withJson)) {
      return withJson
    }
  }

  return resolved
}

function readTsconfigConfig(configPath: string): TsconfigConfig | undefined {
  try {
    const content = readFileSync(configPath, 'utf-8')
    return JSON.parse(
      stripJsonComments(content, { trailingCommas: true }),
    ) as TsconfigConfig
  } catch {
    return undefined
  }
}
