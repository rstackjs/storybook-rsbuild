// Ported from Storybook's builder-webpack5 change-detection adapter. Keep in sync with upstream:
// https://github.com/storybookjs/storybook/blob/v10.5.0/code/builders/builder-webpack5/src/change-detection-adapter/index.ts
// Introduced in storybookjs/storybook commit 3f12c4e and hardened in eed530c (first-run fix).
import type { Rspack } from '@rsbuild/core'
import { normalize } from 'pathe'
import type {
  ChangeDetectionAdapter,
  FileChangeEvent,
  ModuleResolveConfig,
} from 'storybook/internal/core-server'
import { logger } from 'storybook/internal/node-logger'

/**
 * Rspack implementation of {@link ChangeDetectionAdapter}.
 *
 * - `getResolveConfig()` reads `compiler.options.resolve` and `compiler.context` once at startup.
 * - `onFileChange()` taps `compiler.hooks.watchRun` and forwards `modifiedFiles` as `add`/`change`
 *   and `removedFiles` as `unlink` events.
 *
 * Add-vs-change is decided from the built module graph: after each compilation, `seenFiles` is
 * kept current from `compilation.fileDependencies`, so a modified file already known to the build
 * is a `change` and only a file absent from the graph is an `add`. Until the first compilation
 * completes every modification defaults to `change`, which is the safe classification — Storybook's
 * incremental patcher re-walks dependents on `change` but not on `add`.
 *
 * Ported from builder-webpack5's `createWebpackChangeDetectionAdapter`; Rspack mirrors webpack5's
 * `modifiedFiles`/`removedFiles`/`watchRun` semantics. The graph-driven classification is a
 * correctness improvement over upstream, whose `firstRun` heuristic misclassifies the first edit of
 * a pre-existing file as `add` when the cold-start `watchRun` reports no initial file set.
 */
export function createRspackChangeDetectionAdapter(
  compiler: Rspack.Compiler,
): ChangeDetectionAdapter {
  return {
    async getResolveConfig(): Promise<ModuleResolveConfig> {
      const resolveOpts = compiler.options.resolve
      return {
        projectRoot: compiler.context,
        alias: normaliseRspackAlias(resolveOpts.alias),
        conditions: resolveOpts.conditionNames,
      }
    },

    onFileChange(handler: (event: FileChangeEvent) => void): () => void {
      let active = true
      let seeded = false
      const seenFiles = new Set<string>()

      // Keep the known-file set current from the build graph. Unioning `fileDependencies` after
      // every compilation (not just the first) tracks files that join the graph later — e.g. an
      // existing helper that a story starts importing mid-session — so their subsequent edits are
      // classified as `change`, not `add`. A genuinely new file is still an `add`: its creating
      // `watchRun` fires before the compilation that would add it here, so `seenFiles` does not yet
      // contain it at classification time.
      compiler.hooks.afterCompile.tap(
        'StorybookChangeDetection',
        (compilation) => {
          for (const filePath of compilation.fileDependencies) {
            seenFiles.add(normalize(filePath))
          }
          seeded = true
        },
      )

      compiler.hooks.watchRun.tap(
        'StorybookChangeDetection',
        (watchingCompiler) => {
          if (!active) return

          for (const filePath of watchingCompiler.modifiedFiles ?? []) {
            const path = normalize(filePath)
            // Before the graph is seeded we cannot tell new from existing, so default to `change`.
            const kind: FileChangeEvent['kind'] =
              seeded && !seenFiles.has(path) ? 'add' : 'change'
            seenFiles.add(path)
            handler({ kind, path })
          }

          for (const filePath of watchingCompiler.removedFiles ?? []) {
            const path = normalize(filePath)
            seenFiles.delete(path)
            handler({ kind: 'unlink', path })
          }
        },
      )

      return () => {
        active = false
      }
    },
  }
}

type RspackResolveAlias = NonNullable<Rspack.ResolveOptions['alias']>

function normaliseRspackAlias(
  alias: RspackResolveAlias | undefined,
): ModuleResolveConfig['alias'] | undefined {
  // Rspack aliases are always object-form (`Record<string, string | false | (string | false)[]>`)
  // or `false` to disable resolution entirely.
  if (!alias) return undefined

  const record: Record<string, string> = {}
  for (const [key, value] of Object.entries(alias)) {
    if (typeof value === 'string') {
      record[key] = value
    } else if (Array.isArray(value)) {
      const stringValues = value.filter(
        (item): item is string => typeof item === 'string',
      )
      const replacement = stringValues[0]
      if (replacement == null) continue
      if (stringValues.length > 1) {
        logger.debug(
          `Change detection: Rspack alias "${key}" has ${stringValues.length} values; using only the first: "${replacement}"`,
        )
      }
      record[key] = replacement
    }
    // false = disabled alias, skip
  }
  return Object.keys(record).length > 0 ? record : undefined
}
