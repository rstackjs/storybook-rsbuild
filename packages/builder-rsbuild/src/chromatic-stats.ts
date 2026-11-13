import { isAbsolute, relative } from 'node:path'

const isRecord = (val: unknown): val is Record<string, unknown> =>
  val != null && typeof val === 'object' && Array.isArray(val) === false

// Keep this aligned with Chromatic TurboSnap's minimal stats contract:
// https://github.com/chromaui/chromatic-cli/blob/1426eaec411747af076deca87e7b30c26a9f699a/node-src/types.ts#L377-L390
type ChromaticReason = {
  moduleName: string
}

type ChromaticModule = {
  id: string | number | null
  name: string
  modules?: Array<Pick<ChromaticModule, 'name'>>
  reasons?: ChromaticReason[]
}

type ChromaticMinimalStatsJson = {
  modules: ChromaticModule[]
}

type StatsToJson = (options?: unknown, forToString?: unknown) => unknown

type StatsWithToJson = {
  toJson?: unknown
}

const toPosixPath = (filePath: string): string => filePath.split('\\').join('/')

const toNormalizedModulePath = (modulePath: unknown): string | null => {
  if (typeof modulePath !== 'string' || modulePath.length === 0) {
    return null
  }

  if (isAbsolute(modulePath)) {
    return toPosixPath(relative(process.cwd(), modulePath))
  }

  return toPosixPath(modulePath)
}

const toAbsolutePathFromIdentifier = (identifier: unknown): string | null => {
  if (typeof identifier !== 'string' || identifier.length === 0) {
    return null
  }

  const withoutLoaders = identifier.slice(identifier.lastIndexOf('!') + 1)
  const withoutHash = withoutLoaders.split('|')[0]
  const withoutQuery = withoutHash.split('?')[0]
  return isAbsolute(withoutQuery) ? withoutQuery : null
}

const toReasonModuleName = (reason: Record<string, unknown>): string | null => {
  const moduleName =
    typeof reason.moduleName === 'string' ? reason.moduleName : null

  if (
    typeof moduleName === 'string' &&
    /\s\+\s\d+\smodules?$/.test(moduleName) === false
  ) {
    return moduleName
  }

  const fallbackAbsolutePath =
    toAbsolutePathFromIdentifier(reason.resolvedModuleIdentifier) ??
    toAbsolutePathFromIdentifier(reason.moduleIdentifier)
  const fallbackModuleName = toNormalizedModulePath(fallbackAbsolutePath)

  if (
    typeof fallbackModuleName === 'string' &&
    fallbackModuleName.includes('node_modules/') === false
  ) {
    return fallbackModuleName
  }

  return moduleName
}

const CONCATENATED_MODULE_SUFFIX = /\s\+\s\d+\smodules?$/

const isConcatenatedModuleName = (moduleName: string): boolean =>
  CONCATENATED_MODULE_SUFFIX.test(moduleName)

