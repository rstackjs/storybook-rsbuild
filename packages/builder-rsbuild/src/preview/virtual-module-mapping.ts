import { join, resolve } from 'node:path'
import slash from 'slash'
import {
  getBuilderOptions,
  loadPreviewOrConfigFile,
  normalizeStories,
  readTemplate,
} from 'storybook/internal/common'
import type { Options, PreviewAnnotation } from 'storybook/internal/types'
import { toImportFn } from '../../compiled/@storybook/core-webpack'
import type { BuilderOptions } from '../types'

export const getVirtualModules = async (options: Options) => {
  const virtualModules: Record<string, string> = {}
  const builderOptions = await getBuilderOptions<BuilderOptions>(options)
  const workingDir = process.cwd()
  const isProd = options.configType === 'PRODUCTION'
  const nonNormalizedStories = await options.presets.apply('stories', [])
  const entries = []

  const stories = normalizeStories(nonNormalizedStories, {
    configDir: options.configDir,
    workingDir,
  })

  const previewAnnotations = [
    ...(
      await options.presets.apply<PreviewAnnotation[]>(
        'previewAnnotations',
        [],
        options,
      )
    ).map((entry) => {
      // If entry is an object, use the absolute import specifier.
      // This is to maintain back-compat with community addons that bundle other addons
      // and package managers that "hide" sub dependencies (e.g. pnpm / yarn pnp)
      if (typeof entry === 'object') {
        return entry.absolute
      }

      return slash(entry)
    }),
    loadPreviewOrConfigFile(options),
  ].filter(Boolean)

  const storiesFilename = 'storybook-stories.js'
  const storiesPath = resolve(join(workingDir, storiesFilename))

  const needPipelinedImport = !!builderOptions.lazyCompilation && !isProd
  virtualModules[storiesPath] = toImportFn(stories, {
    needPipelinedImport,
  })
  // If the entrypoint is changed, remember to sync the change to Chromatic https://github.com/chromaui/chromatic-cli/pull/1206/files.
  // Also ref https://github.com/rstackjs/storybook-rsbuild/issues/332.
  const configEntryPath = resolve(join(workingDir, 'storybook-config-entry.js'))
  virtualModules[configEntryPath] = (
    await readTemplate(
      require.resolve(
        'storybook-builder-rsbuild/templates/virtualModuleModernEntry.js',
      ),
    )
  )
    .replaceAll(`'{{storiesFilename}}'`, `'./${storiesFilename}'`)
    .replaceAll(
      `'{{previewAnnotations}}'`,
      previewAnnotations
        .filter(Boolean)
        .map((entry) => `'${entry}'`)
        .join(','),
    )
    .replaceAll(
      `'{{previewAnnotations_requires}}'`,
      previewAnnotations
        .filter(Boolean)
        .map((entry) => `require('${entry}')`)
        .join(','),
    )
    // We need to double escape `\` for webpack. We may have some in windows paths
    .replace(/\\/g, '\\\\')
  entries.push(configEntryPath)

  return {
    virtualModules,
    entries,
  }
}
