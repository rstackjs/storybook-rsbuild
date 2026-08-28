import { extname } from 'node:path'

import { defineConfig } from '@rslib/core'

import { getExternal } from '../../scripts/build/utils/entry-utils.ts'
import { generatePackageJsonFile } from '../../scripts/build/utils/generate-package-json.ts'
import buildConfig from './build-config.ts'

const nodeEntries = buildConfig.entries.node ?? []

const toSourceEntries = (entries: typeof nodeEntries) =>
  Object.fromEntries(
    entries.map(({ entryPoint }) => [
      entryPoint.slice('./src/'.length, -extname(entryPoint).length),
      entryPoint,
    ]),
  )

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export default defineConfig(async () => {
  await generatePackageJsonFile(import.meta.dirname, buildConfig)

  const { runtimeExternal } = await getExternal(import.meta.dirname)
  const externals = runtimeExternal.map(
    (dependency) => new RegExp(`^${escapeRegExp(dependency)}(?:/|$)`),
  )
  const define =
    process.env.SB_RSBUILD_TEST_MINIMAL_DEV === 'true'
      ? {
          'process.env.SB_RSBUILD_TEST_MINIMAL_DEV': JSON.stringify('true'),
        }
      : {}

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
      target: 'node',
    },
    shims: {
      esm: {
        __dirname: true,
        __filename: true,
        require: true,
      },
    },
    syntax: ['node >= 20.19'],
    lib: [
      {
        id: 'node-dts',
        dts: {
          bundle: {
            bundledPackages: [],
          },
        },
        source: {
          define,
          entry: toSourceEntries(
            nodeEntries.filter(({ dts }) => dts !== false),
          ),
        },
        tools: {
          rspack(config) {
            config.module ??= {}
            config.module.rules ??= []
            config.module.rules.push({
              include: /builder-rsbuild[\\/]compiled/,
              parser: {
                url: false,
              },
            })
            config.output.chunkFilename = 'chunks/[name]-[contenthash:8].js'
          },
        },
      },
      {
        id: 'node-js',
        dts: false,
        source: {
          define,
          entry: toSourceEntries(
            nodeEntries.filter(({ dts }) => dts === false),
          ),
        },
        tools: {
          rspack(config) {
            config.module ??= {}
            config.module.rules ??= []
            config.module.rules.push({
              include: /builder-rsbuild[\\/]compiled/,
              parser: {
                url: false,
              },
            })
            config.output.chunkFilename = 'chunks/[name]-[contenthash:8].js'
          },
        },
      },
    ],
  }
})
