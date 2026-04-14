import type { HtmlRspackPlugin, Rspack } from '@rsbuild/core'
import { getMockerRuntime } from 'storybook/internal/mocking-utils'

const PLUGIN_NAME = 'RspackInjectMockerRuntimePlugin'

export class RspackInjectMockerRuntimePlugin {
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
            const runtimeScriptContent = getMockerRuntime()
            const runtimeAssetName = 'mocker-runtime-injected.js'

            const Sources = compiler.webpack?.sources
            if (!Sources?.RawSource) {
              throw new Error(
                'rspack sources is not available on compiler.webpack',
              )
            }
            compilation.emitAsset(
              runtimeAssetName,
              new Sources.RawSource(runtimeScriptContent),
            )

            data.assets.js.unshift(runtimeAssetName)
            cb(null, data)
          } catch (error) {
            cb(error as Error)
          }
        },
      )
    })
  }
}
