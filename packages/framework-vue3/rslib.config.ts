import { extname } from 'node:path'

import { defineConfig } from '@rslib/core'
import { getExternal } from '../../scripts/build/utils/entry-utils.ts'
import { generatePackageJsonFile } from '../../scripts/build/utils/generate-package-json.ts'
import {
  BROWSER_TARGETS,
  SUPPORTED_FEATURES,
} from '../../scripts/build/utils/rslib-constants.ts'
import buildConfig from './build-config.ts'

const browserEntries = buildConfig.entries.browser ?? []
const nodeEntries = buildConfig.entries.node ?? []

const toSourceEntries = (entries: typeof nodeEntries) =>
  Object.fromEntries(
    entries.map(({ entryPoint }) => [
      entryPoint.slice('./src/'.length, -extname(entryPoint).length),
      entryPoint,
    ]),
  )

const toBrowserslistTarget = (target: string) => {
  const match = /^(chrome|edge|firefox|safari|ios|opera)([\d.]+)$/.exec(target)
  if (!match) {
    throw new Error(`Unsupported browser target: ${target}`)
  }

  const [, engine, version] = match
  return `${engine === 'ios' ? 'ios_saf' : engine} >= ${version}`
}

const browserSyntax = BROWSER_TARGETS.map(toBrowserslistTarget)
const browserForcedTransforms =
  SUPPORTED_FEATURES?.['class-static-blocks'] === false
    ? ['transform-class-static-block']
    : []

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export default defineConfig(async () => {
  await generatePackageJsonFile(import.meta.dirname, buildConfig)

  const { runtimeExternal } = await getExternal(import.meta.dirname)
  const externals = runtimeExternal.map(
    (dependency) => new RegExp(`^${escapeRegExp(dependency)}(?:/|$)`),
  )

  return {
    bundle: true,
    format: 'esm',
    output: {
      autoExternal: false,
      cleanDistPath: true,
      distPath: {
        root: './dist',
      },
      externals,
      legalComments: 'none',
    },
    lib: [
      {
        id: 'browser-dts',
        dts: {
          bundle: {
            bundledPackages: [],
          },
        },
        output: {
          target: 'web',
        },
        source: {
          entry: toSourceEntries(
            browserEntries.filter(({ dts }) => dts !== false),
          ),
        },
        syntax: browserSyntax,
        tools: {
          swc: {
            env: {
              include: browserForcedTransforms,
            },
          },
        },
      },
      {
        id: 'node-dts',
        dts: {
          bundle: {
            bundledPackages: [],
          },
        },
        output: {
          target: 'node',
        },
        shims: {
          esm: {
            __dirname: true,
            __filename: true,
            require: true,
          },
        },
        source: {
          entry: toSourceEntries(
            nodeEntries.filter(({ dts }) => dts !== false),
          ),
        },
        syntax: ['node >= 20.19'],
        tools: {
          rspack(config) {
            config.output.chunkFilename = 'chunks/[name]-[contenthash:8].js'
          },
        },
      },
      {
        id: 'node-js',
        dts: false,
        output: {
          target: 'node',
        },
        shims: {
          esm: {
            __dirname: true,
            __filename: true,
            require: true,
          },
        },
        source: {
          entry: toSourceEntries(
            nodeEntries.filter(({ dts }) => dts === false),
          ),
        },
        syntax: ['node >= 20.19'],
        tools: {
          rspack(config) {
            config.output.chunkFilename = 'chunks/[name]-[contenthash:8].js'
          },
        },
      },
    ],
  }
})
