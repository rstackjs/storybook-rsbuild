// Ported from builder-vite's change-detection-adapter/headless.ts:
// https://github.com/storybookjs/storybook/blob/v10.6.0/code/builders/builder-vite/src/change-detection-adapter/headless.ts
// Divergence: Vite's `resolveConfig` normalises without a server. Rsbuild has no equivalent, so a
// compiler is created (and closed) to read the same `compiler.options.resolve` the live adapter reads.
import { promisify } from 'node:util'
import type {
  ChangeDetectionAdapter,
  ModuleResolveConfig,
} from 'storybook/internal/core-server'
import type { Options } from 'storybook/internal/types'
import { executor, getConfig } from '../index'
import { overrideRsbuildLogger } from '../logger'
import { createRspackChangeDetectionAdapter } from './index'

export function createHeadlessRsbuildChangeDetectionAdapter(
  options: Options,
): ChangeDetectionAdapter {
  return {
    async getResolveConfig(): Promise<ModuleResolveConfig> {
      overrideRsbuildLogger()
      const { createRsbuild } = await executor.get(options)
      const config = await getConfig(options)
      const rsbuild = await createRsbuild({
        cwd: process.cwd(),
        rsbuildConfig: { ...config, mode: 'development' },
      })
      const compiler = await rsbuild.createCompiler()
      const resolveConfig = await createRspackChangeDetectionAdapter(
        'compilers' in compiler ? compiler.compilers[0] : compiler,
      ).getResolveConfig()
      await promisify(compiler.close.bind(compiler))()
      return resolveConfig
    },

    onFileChange() {
      return () => {} // no live builder, nothing to invalidate
    },
  }
}
