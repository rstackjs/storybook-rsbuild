import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import slash from 'slash'
import {
  loadPreviewOrConfigFile,
  normalizeStories,
  readTemplate,
} from 'storybook/internal/common'
import type { Options, PreviewAnnotation } from 'storybook/internal/types'
import { toImportFn } from '../../compiled/@storybook/core-webpack'

export const getVirtualModules = async (
  options: Options,
  isLazyCompilationActive: boolean,
) => {
  const virtualModules: Record<string, string> = {}
  const workingDir = process.cwd()
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

  // TODO: Add the upstream builder-webpack5 semver gate for webpack issue #15541
  // once the Rspack version containing the equivalent fix is identified.
  virtualModules[storiesPath] = toImportFn(stories, {
    needPipelinedImport: isLazyCompilationActive,
  })
  // Resolve csf from the builder's own storybook copy, not the user's project root.
  // https://github.com/storybookjs/storybook/blob/b484eaf1449a7dfcddb0599deba1f873efe9fb59/code/builders/builder-webpack5/src/preview/virtual-module-mapping.ts#L65-L69
  const corePath = dirname(
    fileURLToPath(import.meta.resolve('storybook/package.json')),
  )
  const csfImportPath = join(corePath, 'dist', 'csf', 'index.js')
  // If the entrypoint is changed, remember to sync the change to Chromatic https://github.com/chromaui/chromatic-cli/pull/1206/files.
  // Also ref https://github.com/rstackjs/storybook-rsbuild/issues/332.
  const configEntryPath = resolve(join(workingDir, 'storybook-config-entry.js'))
  virtualModules[configEntryPath] = (
    await readTemplate(
      require.resolve('storybook-builder-rsbuild/templates/virtualModuleModernEntry.js'),
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
    .replaceAll(`'{{csfImportPath}}'`, `'${csfImportPath}'`)
    // We need to double escape `\` for webpack. We may have some in windows paths
    .replace(/\\/g, '\\\\')
  entries.push(configEntryPath)

  return {
    virtualModules,
    entries,
  }
}