// Entries without an id are named from `nameForCondition` (`src/a.ts`), while
// the module itself is `./src/a.ts`, so key modules by path without `./`.
const toModulePathKey = (moduleName: string): string =>
  moduleName.replace(/^\.\//, '')

const toChromaticModule = (
  moduleInfo: Record<string, unknown>,
): ChromaticModule | null => {
  const rawName = typeof moduleInfo.name === 'string' ? moduleInfo.name : null
  const normalizedNameForCondition = toNormalizedModulePath(
    moduleInfo.nameForCondition,
  )
  const name =
    moduleInfo.id == null && normalizedNameForCondition
      ? normalizedNameForCondition
      : (rawName ?? normalizedNameForCondition)

  if (typeof name !== 'string') {
    return null
  }

  const normalizedOriginalId =
    typeof moduleInfo.id === 'string' || typeof moduleInfo.id === 'number'
      ? moduleInfo.id
      : null
  const normalizedId = normalizedOriginalId ?? name

  const normalizedReasons = Array.isArray(moduleInfo.reasons)
    ? Array.from(
        new Set(
          moduleInfo.reasons
            .filter(isRecord)
            .map(toReasonModuleName)
            .filter(
              (moduleName): moduleName is string =>
                typeof moduleName === 'string',
            ),
        ),
      ).map((moduleName) => ({
        moduleName,
      }))
    : []

  const normalizedNestedModules = Array.isArray(moduleInfo.modules)
    ? Array.from(
        new Set(
          moduleInfo.modules
            .filter(isRecord)
            .map((nestedModule) => toNormalizedModulePath(nestedModule.name))
            .filter(
              (nestedModuleName): nestedModuleName is string =>
                typeof nestedModuleName === 'string',
            ),
        ),
      ).map((nestedModuleName) => ({
        name: nestedModuleName,
      }))
    : []

  if (
    normalizedId === null &&
    normalizedReasons.length === 0 &&
    normalizedNestedModules.length === 0
  ) {
    return null
  }

  return {
    id: normalizedId,
    name,
    ...(normalizedNestedModules.length > 0
      ? { modules: normalizedNestedModules }
      : {}),
    ...(normalizedReasons.length > 0 ? { reasons: normalizedReasons } : {}),
  }
}

const collectModuleEntries = (
  moduleEntries: unknown[],
  collected: Record<string, unknown>[],
): void => {
  for (const entry of moduleEntries) {
    if (!isRecord(entry)) {
      continue
    }

    collected.push(entry)

    if (Array.isArray(entry.children)) {
      collectModuleEntries(entry.children, collected)
    }

    if (Array.isArray(entry.modules)) {
      collectModuleEntries(entry.modules, collected)
    }
  }
}

export const withChromaticMinimalContract = (statsJson: unknown): unknown => {
  if (!isRecord(statsJson)) {
    return statsJson
  }

  const modules = statsJson.modules
  if (!Array.isArray(modules)) {
    return statsJson
  }

  const normalizedStatsJson = statsJson as ChromaticMinimalStatsJson &
    Record<string, unknown>
  const flattenedModules: Record<string, unknown>[] = []
  collectModuleEntries(modules, flattenedModules)

  // One entry per path, so a file's importers are never split across entries
  // or dropped as duplicates.
  const modulesByPath = new Map<string, ChromaticModule>()
  const addModule = (module: ChromaticModule): void => {
    const pathKey = toModulePathKey(module.name)
    const existing = modulesByPath.get(pathKey)
    if (!existing) {
      modulesByPath.set(pathKey, module)
      return
    }

    // Chromatic matches story files against `./`-prefixed paths.
    const preferred = module.name.startsWith('./') ? module : existing
    const reasons = [...(existing.reasons ?? [])]
    for (const reason of module.reasons ?? []) {
      if (!reasons.some(({ moduleName }) => moduleName === reason.moduleName)) {
        reasons.push(reason)
      }
    }
    const modules = existing.modules ?? module.modules
    modulesByPath.set(pathKey, {
      id: preferred.id,
      name: preferred.name,
      ...(modules ? { modules } : {}),
      ...(reasons.length > 0 ? { reasons } : {}),
    })
  }

  for (const moduleInfo of flattenedModules) {
    const normalizedModule = toChromaticModule(moduleInfo)
    if (!normalizedModule) {
      continue
    }

    addModule(normalizedModule)

    if (isConcatenatedModuleName(normalizedModule.name)) {
      // The concatenation's importers import only the module it is named after.
      // Its other inner modules keep the importers rspack reports for them in
      // their own nested entries. Read the root from the container's name: its
      // `modules` list can name the root after the container itself.
      const rootName = normalizedModule.name.replace(
        CONCATENATED_MODULE_SUFFIX,
        '',
      )
      addModule({
        id: rootName,
        name: rootName,
        ...(normalizedModule.reasons
          ? { reasons: normalizedModule.reasons }
          : {}),
      })
    }
  }

  normalizedStatsJson.modules = [...modulesByPath.values()]

  return normalizedStatsJson
}

export const withStatsJsonCompat = <T extends StatsWithToJson>(stats: T): T => {
  const originalToJsonCandidate = stats.toJson
  if (typeof originalToJsonCandidate !== 'function') {
    return stats
  }
  const originalToJson = originalToJsonCandidate.bind(stats) as StatsToJson

  const toJsonWithCompat: StatsToJson = (options, forToString) => {
    if (options == null || typeof options === 'object') {
      const statsJson = originalToJson(
        {
          modules: true,
          reasons: true,
          nestedModules: true,
          ...(options as Record<string, unknown>),
        },
        forToString,
      )

      return withChromaticMinimalContract(statsJson)
    }

    return withChromaticMinimalContract(originalToJson(options, forToString))
  }

  stats.toJson = toJsonWithCompat
  return stats
}
