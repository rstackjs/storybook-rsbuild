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

  private getRuntimeSource(compiler: Rspack.Compiler) {
    const Sources = compiler.webpack?.sources
    if (!Sources?.RawSource) {
      throw new Error('rspack sources is not available on compiler.webpack')
    }

    const runtimeScriptContent =
      this.cachedRuntime ?? (this.cachedRuntime = getMockerRuntime())

    return new Sources.RawSource(runtimeScriptContent)
  }

  private emitRuntimeAsset(
    compiler: Rspack.Compiler,
    compilation: Rspack.Compilation,
  ) {
    // Emit once per compilation, because re-emitting an identical asset triggers
    // spurious rebuild loops in dev.
    // See https://github.com/storybookjs/storybook/pull/33169.
    if (compilation.getAsset(RUNTIME_ASSET_NAME)) {
      return
    }

    compilation.emitAsset(RUNTIME_ASSET_NAME, this.getRuntimeSource(compiler))
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

    compiler.hooks.compilation.tap(PLUGIN_NAME, (compilation) => {
      // Emit during processAssets (early) so Rsbuild/Rspack 2.3 preview middleware can
      // serve the file. Emitting only inside beforeAssetTagGeneration is too late there:
      // iframe.html still references ./mocker-runtime-injected.js but GET returns 404.
      // See https://github.com/rstackjs/storybook-rsbuild/issues/618.
      const processAssetsStage =
        compiler.webpack?.Compilation?.PROCESS_ASSETS_STAGE_ADDITIONAL ??
        // Fallback for older stubs / compilers without Compilation constants.
        -2000

      compilation.hooks.processAssets.tap(
        {
          name: PLUGIN_NAME,
          stage: processAssetsStage,
        },
        () => {
          this.emitRuntimeAsset(compiler, compilation)
        },
      )

      getHtmlHooks(compilation).beforeAssetTagGeneration.tapAsync(
        PLUGIN_NAME,
        (data, cb) => {
          try {
            // Safety net if processAssets did not run (unusual compiler setups).
            this.emitRuntimeAsset(compiler, compilation)

            // Reference it from every page. This hook runs once per HTML page, each
            // with its own asset list, and each page needs the runtime before its scripts.
            //
            // DIVERGES FROM UPSTREAM — do not "sync" this back by copying webpack5's
            // webpack-inject-mocker-runtime-plugin.ts. Upstream still keeps this `unshift`
            // inside the emit guard above, so only its first HTML page references the runtime
            // and `sb.mock()` silently does nothing on every later page. The bug is invisible
            // upstream because its preview emits a single `iframe.html`. See #531, and the
            // upstream commit that introduced it:
            // https://github.com/storybookjs/storybook/commit/5c0c2779
            data.assets.js.unshift(RUNTIME_ASSET_NAME)

            cb(null, data)
          } catch (error) {
            cb(error as Error)
          }
        },
      )
    })
  }
}
