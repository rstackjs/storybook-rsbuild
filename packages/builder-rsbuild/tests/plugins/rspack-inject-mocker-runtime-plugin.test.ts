import type { Rspack } from '@rsbuild/core'
import { describe, expect, it } from 'rstack/test'
import { RspackInjectMockerRuntimePlugin } from '../../src/plugins/rspack-inject-mocker-runtime-plugin'

const RUNTIME_ASSET = 'mocker-runtime-injected.js'

type HooksApi = 'getCompilationHooks' | 'neither'

type TagData = { assets: { js: string[] } }

type TagHook = (data: TagData, cb: (error: unknown) => void) => void

type HtmlHooks = {
  beforeAssetTagGeneration: {
    tapAsync: (name: string, fn: TagHook) => void
  }
}

/**
 * Applies the plugin against a stub compiler whose HTML plugin exposes `api`, and returns handles
 * on what the plugin did with it: whether it tapped the hook at all, which accessor it went
 * through, what it emitted, and a way to run each compilation's hooks.
 *
 * `getHtmlPlugin` locates the HTML plugin by constructor name, so the stubs have to be named after
 * the real ones.
 */
function applyPlugin(api: HooksApi) {
  const warnings: string[] = []
  const emitted: string[] = []
  const errors: unknown[] = []
  let tapped = false
  let startThisCompilation: ((compilation: unknown) => void) | undefined
  let startCompilation: ((compilation: unknown) => void) | undefined

  const htmlHooksByCompilation = new WeakMap<object, HtmlHooks>()

  /**
   * Builds a stand-in HTML plugin instance. The name matters because `getHtmlPlugin` finds the
   * plugin by constructor name, and the hooks accessor has to sit on the constructor because that
   * is where the plugin reads it from. Each compilation gets its own hooks object, as in rspack.
   */
  const createHtmlPlugin = (accessors: string[]): object => {
    const Plugin = class {}
    Object.defineProperty(Plugin, 'name', { value: 'HtmlRspackPlugin' })
    for (const accessor of accessors) {
      Object.defineProperty(Plugin, accessor, {
        value: (compilation: object): HtmlHooks => {
          const hooks = htmlHooksByCompilation.get(compilation)
          if (!hooks) {
            throw new Error('no HTML hooks registered for this compilation')
          }
          return hooks
        },
      })
    }
    return new Plugin()
  }

  const htmlPlugin =
    api === 'getCompilationHooks'
      ? createHtmlPlugin(['getCompilationHooks'])
      : createHtmlPlugin([])

  const compiler = {
    options: { plugins: [htmlPlugin] },
    hooks: {
      thisCompilation: {
        tap: (_name: string, fn: (compilation: unknown) => void) => {
          startThisCompilation = fn
        },
      },
      compilation: {
        tap: (_name: string, fn: (compilation: unknown) => void) => {
          startCompilation = fn
        },
      },
    },
    webpack: {
      Compilation: {
        PROCESS_ASSETS_STAGE_ADDITIONAL: -1234,
      },
      sources: {
        RawSource: class {
          constructor(public value: string) {}
        },
      },
    },
    getInfrastructureLogger: () => ({
      info: () => {},
      debug: () => {},
      warn: (message: string) => warnings.push(message),
    }),
  } as unknown as Rspack.Compiler

  new RspackInjectMockerRuntimePlugin().apply(compiler)

  /**
   * Creates one compilation with its own hooks and runs the plugin's per-compilation taps on it,
   * mirroring rspack (`thisCompilation` fires before `compilation`). `runProcessAssets` runs the
   * processAssets hook once per compilation; `renderPage` runs the tag hook once per HTML page.
   */
  const startNewCompilation = () => {
    const assets = new Map<string, unknown>()
    let processAssetsHook: (() => void) | undefined
    let tagHook: TagHook | undefined
    let stage: number | undefined
    const compilation = {
      getAsset: (name: string) => assets.get(name),
      emitAsset: (name: string, source: unknown) => {
        assets.set(name, source)
        emitted.push(name)
      },
      hooks: {
        processAssets: {
          tap: (options: { name: string; stage: number }, fn: () => void) => {
            stage = options.stage
            processAssetsHook = fn
          },
        },
      },
    }

    htmlHooksByCompilation.set(compilation, {
      beforeAssetTagGeneration: {
        tapAsync: (_name, fn) => {
          tagHook = fn
          tapped = true
        },
      },
    })

    startThisCompilation?.(compilation)
    startCompilation?.(compilation)

    return {
      runProcessAssets: () => processAssetsHook?.(),
      renderPage: (): string[] => {
        const data: TagData = { assets: { js: [] } }
        tagHook?.(data, (error) => {
          if (error) {
            errors.push(error)
          }
        })
        return data.assets.js
      },
      processAssetsStage: () => stage,
    }
  }

  const first = startNewCompilation()

  return {
    ...first,
    startNewCompilation,
    emitted,
    warnings,
    errors,
    tapped: () => tapped,
  }
}

describe('RspackInjectMockerRuntimePlugin', () => {
  describe('locating the html plugin hooks', () => {
    it('taps the hook when the plugin exposes getCompilationHooks', () => {
      const { runProcessAssets, renderPage, warnings, errors } = applyPlugin(
        'getCompilationHooks',
      )

      runProcessAssets()
      expect(renderPage()).toContain(RUNTIME_ASSET)
      expect(warnings).toEqual([])
      expect(errors).toEqual([])
    })

    it('warns and taps nothing when the plugin offers neither', () => {
      const { tapped, warnings } = applyPlugin('neither')

      expect(tapped()).toBe(false)
      expect(warnings).toEqual([
        'HTML plugin is not available. Cannot inject mocker runtime.',
      ])
    })
  })

  // The asset is emitted once so that dev rebuilds do not loop on an identical asset, but each
  // page owns its own asset list and needs the runtime ahead of its scripts.
  it('references the runtime from every page while emitting it once', () => {
    const { runProcessAssets, renderPage, emitted, errors } = applyPlugin(
      'getCompilationHooks',
    )

    runProcessAssets()
    expect(renderPage()).toContain(RUNTIME_ASSET)
    expect(renderPage()).toContain(RUNTIME_ASSET)
    expect(emitted).toEqual([RUNTIME_ASSET])
    expect(errors).toEqual([])
  })

  it('prepends the runtime ahead of the page scripts', () => {
    const { runProcessAssets, renderPage } = applyPlugin('getCompilationHooks')

    runProcessAssets()
    const data: string[] = renderPage()

    expect(data[0]).toBe(RUNTIME_ASSET)
  })

  // A cached-HTML rebuild runs processAssets but skips the tag hook, so the runtime must be
  // emitted for that compilation too. See #618.
  it('emits the runtime in a cached-HTML rebuild without tag generation', () => {
    const {
      startNewCompilation,
      runProcessAssets,
      renderPage,
      emitted,
      errors,
      processAssetsStage,
    } = applyPlugin('getCompilationHooks')

    runProcessAssets()
    expect(renderPage()).toContain(RUNTIME_ASSET)
    expect(emitted).toEqual([RUNTIME_ASSET])

    const rebuild = startNewCompilation()
    rebuild.runProcessAssets()
    expect(emitted).toEqual([RUNTIME_ASSET, RUNTIME_ASSET])
    expect(errors).toEqual([])
    // The stage comes from the stubbed constant, proving the tap reads it.
    expect(processAssetsStage()).toBe(-1234)
    expect(rebuild.processAssetsStage()).toBe(-1234)
  })
})
