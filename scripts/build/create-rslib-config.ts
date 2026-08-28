import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'

import type { RslibConfig, RslibConfigAsyncFn, Rspack } from '@rslib/core'
import type { BuildEntries, BuildEntry } from './utils/entry-utils.ts'
import { RUNTIME_EXTERNAL_EXCLUDE } from './utils/entry-utils.ts'
import { generatePackageJsonFile } from './utils/generate-package-json.ts'
import {
  BROWSER_TARGETS,
  NODE_TARGET,
  SUPPORTED_FEATURES,
} from './utils/rslib-constants.ts'

export type { BuildEntries } from './utils/entry-utils.ts'

type CreateRslibConfigOptions = {
  dtsBundleTsconfigPath?: string
  define?: Record<string, string>
  disableUrlParsingFor?: RegExp
}

const browserSyntax = BROWSER_TARGETS.map(toBrowserslistTarget)
const browserForcedTransforms =
  SUPPORTED_FEATURES['class-static-blocks'] === false
    ? ['transform-class-static-block']
    : []

export function createRslibConfig(
  packageDir: string,
  buildConfig: BuildEntries,
  options: CreateRslibConfigOptions = {},
): RslibConfigAsyncFn {
  const browserEntries = buildConfig.entries.browser ?? []
  const nodeEntries = buildConfig.entries.node ?? []
  const hasBrowserEntries = browserEntries.length > 0
  const watchMode = isWatchMode()
  const skipDts = watchMode && process.env.SB_WATCH_DTS !== 'true'

  return async (): Promise<RslibConfig> => {
    if (!watchMode) {
      await generatePackageJsonFile(packageDir, buildConfig)
    }

    const packageJson = JSON.parse(
      await readFile(join(packageDir, 'package.json'), 'utf8'),
    ) as { name: string }
    const externals = [
      createPackageExternal('sb-original'),
      createPackageExternal(packageJson.name),
    ]
    const lib = [
      createBrowserLibItem(
        'browser-dts',
        browserEntries.filter(({ dts }) => dts !== false),
        true,
        skipDts,
        options,
      ),
      createBrowserLibItem(
        'browser-js',
        browserEntries.filter(({ dts }) => dts === false),
        false,
        skipDts,
        options,
      ),
      createNodeLibItem(
        'node-dts',
        nodeEntries.filter(({ dts }) => dts !== false),
        true,
        hasBrowserEntries,
        skipDts,
        options,
      ),
      createNodeLibItem(
        'node-js',
        nodeEntries.filter(({ dts }) => dts === false),
        false,
        hasBrowserEntries,
        skipDts,
        options,
      ),
    ].filter((item) => item !== undefined)

    return {
      bundle: true,
      format: 'esm',
      output: {
        autoExternal: {
          exclude: RUNTIME_EXTERNAL_EXCLUDE,
        },
        cleanDistPath: !skipDts,
        distPath: {
          root: './dist',
        },
        externals,
        legalComments: 'none',
        ...(!hasBrowserEntries && { target: 'node' as const }),
      },
      ...(!hasBrowserEntries && {
        shims: createEsmShims(),
        syntax: [NODE_TARGET],
      }),
      lib,
    }
  }
}

function createBrowserLibItem(
  id: 'browser-dts' | 'browser-js',
  entries: BuildEntry[],
  dts: boolean,
  skipDts: boolean,
  options: CreateRslibConfigOptions,
) {
  if (entries.length === 0) {
    return undefined
  }

  return {
    id,
    dts: dts && !skipDts ? createDtsConfig(options) : false,
    output: {
      target: 'web' as const,
    },
    source: createSourceConfig(entries, options),
    syntax: browserSyntax,
    tools: {
      swc: {
        env: {
          include: browserForcedTransforms,
        },
      },
    },
  }
}

function createNodeLibItem(
  id: 'node-dts' | 'node-js',
  entries: BuildEntry[],
  dts: boolean,
  hasBrowserEntries: boolean,
  skipDts: boolean,
  options: CreateRslibConfigOptions,
) {
  if (entries.length === 0) {
    return undefined
  }

  const tools = createNodeTools(hasBrowserEntries, options)

  return {
    id,
    dts: dts && !skipDts ? createDtsConfig(options) : false,
    ...(hasBrowserEntries && {
      output: {
        target: 'node' as const,
      },
      shims: createEsmShims(),
      syntax: [NODE_TARGET],
    }),
    source: createSourceConfig(entries, options),
    ...(tools && { tools }),
  }
}

function createDtsConfig(options: CreateRslibConfigOptions) {
  return {
    bundle: {
      bundledPackages: [],
      ...(options.dtsBundleTsconfigPath && {
        tsconfigPath: options.dtsBundleTsconfigPath,
      }),
    },
  }
}

function createSourceConfig(
  entries: BuildEntry[],
  options: CreateRslibConfigOptions,
) {
  return {
    ...(options.define && { define: options.define }),
    entry: toSourceEntries(entries),
  }
}

function createNodeTools(
  hasBrowserEntries: boolean,
  options: CreateRslibConfigOptions,
) {
  if (!hasBrowserEntries && !options.disableUrlParsingFor) {
    return undefined
  }

  return {
    rspack(config: Rspack.Configuration) {
      if (options.disableUrlParsingFor) {
        config.module ??= {}
        config.module.rules ??= []
        config.module.rules.push({
          include: options.disableUrlParsingFor,
          parser: {
            url: false,
          },
        })
      }
      config.output ??= {}
      config.output.chunkFilename = 'chunks/[name]-[contenthash:8].js'
    },
  }
}

function createEsmShims() {
  return {
    esm: {
      __dirname: true,
      __filename: true,
      require: true,
    },
  }
}

function toSourceEntries(entries: BuildEntry[]) {
  return Object.fromEntries(
    entries.map(({ entryPoint }) => [
      entryPoint.slice('./src/'.length, -extname(entryPoint).length),
      entryPoint,
    ]),
  )
}

function toBrowserslistTarget(target: string) {
  const match = /^(chrome|edge|firefox|safari|ios|opera)([\d.]+)$/.exec(target)
  if (!match) {
    throw new Error(`Unsupported browser target: ${target}`)
  }

  const [, engine, version] = match
  return `${engine === 'ios' ? 'ios_saf' : engine} >= ${version}`
}

function createPackageExternal(packageName: string) {
  const escapedPackageName = packageName.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&')
  return new RegExp(`^${escapedPackageName}(?:$|[/\\\\])`)
}

function isWatchMode() {
  return process.argv.some(
    (argument) => argument === '--watch' || argument === '-w',
  )
}
