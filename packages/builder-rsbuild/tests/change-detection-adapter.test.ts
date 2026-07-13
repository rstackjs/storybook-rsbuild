// Tests the Rspack implementation of ChangeDetectionAdapter — resolve-config extraction
// and watchRun-based file-change event normalisation. Ported from builder-webpack5.
import { describe, expect, it, rs } from '@rstest/core'
import { createRspackChangeDetectionAdapter } from '../src/change-detection-adapter'

interface FakeTapable<T> {
  tap(pluginName: string, fn: (arg: T) => void): void
}

interface FakeCompilation {
  fileDependencies: Iterable<string>
}

interface FakeCompiler {
  context: string
  options: {
    resolve: {
      alias?: unknown
      conditionNames?: string[]
    }
  }
  hooks: {
    watchRun: FakeTapable<FakeCompiler>
    afterCompile: FakeTapable<FakeCompilation>
  }
  modifiedFiles?: ReadonlySet<string>
  removedFiles?: ReadonlySet<string>
}

function createFakeCompiler(overrides: Partial<FakeCompiler> = {}): {
  compiler: FakeCompiler
  triggerWatchRun: (modifiedFiles?: string[], removedFiles?: string[]) => void
  triggerAfterCompile: (fileDependencies?: string[]) => void
} {
  let watchRunCallback: ((c: FakeCompiler) => void) | undefined
  let afterCompileCallback: ((c: FakeCompilation) => void) | undefined

  const compiler: FakeCompiler = {
    context: '/repo',
    options: {
      resolve: {},
    },
    hooks: {
      watchRun: {
        tap(_pluginName, fn) {
          watchRunCallback = fn
        },
      },
      afterCompile: {
        tap(_pluginName, fn) {
          afterCompileCallback = fn
        },
      },
    },
    ...overrides,
  }

  function triggerWatchRun(
    modifiedFiles: string[] = [],
    removedFiles: string[] = [],
  ): void {
    const ctx: FakeCompiler = {
      ...compiler,
      modifiedFiles: new Set(modifiedFiles),
      removedFiles: new Set(removedFiles),
    }
    watchRunCallback?.(ctx)
  }

  function triggerAfterCompile(fileDependencies: string[] = []): void {
    afterCompileCallback?.({ fileDependencies: new Set(fileDependencies) })
  }

  return { compiler, triggerWatchRun, triggerAfterCompile }
}

