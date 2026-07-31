import type { HtmlRspackPlugin, Rspack } from '@rsbuild/core'
import { getMockerRuntime } from 'storybook/internal/mocking-utils'

const PLUGIN_NAME = 'RspackInjectMockerRuntimePlugin'

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
          `Unable to locate HTML plugin for mock runtime injection: ${error}`,
        )
      return null
    }
  }

  apply(compiler: Rspack.Compiler) {
    const HtmlPlugin = this.getHtmlPlugin(compiler)
    if (!HtmlPlugin || typeof HtmlPlugin.getHooks !== 'function') {
      compiler
        .getInfrastructureLogger(PLUGIN_NAME)
        .warn('HTML plugin is not available. Cannot inject mocker runtime.')
      return
    }

    compiler.hooks.compilation.tap(PLUGIN_NAME, (compilation) => {
      HtmlPlugin.getHooks(compilation).beforeAssetTagGeneration.tapAsync(
        PLUGIN_NAME,
        (data, cb) => {
          try {
            const runtimeScriptContent =
              this.cachedRuntime ?? (this.cachedRuntime = getMockerRuntime())
            const runtimeAssetName = 'mocker-runtime-injected.js'

            const Sources = compiler.webpack?.sources
            if (!Sources?.RawSource) {
              throw new Error(
                'rspack sources is not available on compiler.webpack',
              )
            }

            // Emit and reference the runtime once per compilation. Re-emitting an
            // identical asset on every rebuild triggers spurious rebuild loops in dev.
            // See https://github.com/storybookjs/storybook/pull/33169.
            if (!compilation.getAsset(runtimeAssetName)) {
              compilation.emitAsset(
                runtimeAssetName,
                new Sources.RawSource(runtimeScriptContent),
              )
              data.assets.js.unshift(runtimeAssetName)
            }

            cb(null, data)
          } catch (error) {
            cb(error as Error)
          }
        },
      )
    })
  }
}
