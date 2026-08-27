import { dirname, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Rspack } from '@rsbuild/core'
import {
  babelParser,
  extractMockCalls,
  findMockRedirect,
  getIsExternal,
  resolveExternalModule,
  resolveWithExtensions,
} from 'storybook/internal/mocking-utils'

const PLUGIN_NAME = 'RspackMockPlugin'

/**
 * Normalize file paths to use forward slashes consistently across all platforms.
 * This is necessary because:
 * - `extractMockCalls` uses `pathe` which always returns forward slashes
 * - `resolveWithExtensions` uses Node's `require.resolve` which returns backslashes on Windows
 * Without this normalization, path comparison would fail on Windows.
 */
function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/')
}

export interface RspackMockPluginOptions {
  previewConfigPath: string
  configDir?: string
}

interface ExtractedMock {
  path: string
  spy: boolean
}

interface ResolvedMock extends ExtractedMock {
  absolutePath: string
  replacementResource: string
}

export class RspackMockPlugin {
  private readonly options: RspackMockPluginOptions
  private mockMap: Map<string, ResolvedMock> = new Map()
  private candidateSpecifiers: Set<string> = new Set()
  private lastPreviewMtime: number | undefined

  constructor(options: RspackMockPluginOptions) {
    if (!options.previewConfigPath) {
      throw new Error(`[${PLUGIN_NAME}] \`previewConfigPath\` is required.`)
    }
    this.options = options
  }

  apply(compiler: Rspack.Compiler) {
    const logger = compiler.getInfrastructureLogger(PLUGIN_NAME)

    const updateMocks = () => {
      const mTimePreviewConfig = this.getPreviewConfigMtime(compiler)
      if (
        this.lastPreviewMtime !== undefined &&
        mTimePreviewConfig !== undefined &&
        mTimePreviewConfig === this.lastPreviewMtime
      ) {
        return // unchanged
      }

      const resolved = this.extractAndResolveMocks(compiler)
      this.mockMap = new Map(
        resolved.flatMap((mock) => [
          [normalizePath(mock.absolutePath), mock],
          [normalizePath(mock.absolutePath.replace(/\.[^.]+$/, '')), mock],
        ]),
      )
      // TODO: `mock.path` is not the specifier the user wrote. `extractMockCalls`
      // strips the extension when the declared specifier's basename matches the
      // resolved file's basename, so `sb.mock('pkg/dist/index.js')` is stored as
      // `pkg/dist/index` while `resource.request` keeps the `.js`. The pre-filter
      // below then misses that request and silently skips a mock it was never meant
      // to drop. Register the extension-bearing form here as well.
      // (builder-webpack5 has the same bug: webpack-mock-plugin.ts:86 on `next`.)
      // See https://github.com/rstackjs/storybook-rsbuild/pull/524#discussion_r3688976092
      this.candidateSpecifiers = new Set(resolved.map((mock) => mock.path))
      this.lastPreviewMtime = mTimePreviewConfig

      if (resolved.length > 0) {
        logger.info(`Mock map updated with ${resolved.length} mocks.`)
      }
    }

    compiler.hooks.beforeRun.tap(PLUGIN_NAME, updateMocks)
    compiler.hooks.watchRun.tap(PLUGIN_NAME, updateMocks)

    // Taken from the compiler rather than the module-level `rspack` namespace, matching
    // upstream's webpack5 builder. It keeps the plugin bound to the compiler that is actually
    // running it, and lets tests supply the constructor instead of patching a shared export.
    new compiler.webpack.NormalModuleReplacementPlugin(/.*/, (resource) => {
      try {
        // Skip the resolution probe entirely when no `sb.mock()` calls are declared —
        // otherwise every request in the module graph pays for a `require.resolve`-style
        // lookup for no benefit. See https://github.com/storybookjs/storybook/issues/33778.
        if (this.mockMap.size === 0) {
          return
        }

        const path = resource.request
        const importer = resource.context

        const isExternal = getIsExternal(path, importer)
        // Early filter only for external specifiers. Relative/local specifiers still need
        // resolution to compare against the absolute paths stored in `mockMap`.
        if (isExternal && !this.candidateSpecifiers.has(path)) {
          return
        }
        const absolutePath = isExternal
          ? resolveExternalModule(path, importer)
          : resolveWithExtensions(path, importer)

        const normalizedAbsolutePath = normalizePath(absolutePath)

        if (this.mockMap.has(normalizedAbsolutePath)) {
          resource.request = this.mockMap.get(
            normalizedAbsolutePath,
          )!.replacementResource
        }
      } catch {
        logger.debug(`Could not resolve mock for "${resource.request}".`)
      }
    }).apply(compiler as any)

    compiler.hooks.afterCompile.tap(PLUGIN_NAME, (compilation) => {
      compilation.fileDependencies.add(this.options.previewConfigPath)

      for (const mock of this.mockMap.values()) {
        if (
          isAbsolute(mock.replacementResource) &&
          mock.replacementResource.includes('__mocks__')
        ) {
          compilation.contextDependencies.add(dirname(mock.replacementResource))
        }
      }
    })
  }

  private getPreviewConfigMtime(compiler: Rspack.Compiler): number | undefined {
    try {
      const fs = compiler.inputFileSystem as any
      const stat = fs.statSync?.(this.options.previewConfigPath)
      return stat?.mtime?.getTime?.()
    } catch {
      return undefined
    }
  }

  private extractAndResolveMocks(compiler: Rspack.Compiler): ResolvedMock[] {
    const { previewConfigPath, configDir } = this.options
    const logger = compiler.getInfrastructureLogger(PLUGIN_NAME)

    const mocks = extractMockCalls(
      {
        previewConfigPath,
        configDir: configDir ?? dirname(previewConfigPath),
      },
      babelParser,
      compiler.context,
      findMockRedirect,
    )

    const resolvedMocks: ResolvedMock[] = []

    for (const mock of mocks) {
      try {
        const { absolutePath, redirectPath } = mock

        let replacementResource: string

        if (redirectPath) {
          replacementResource = redirectPath
        } else {
          const loaderPath = fileURLToPath(
            import.meta.resolve(
              'storybook-builder-rsbuild/loaders/rsbuild-automock-loader',
            ),
          )
          replacementResource = `${loaderPath}?spy=${mock.spy}!${absolutePath}`
        }

        resolvedMocks.push({
          ...mock,
          replacementResource,
        })
      } catch (_error) {
        logger.warn(
          `Could not resolve mock for "${mock.path}". It will be ignored.`,
        )
      }
    }

    return resolvedMocks
  }
}
