import { join, resolve } from 'node:path'
import slash from 'slash'
import {
  getBuilderOptions,
  loadPreviewOrConfigFile,
  normalizeStories,
  readTemplate,
} from 'storybook/internal/common'
import type {
  NormalizedStoriesSpecifier,
  Options,
  PreviewAnnotation,
} from 'storybook/internal/types'
import { toImportFn } from '../../compiled/@storybook/core-webpack'
import type { BuilderOptions } from '../types'

/**
 * Matches `node_modules` only as a complete path segment OR a complete
 * brace/extglob alternation branch — bounded on both sides by a path separator,
 * an alternation delimiter (`( | , {` / `) | , }`), or the string end. A fixed
 * literal between bounded single-char classes, so it stays linear-time (no ReDoS).
 */
const NODE_MODULES_GLOB_TOKEN = /(?:^|[\\/(|,{])node_modules(?:$|[\\/)|,}])/

/**
 * Rebuild core-webpack's `webpackIncludeGlob` (see `webpackIncludeRegexp`) from
 * a normalized specifier, so the "intentional" check keys on the SAME structured
 * glob core uses — not the emitted regex, where an alternation branch hides
 * `node_modules` behind `|`/`)` instead of path separators.
 */
const toWebpackIncludeGlob = ({
  directory,
  files,
}: NormalizedStoriesSpecifier) =>
  ['.', '..'].includes(directory)
    ? files
    : `${directory.replace(/^(\.+\/)+/, '/')}/${files}`

/**
 * A specifier intentionally targets dependency stories when its glob can expand
 * to a real `node_modules` segment — a literal path segment (`./node_modules/pkg`)
 * or an exact alternation branch (`./@(src|node_modules)`). Substring look-alikes
 * (`node_modules-cache`, `my-node_modules`, `modules`) do NOT count.
 */
const targetsNodeModules = (specifier: NormalizedStoriesSpecifier) =>
  NODE_MODULES_GLOB_TOKEN.test(toWebpackIncludeGlob(specifier))

/**
 * Re-assert Storybook core's intent to keep `node_modules` out of the stories
 * context. Core's `(?!.*node_modules)` guard relies on webpack's context
 * dropping `node_modules`; Rspack's `ContextModule` enumerates it, so a
 * dependency shipping `.stories.*` gets swept in. We append a separator-anchored
 * `webpackExclude` to every generated `webpackInclude`, except specifiers that
 * intentionally glob into `node_modules` (real segment or alternation branch) —
 * matching the webpack builder, which surfaces those.
 *
 * TODO: remove once the upstream Rspack fix ships in a released `@rspack/core`
 * — https://github.com/web-infra-dev/rspack/pull/14576.
 */
export const excludeNodeModulesFromStoryContext = (
  importFnSource: string,
  stories: NormalizedStoriesSpecifier[],
) => {
  // Core emits exactly one `webpackInclude` per specifier, in `stories` order.
  let specifierIndex = 0
  return importFnSource
    .split('\n')
    .flatMap((line) => {
      if (!line.includes('webpackInclude:')) {
        return [line]
      }
      const specifier = stories[specifierIndex++]
      if (specifier && targetsNodeModules(specifier)) {
        return [line]
      }
      const indent = line.slice(0, line.length - line.trimStart().length)
      return [
        line,
        `${indent}/* webpackExclude: /[\\\\/]node_modules[\\\\/]/ */`,
      ]
    })
    .join('\n')
}

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

  const needPipelinedImport =
    builderOptions.lazyCompilation !== false && !isProd
  virtualModules[storiesPath] = excludeNodeModulesFromStoryContext(
    toImportFn(stories, {
      needPipelinedImport,
    }),
    stories,
  )
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
