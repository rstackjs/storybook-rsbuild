import type { HtmlRspackPlugin, Rspack } from '@rsbuild/core'
import { getMockerRuntime } from 'storybook/internal/mocking-utils'

const PLUGIN_NAME = 'RspackInjectMockerRuntimePlugin'
const RUNTIME_ASSET_NAME = 'mocker-runtime-injected.js'

export class RspackInjectMockerRuntimePlugin {
  private cachedRuntime: string | null = null

  private getHtmlPlugin(
    compiler: Rspack.Compiler,
  ): typeof HtmlRspackPlugin | null {
    try {
      // Rspack v1 compatible: check for both `HtmlRspackPlugin` (v2) and `HtmlWebpackPlugin` (v1) names.
      const pluginConstructor = compiler.options.plugins?.find((plugin) => {
        const name = plugin?.constructor?.name
        return name === 'HtmlRspackPlugin' || name === 'HtmlWebpackPlugin'
      })?.constructor

      return pluginConstructor as typeof HtmlRspackPlugin
    } catch (error) {
      compiler
        .getInfrastructureLogger(PLUGIN_NAME)
        .warn(
          `Unable to locate HTML plugin for mock runtime injection: ${String(error)}`,
        )
      return null
    }
  }

  apply(compiler: Rspack.Compiler) {
    const HtmlPlugin = this.getHtmlPlugin(compiler)
    // DIVERGES FROM UPSTREAM — upstream only reads `getHooks`, which is enough for
    // html-webpack-plugin but not here: rspack's native `HtmlRspackPlugin` dropped that
    // deprecated alias in v2 and offers `getCompilationHooks` alone, so `html.implementation:
    // 'native'` would leave the hook untapped. Both are plain statics that ignore `this`.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const getHtmlHooks = HtmlPlugin?.getCompilationHooks ?? HtmlPlugin?.getHooks
    if (typeof getHtmlHooks !== 'function') {
      compiler
        .getInfrastructureLogger(PLUGIN_NAME)
        .warn('HTML plugin is not available. Cannot inject mocker runtime.')
      return
    }

    // `thisCompilation` only fires for main compilations, so child compilers (which copy
    // `compilation` taps) do not emit their own copy of the runtime.
    compiler.hooks.thisCompilation.tap(PLUGIN_NAME, (compilation) => {
      // Emit from processAssets so every compilation has the runtime: on a rebuild,
      // html-rspack-plugin's `cache` fast path re-emits the previous HTML without calling
      // generateHTML, so beforeAssetTagGeneration never runs. Rsbuild 2.3 then prunes the stale
      // asset from the dev memory filesystem (web-infra-dev/rsbuild#8739) and the cached import 404s.
      // See https://github.com/rstackjs/storybook-rsbuild/issues/618.
      compilation.hooks.processAssets.tap(
        {
          name: PLUGIN_NAME,
          stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL,
        },
        () => {
          // Emit once per compilation, because re-emitting an identical asset triggers
          // spurious rebuild loops in dev.
          // See https://github.com/storybookjs/storybook/pull/33169.
          if (compilation.getAsset(RUNTIME_ASSET_NAME)) {
            return
          }

          const runtimeScriptContent =
            this.cachedRuntime ?? (this.cachedRuntime = getMockerRuntime())
          compilation.emitAsset(
            RUNTIME_ASSET_NAME,
            new compiler.webpack.sources.RawSource(runtimeScriptContent),
          )
        },
      )
    })

    compiler.hooks.compilation.tap(PLUGIN_NAME, (compilation) => {
      getHtmlHooks(compilation).beforeAssetTagGeneration.tapAsync(
        PLUGIN_NAME,
        (data, cb) => {
          // Reference it from every page. This hook runs once per HTML page, each
          // with its own asset list, and each page needs the runtime before its scripts.
          //
          // DIVERGES FROM UPSTREAM — do not "sync" this back by copying webpack5's
          // webpack-inject-mocker-runtime-plugin.ts. Upstream keeps this `unshift` inside its
          // emit guard, so only its first HTML page references the runtime and `sb.mock()`
          // silently does nothing on every later page. The bug is invisible upstream because
          // its preview emits a single `iframe.html`. See #531, and the upstream commit that
          // introduced it: https://github.com/storybookjs/storybook/commit/5c0c2779
          data.assets.js.unshift(RUNTIME_ASSET_NAME)

          cb(null, data)
        },
      )
    })
  }
}
