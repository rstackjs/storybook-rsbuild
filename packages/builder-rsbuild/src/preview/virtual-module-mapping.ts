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

/**
 * Re-assert Storybook's intent to keep `node_modules` out of the stories
 * `require.context`.
 *
 * Storybook core generates a `webpackInclude` with a `(?!.*node_modules)`
 * guard, but the guard is unanchored (core strips the leading `^`) and so only
 * works because webpack's `require.context` already drops `node_modules`
 * candidates (its default `RequireContextPlugin` rewrites any path under
 * `resolve.modules` to a bare specifier and hides the relative form). Rspack's
 * `ContextModule` has no such rewrite, so it enumerates `node_modules` and the
 * guard no-ops — a dependency that ships `.stories.*` files (e.g. under its own
 * `src/`) then gets swept into the preview build and can break it.
 *
 * TODO: remove this workaround once the upstream Rspack fix ships in a released
 * `@rspack/core` — https://github.com/web-infra-dev/rspack/pull/14576.
 *
 * Adding an explicit `webpackExclude: /[\\/]node_modules[\\/]/` (honored by
 * Rspack for webpack compatibility) makes Rspack match webpack's behavior. The
 * exclude is added to every generated `webpackInclude` except one that already
 * targets a real `node_modules` path segment (an intentional dependency glob),
 * which is left untouched.
 *
 * We gate that "leave it alone" decision on a real `[\\/]node_modules[\\/]`
 * segment in the include rather than on core's `(?!.*node_modules)` guard: core
 * suppresses that guard for ANY glob whose *string* merely contains the
 * `node_modules` substring (e.g. a project globbing `@(src|node_modules-cache)`),
 * even though such a glob is not targeting dependencies — its unanchored
 * `webpackInclude` would still sweep real `node_modules/<pkg>/**` stories, so it
 * must keep the exclude.
 *
 * The exclude is anchored to path separators (`[\\/]node_modules[\\/]`) rather
 * than the bare substring `node_modules`: Rspack tests `webpackExclude` against
 * each candidate's absolute path, so a bare `/node_modules/` would also prune
 * first-party stories when the project is checked out under a directory whose
 * name merely contains the substring (e.g. `/builds/node_modules-cache/app/`),
 * yielding an empty stories module.
 *
 * Scanned line by line; the only regex used is the bounded, anchorless
 * `[\\/]node_modules[\\/]` segment test, which has no adjacent unbounded
 * quantifiers and so runs in linear time. A regex spanning the whole
 * user-controlled comment (with `.*` spans) is deliberately avoided to rule out
 * polynomial backtracking (ReDoS).
 */
export const excludeNodeModulesFromStoryContext = (importFnSource: string) =>
  importFnSource
    .split('\n')
    .flatMap((line) => {
      // Touch every generated `webpackInclude` except one that already targets a
      // real `node_modules` path segment (an intentional dependency glob) — that
      // context is meant to enumerate node_modules, so leave it alone.
      if (
        line.includes('webpackInclude:') &&
        !/[\\/]node_modules[\\/]/.test(line)
      ) {
        const indent = line.slice(0, line.length - line.trimStart().length)
        return [
          line,
          `${indent}/* webpackExclude: /[\\\\/]node_modules[\\\\/]/ */`,
        ]
      }
      return [line]
    })
    .join('\n')

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
