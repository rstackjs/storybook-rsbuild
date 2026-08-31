import type { Rspack } from '@rsbuild/core'
import { describe, expect, it } from '@rstest/core'
import { resolve } from 'node:path'
import { resolve as resolvePosix } from 'pathe'
import { RspackMockPlugin } from '../../src/plugins/rspack-mock-plugin'

// `extractMockCalls` calls `telemetry('mocking', ...)` whenever it finds mocks, but nothing
// leaves this process: `telemetry()` gates on `globalThis.SB_TELEMETRY_STATE`, which only the
// CLI and the common preset ever set. Undefined here means every event is parked on
// `globalThis.SB_TELEMETRY_QUEUE` and never flushed. Setting `STORYBOOK_DISABLE_TELEMETRY`
// would not help either — `telemetry()` never reads it.

const fixtureDir = resolve(__dirname, '../fixtures/mock-plugin')

interface Resource {
  request: string
  context: string
}

type InfrastructureLogger = ReturnType<
  Rspack.Compiler['getInfrastructureLogger']
>

/**
 * Applies the plugin against a stub compiler and returns handles on the parts under test: the
 * callback given to NormalModuleReplacementPlugin, a trigger for the mock-map refresh that
 * normally runs on beforeRun, and the debug messages the plugin logged.
 *
 * `debugMessages` is what distinguishes an early return from a completed resolution: the plugin
 * only logs on a failed resolve, so an unresolvable request that produces no message proves the
 * callback bailed out before attempting resolution at all.
 */
function applyPlugin(
  previewConfig: 'preview-with-mock.ts' | 'preview-without-mock.ts',
) {
  const infoMessages: string[] = []
  const debugMessages: string[] = []
  const warnMessages: string[] = []
  let replaceResource: ((resource: Resource) => void) | undefined
  let refreshMocks: (() => void) | undefined

  // Drives the mtime the plugin sees, standing in for the compiler's cached file system.
  let previewMtime = 1_000

  const compilerStub = {
    context: fixtureDir,
    inputFileSystem: {
      statSync: () => ({ mtime: new Date(previewMtime) }),
    } as unknown as Rspack.Compiler['inputFileSystem'],
    hooks: {
      beforeRun: {
        tap: (_name: string, fn: () => void) => {
          refreshMocks = fn
        },
      },
      watchRun: { tap: () => {} },
      afterCompile: { tap: () => {} },
    } as unknown as Rspack.Compiler['hooks'],
    getInfrastructureLogger: () =>
      ({
        info: (message: string) => infoMessages.push(message),
        warn: (message: string) => warnMessages.push(message),
        debug: (message: string) => debugMessages.push(message),
      }) as unknown as InfrastructureLogger,
    // The plugin reads `NormalModuleReplacementPlugin` off the compiler, so the stub can hand
    // it a recorder and keep hold of the replacement callback. Nothing global is touched.
    webpack: {
      NormalModuleReplacementPlugin: class {
        constructor(_test: RegExp, callback: (resource: Resource) => void) {
          replaceResource = callback
        }
        apply() {}
      },
    } as unknown as Rspack.Compiler['webpack'],
  } satisfies Partial<Rspack.Compiler>

  // `Rspack.Compiler` declares a private field, so it is nominally typed and no object literal
  // can be asserted to it directly. The `satisfies` above is what type-checks the stub.
  const compiler = compilerStub as unknown as Rspack.Compiler

  new RspackMockPlugin({
    previewConfigPath: resolve(fixtureDir, previewConfig),
  }).apply(compiler)

  if (!replaceResource || !refreshMocks) {
    throw new Error('plugin did not register its replacement callback')
  }
  const runUpdateMocks = refreshMocks

  runUpdateMocks()

  // A warning here means mock resolution itself failed, which would make every assertion below
  // pass for the wrong reason.
  if (warnMessages.length > 0) {
    throw new Error(
      `plugin warned while resolving mocks: ${warnMessages.join('; ')}`,
    )
  }

  /**
   * Runs another compilation, optionally after the preview config has been rewritten. The plugin
   * logs once per rebuild of a non-empty map, so `rebuildCount` reports whether it re-extracted.
   */
  const recompile = (mtime = previewMtime) => {
    previewMtime = mtime
    runUpdateMocks()
  }

  return {
    replaceResource,
    recompile,
    debugMessages,
    rebuildCount: () => infoMessages.length,
  }
}

describe('RspackMockPlugin', () => {
  it('does not resolve anything when no mocks are declared', () => {
    const { replaceResource, debugMessages } = applyPlugin(
      'preview-without-mock.ts',
    )
    const resource = { request: './not-a-real-module', context: fixtureDir }

    replaceResource(resource)

    expect(resource.request).toBe('./not-a-real-module')
    expect(debugMessages).toEqual([])
  })

  // `pathe` is a real dependency, so getIsExternal reports it as external and it takes the
  // candidateSpecifiers path. This pins the outcome, not the shortcut: skipping the resolve is an
  // optimisation, so removing it would leave this request untouched either way.
  it('leaves bare specifiers that are not mocked alone', () => {
    const { replaceResource } = applyPlugin('preview-with-mock.ts')
    const resource = { request: 'pathe', context: fixtureDir }

    replaceResource(resource)

    expect(resource.request).toBe('pathe')
  })

  it('redirects a request that matches a declared mock', () => {
    const { replaceResource } = applyPlugin('preview-with-mock.ts')
    const resource = { request: './mocked-module', context: fixtureDir }

    replaceResource(resource)

    expect(resource.request).toBe(
      resolvePosix(fixtureDir, '__mocks__/mocked-module.js'),
    )
  })

  describe('mock map caching', () => {
    it('reuses the map while the preview config mtime is unchanged', () => {
      const { recompile, rebuildCount } = applyPlugin('preview-with-mock.ts')

      recompile()

      expect(rebuildCount()).toBe(1)
    })

    it('rebuilds the map when the preview config mtime changes', () => {
      const { recompile, rebuildCount } = applyPlugin('preview-with-mock.ts')

      recompile(2_000)

      expect(rebuildCount()).toBe(2)
    })

    // Equality rather than "newer", so restoring an older preview config is still picked up.
    it('rebuilds the map when the preview config mtime goes backwards', () => {
      const { recompile, rebuildCount } = applyPlugin('preview-with-mock.ts')

      recompile(500)

      expect(rebuildCount()).toBe(2)
    })
  })
})
