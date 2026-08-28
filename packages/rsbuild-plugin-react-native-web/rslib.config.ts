import { basename, extname } from 'node:path'

import { defineConfig } from '@rslib/core'

import { getExternal } from '../../scripts/build/utils/entry-utils.ts'
import { generatePackageJsonFile } from '../../scripts/build/utils/generate-package-json.ts'
import { NODE_TARGET } from '../../scripts/build/utils/rslib-constants.ts'
import buildConfig from './build-config.ts'

const nodeEntries = buildConfig.entries.node ?? []

const toSourceEntries = (entries: typeof nodeEntries) =>
  Object.fromEntries(
    entries.map(({ entryPoint }) => [
      basename(entryPoint, extname(entryPoint)),
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

  return {
    bundle: true,
    format: 'esm',
    syntax: [NODE_TARGET],
    shims: {
      esm: {
        __dirname: true,
        __filename: true,
        require: true,
      },
    },
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
    lib: [
      {
        id: 'node-dts',
        dts: {
          bundle: {
            // Avoid API Extractor traversing unrelated Rsbuild barrel exports.
            tsconfigPath: './tsconfig.dts-bundle.json',
          },
        },
        source: {
          entry: toSourceEntries(
            nodeEntries.filter(({ dts }) => dts !== false),
          ),
        },
      },
    ],
  }
})