describe('createRspackChangeDetectionAdapter', () => {
  describe('getResolveConfig()', () => {
    it('returns projectRoot from compiler.context', async () => {
      const { compiler } = createFakeCompiler({ context: '/my/project' })
      const adapter = createRspackChangeDetectionAdapter(compiler as any)
      const config = await adapter.getResolveConfig()
      expect(config.projectRoot).toBe('/my/project')
    })

    it('returns conditions from resolve.conditionNames', async () => {
      const { compiler } = createFakeCompiler({
        options: { resolve: { conditionNames: ['import', 'module'] } },
      })
      const adapter = createRspackChangeDetectionAdapter(compiler as any)
      const config = await adapter.getResolveConfig()
      expect(config.conditions).toEqual(['import', 'module'])
    })

    it('normalises object-form alias to Record<string, string>', async () => {
      const { compiler } = createFakeCompiler({
        options: {
          resolve: {
            alias: {
              '@': '/repo/src',
              utils: '/repo/utils',
              disabled: false,
              multi: ['/repo/multi-a', '/repo/multi-b'],
            },
          },
        },
      })
      const adapter = createRspackChangeDetectionAdapter(compiler as any)
      const config = await adapter.getResolveConfig()
      expect(config.alias).toEqual({
        '@': '/repo/src',
        utils: '/repo/utils',
        multi: '/repo/multi-a',
        // `disabled: false` is skipped
      })
    })

    it('picks the first string when an alias array leads with false', async () => {
      const { compiler } = createFakeCompiler({
        options: {
          resolve: {
            alias: {
              lead: [false, '/repo/lead-a'],
            },
          },
        },
      })
      const adapter = createRspackChangeDetectionAdapter(compiler as any)
      const config = await adapter.getResolveConfig()
      expect(config.alias).toEqual({ lead: '/repo/lead-a' })
    })

    it('returns undefined alias when resolve has no alias', async () => {
      const { compiler } = createFakeCompiler({ options: { resolve: {} } })
      const adapter = createRspackChangeDetectionAdapter(compiler as any)
      const config = await adapter.getResolveConfig()
      expect(config.alias).toBeUndefined()
    })

    it('returns undefined alias when resolve.alias is false', async () => {
      const { compiler } = createFakeCompiler({
        options: { resolve: { alias: false } },
      })
      const adapter = createRspackChangeDetectionAdapter(compiler as any)
      const config = await adapter.getResolveConfig()
      expect(config.alias).toBeUndefined()
    })
  })

  describe('onFileChange()', () => {
    it('defaults to "change" for modifications before the graph is seeded', () => {
      // Before the first compilation seeds the known-file set we cannot tell new from existing,
      // so every modification uses the safe `change` classification (the incremental patcher
      // re-walks dependents on change but not on add).
      const { compiler, triggerWatchRun } = createFakeCompiler()
      const adapter = createRspackChangeDetectionAdapter(compiler as any)
      const handler = rs.fn()
      adapter.onFileChange(handler)

      triggerWatchRun(['/repo/src/A.tsx'])

      expect(handler).toHaveBeenCalledWith({
        kind: 'change',
        path: '/repo/src/A.tsx',
      })
    })

    it('classifies a modified file absent from the seeded graph as "add"', () => {
      // Once the graph is seeded, a modified path that the build never depended on is genuinely new.
      const { compiler, triggerWatchRun, triggerAfterCompile } =
        createFakeCompiler()
      const adapter = createRspackChangeDetectionAdapter(compiler as any)
      const handler = rs.fn()
      adapter.onFileChange(handler)

      triggerAfterCompile(['/repo/src/A.tsx']) // graph knows A
      triggerWatchRun(['/repo/src/A.tsx']) // A is in the graph → 'change'
      triggerWatchRun(['/repo/src/B.tsx']) // B is not in the graph → 'add'

      expect(handler).toHaveBeenNthCalledWith(1, {
        kind: 'change',
        path: '/repo/src/A.tsx',
      })
      expect(handler).toHaveBeenNthCalledWith(2, {
        kind: 'add',
        path: '/repo/src/B.tsx',
      })
    })

    it('classifies the first edit of any pre-existing dependency as "change"', () => {
      // Regression: a cold-start watchRun may report no initial file set, so `seenFiles` is seeded
      // from the built graph instead. Editing B for the first time (after editing A) must be a
      // `change` because B is a pre-existing dependency, not a new file.
      const { compiler, triggerWatchRun, triggerAfterCompile } =
        createFakeCompiler()
      const adapter = createRspackChangeDetectionAdapter(compiler as any)
      const handler = rs.fn()
      adapter.onFileChange(handler)

      triggerWatchRun([]) // cold-start run — no modifiedFiles reported
      triggerAfterCompile(['/repo/src/A.tsx', '/repo/src/B.tsx']) // both pre-exist in the graph
      triggerWatchRun(['/repo/src/A.tsx']) // first edit of A → 'change'
      triggerWatchRun(['/repo/src/B.tsx']) // first edit of B → 'change' (not 'add')

      expect(handler).toHaveBeenNthCalledWith(1, {
        kind: 'change',
        path: '/repo/src/A.tsx',
      })
      expect(handler).toHaveBeenNthCalledWith(2, {
        kind: 'change',
        path: '/repo/src/B.tsx',
      })
    })

    it('keeps the known-file set current across later compilations', () => {
      // A file that joins the graph after the first compilation (e.g. an existing helper a story
      // starts importing) must be tracked, so its later edit is a `change`, not an `add`.
      const { compiler, triggerWatchRun, triggerAfterCompile } =
        createFakeCompiler()
      const adapter = createRspackChangeDetectionAdapter(compiler as any)
      const handler = rs.fn()
      adapter.onFileChange(handler)

      triggerAfterCompile(['/repo/src/A.tsx']) // first compile — only A in the graph
      triggerAfterCompile(['/repo/src/A.tsx', '/repo/src/C.tsx']) // C joins the graph later
      triggerWatchRun(['/repo/src/C.tsx']) // C is now known → 'change'

      expect(handler).toHaveBeenCalledWith({
        kind: 'change',
        path: '/repo/src/C.tsx',
      })
    })

    it('emits kind:"change" for paths seen in a previous watchRun', () => {
      const { compiler, triggerWatchRun } = createFakeCompiler()
      const adapter = createRspackChangeDetectionAdapter(compiler as any)
      const handler = rs.fn()
      adapter.onFileChange(handler)

      triggerWatchRun(['/repo/src/A.tsx']) // first run → change (firstRun flag)
      triggerWatchRun(['/repo/src/A.tsx']) // second run → change (already seen)

      expect(handler).toHaveBeenNthCalledWith(1, {
        kind: 'change',
        path: '/repo/src/A.tsx',
      })
      expect(handler).toHaveBeenNthCalledWith(2, {
        kind: 'change',
        path: '/repo/src/A.tsx',
      })
    })

    it('emits kind:"unlink" for removedFiles and forgets the path', () => {
      const { compiler, triggerWatchRun } = createFakeCompiler()
      const adapter = createRspackChangeDetectionAdapter(compiler as any)
      const handler = rs.fn()
      adapter.onFileChange(handler)

      triggerWatchRun(['/repo/src/A.tsx']) // first run → change
      triggerWatchRun([], ['/repo/src/A.tsx']) // unlink

      expect(handler).toHaveBeenNthCalledWith(2, {
        kind: 'unlink',
        path: '/repo/src/A.tsx',
      })
    })

    it('emits kind:"add" again after a path was unlinked and re-added', () => {
      const { compiler, triggerWatchRun, triggerAfterCompile } =
        createFakeCompiler()
      const adapter = createRspackChangeDetectionAdapter(compiler as any)
      const handler = rs.fn()
      adapter.onFileChange(handler)

      triggerAfterCompile(['/repo/src/A.tsx']) // graph knows A
      triggerWatchRun(['/repo/src/A.tsx']) // change
      triggerWatchRun([], ['/repo/src/A.tsx']) // unlink — seenFiles forgets path
      triggerWatchRun(['/repo/src/A.tsx']) // path is unseen again after unlink → add

      expect(handler).toHaveBeenNthCalledWith(3, {
        kind: 'add',
        path: '/repo/src/A.tsx',
      })
    })

    it('normalises paths via pathe.normalize before forwarding', () => {
      const { compiler, triggerWatchRun } = createFakeCompiler()
      const adapter = createRspackChangeDetectionAdapter(compiler as any)
      const handler = rs.fn()
      adapter.onFileChange(handler)

      triggerWatchRun(['/repo/src/./A.tsx'])

      expect(handler).toHaveBeenCalledWith({
        kind: 'change',
        path: '/repo/src/A.tsx',
      })
    })

    it('does not emit events after the unsubscribe function is called', () => {
      const { compiler, triggerWatchRun } = createFakeCompiler()
      const adapter = createRspackChangeDetectionAdapter(compiler as any)
      const handler = rs.fn()
      const unsubscribe = adapter.onFileChange(handler)

      triggerWatchRun(['/repo/src/A.tsx'])
      expect(handler).toHaveBeenCalledTimes(1)

      unsubscribe()
      triggerWatchRun(['/repo/src/B.tsx'])
      expect(handler).toHaveBeenCalledTimes(1)
    })

    it('emits no events when modifiedFiles and removedFiles are empty', () => {
      const { compiler, triggerWatchRun } = createFakeCompiler()
      const adapter = createRspackChangeDetectionAdapter(compiler as any)
      const handler = rs.fn()
      adapter.onFileChange(handler)

      triggerWatchRun([], [])

      expect(handler).not.toHaveBeenCalled()
    })
  })
})
