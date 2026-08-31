import type { Rspack } from '@rsbuild/core'
import { describe, expect, it } from '@rstest/core'
import { RspackInjectMockerRuntimePlugin } from '../../src/plugins/rspack-inject-mocker-runtime-plugin'

const RUNTIME_ASSET = 'mocker-runtime-injected.js'

type HooksAccessor = 'getCompilationHooks' | 'getHooks'

type HooksApi = HooksAccessor | 'both' | 'neither'

type TagData = { assets: { js: string[] } }

/**
 * Applies the plugin against a stub compiler whose HTML plugin exposes `api`, and returns handles
 * on what the plugin did with it: whether it tapped the hook at all, which accessor it went
 * through, what it emitted, and a way to run the hook once per HTML page.
 *
 * `getHtmlPlugin` locates the HTML plugin by constructor name, so the stubs have to be named after
 * the real ones.
 */
function applyPlugin(api: HooksApi) {
  const warnings: string[] = []
  const emitted: string[] = []
  const errors: unknown[] = []
  const tappedVia: HooksAccessor[] = []
  let tagHook:
    ((data: TagData, cb: (error: unknown) => void) => void) | undefined
  let startCompilation: ((compilation: unknown) => void) | undefined

  // One hooks object per accessor, each recording the route it was reached by, so a plugin that
  // offers both names can report which one the code under test actually picked.
  const createHooks = (via: HooksAccessor) => ({
    beforeAssetTagGeneration: {
      tapAsync: (_name: string, fn: typeof tagHook) => {
        tappedVia.push(via)
        tagHook = fn
      },
    },
  })

  /**
   * Builds a stand-in HTML plugin instance. The name matters because `getHtmlPlugin` finds the
   * plugin by constructor name, and the hooks accessors have to sit on the constructor because
   * that is where the plugin reads them from.
   */
  const createHtmlPlugin = (
    name: string,
    accessors: HooksAccessor[],
  ): object => {
    const Plugin = class {}
    Object.defineProperty(Plugin, 'name', { value: name })
    for (const accessor of accessors) {
      const hooks = createHooks(accessor)
      Object.defineProperty(Plugin, accessor, { value: () => hooks })
    }
    return new Plugin()
  }

  let htmlPlugin: object
  switch (api) {
    case 'getCompilationHooks':
      htmlPlugin = createHtmlPlugin('HtmlRspackPlugin', ['getCompilationHooks'])
      break
    case 'getHooks':
      htmlPlugin = createHtmlPlugin('HtmlWebpackPlugin', ['getHooks'])
      break
    case 'both':
      htmlPlugin = createHtmlPlugin('HtmlRspackPlugin', [
        'getCompilationHooks',
        'getHooks',
      ])
      break
    default:
      htmlPlugin = createHtmlPlugin('HtmlRspackPlugin', [])
  }

  const assets = new Map<string, unknown>()
  const compilation = {
    getAsset: (name: string) => assets.get(name),
    emitAsset: (name: string, source: unknown) => {
      assets.set(name, source)
      emitted.push(name)
    },
  }

  const compiler = {
    options: { plugins: [htmlPlugin] },
    hooks: {
      compilation: {
        tap: (_name: string, fn: (compilation: unknown) => void) => {
          startCompilation = fn
        },
      },
    },
    webpack: {
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
  startCompilation?.(compilation)

  /**
   * Runs the tag hook for one HTML page, each of which arrives with its own asset list, and
   * returns the scripts that page ended up referencing.
   */
  const renderPage = (): string[] => {
    const data: TagData = { assets: { js: [] } }
    tagHook?.(data, (error) => {
      if (error) {
        errors.push(error)
      }
    })
    return data.assets.js
  }

  return {
    renderPage,
    emitted,
    warnings,
    errors,
    tapped: () => tagHook !== undefined,
    usedApi: () => tappedVia[0],
  }
}

describe('RspackInjectMockerRuntimePlugin', () => {
  describe('locating the html plugin hooks', () => {
    // Rspack's native HtmlRspackPlugin only offers getCompilationHooks, so requiring getHooks
    // meant the runtime was never injected there.
    it('taps the hook when the plugin exposes getCompilationHooks', () => {
      const { renderPage, warnings, errors } = applyPlugin(
        'getCompilationHooks',
      )

      expect(renderPage()).toContain(RUNTIME_ASSET)
      expect(warnings).toEqual([])
      expect(errors).toEqual([])
    })

    it('taps the hook when the plugin only exposes the deprecated getHooks', () => {
      const { renderPage, warnings, errors } = applyPlugin('getHooks')

      expect(renderPage()).toContain(RUNTIME_ASSET)
      expect(warnings).toEqual([])
      expect(errors).toEqual([])
    })

    // The path almost every user is on: html-rspack-plugin, behind the default
    // `html.implementation: 'js'`, exports both names, and so does rspack v1. Pinning the
    // preference means the deprecated alias can be dropped without silently changing behaviour.
    it('prefers getCompilationHooks when the plugin exposes both', () => {
      const { renderPage, usedApi, warnings, errors } = applyPlugin('both')

      expect(usedApi()).toBe('getCompilationHooks')
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
    const { renderPage, emitted, errors } = applyPlugin('getCompilationHooks')

    expect(renderPage()).toContain(RUNTIME_ASSET)
    expect(renderPage()).toContain(RUNTIME_ASSET)
    expect(emitted).toEqual([RUNTIME_ASSET])
    expect(errors).toEqual([])
  })

  it('prepends the runtime ahead of the page scripts', () => {
    const { renderPage } = applyPlugin('getCompilationHooks')

    const data: string[] = renderPage()

    expect(data[0]).toBe(RUNTIME_ASSET)
  })
})
