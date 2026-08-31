import type * as rsbuildReal from '@rsbuild/core'
import type {
  ChangeDetectionAdapter,
  ModuleResolveConfig,
} from 'storybook/internal/core-server'
import type { Options } from 'storybook/internal/types'
import { getRspackResolveConfig } from './index'

export interface HeadlessRsbuildDependencies {
  getConfig: (options: Options) => Promise<rsbuildReal.RsbuildConfig>
  getRsbuild: (
    options: Options,
  ) => Promise<Pick<typeof rsbuildReal, 'createRsbuild'>>
}

/**
 * Headless implementation of {@link ChangeDetectionAdapter}, for consumers that host the module
 * graph without a dev server (the `storybook tools` CLI).
 *
 * It assembles the same config the dev server uses and creates a development-mode Rspack compiler
 * serverlessly, so aliases, conditions, and the project root are normalised exactly like the live
 * adapter's compiler snapshot.
 *
 * There is no live builder, so `onFileChange` never fires: the consumer's graph is built once per
 * invocation and never needs invalidation.
 */
export function createHeadlessRsbuildChangeDetectionAdapter(
  options: Options,
  { getConfig, getRsbuild }: HeadlessRsbuildDependencies,
): ChangeDetectionAdapter {
  return {
    async getResolveConfig(): Promise<ModuleResolveConfig> {
      const { createRsbuild } = await getRsbuild(options)
      const config = await getConfig(options)
      const rsbuild = await createRsbuild({
        cwd: process.cwd(),
        rsbuildConfig: {
          ...config,
          mode: 'development',
        },
      })
      const compiler = await rsbuild.createCompiler()
      const previewCompiler =
        'compilers' in compiler ? compiler.compilers[0] : compiler

      try {
        return getRspackResolveConfig(previewCompiler)
      } finally {
        await new Promise<void>((resolve, reject) => {
          compiler.close((error) => {
            if (error) {
              reject(error)
            } else {
              resolve()
            }
          })
        })
      }
    },

    onFileChange() {
      return () => {}
    },
  }
}
