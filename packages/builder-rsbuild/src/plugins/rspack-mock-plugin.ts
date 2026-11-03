import type { Rspack } from '@rsbuild/core'
import { dirname, isAbsolute } from 'node:path'
import { normalize } from 'pathe'
import type { MockCall } from 'storybook/internal/mocking-utils'
import {
  extractMockCalls,
  findMockRedirect,
} from 'storybook/internal/mocking-utils'
import { logger } from 'storybook/internal/node-logger'

const PLUGIN_NAME = 'RspackMockPlugin'

/**
 * Query marker used to route automocked modules through the rule registered by
 * `pluginStorybookMock`. Kept in this module so the producer (this plugin) and the
 * consumer (the Rsbuild plugin) cannot drift.
 */
export const AUTOMOCK_QUERY_MARKER = '__storybook_automock'

const SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z\d+.-]*:/

const isBareSpecifier = (specifier: string) =>
  !specifier.startsWith('.') && !isAbsolute(specifier)

type RspackResolver = ReturnType<Rspack.Compiler['resolverFactory']['get']>

export interface RspackMockPluginOptions {
  previewConfigPath: string
  configDir?: string
}

export class RspackMockPlugin {
  private mocksByPath = new Map<string, MockCall>()
  private redirectsBySpecifier = new Map<string, string>()
  private resolvers: RspackResolver[] = []
  private lastPreviewMtime: number | undefined
  private updatePromise: Promise<void> | undefined
  private readonly options: RspackMockPluginOptions

  constructor(options: RspackMockPluginOptions) {
    if (!options.previewConfigPath) {
      throw new Error(`[${PLUGIN_NAME}] \`previewConfigPath\` is required.`)
    }
    this.options = options
  }

  apply(compiler: Rspack.Compiler) {
    const updateMocks = async () => {
      const previewMtime = this.getPreviewConfigMtime(compiler)
      if (
        previewMtime !== undefined &&
        previewMtime === this.lastPreviewMtime
      ) {
        return
      }

      const { previewConfigPath, configDir } = this.options
      const previewDir = configDir ?? dirname(previewConfigPath)
      const mocks = extractMockCalls(
        { previewConfigPath, configDir: previewDir },
        compiler.context,
        findMockRedirect,
      )

      // Resolve every declared mock once per preview change with the same resolvers the
      // compiler uses for imports (`esm`) and requires (`commonjs`). A dual package can have
      // a different entry file for each, so both paths are keyed.
      this.resolvers = ['esm', 'commonjs'].map((dependencyType) =>
        compiler.resolverFactory.get('normal', { dependencyType }),
      )
      this.mocksByPath = new Map()
      this.redirectsBySpecifier = new Map()

      for (const mock of mocks) {
        if (mock.redirectPath && isBareSpecifier(mock.specifier)) {
          this.redirectsBySpecifier.set(mock.specifier, mock.redirectPath)
        }

        const paths = await Promise.all(
          this.resolvers.map((resolver) =>
            resolveWithWebpack(resolver, previewDir, mock.specifier),
          ),
        )
        const resolved = paths.filter(
          (path): path is string => path !== undefined,
        )

        if (
          resolved.length === 0 &&
          !this.redirectsBySpecifier.has(mock.specifier)
        ) {
          logger.warn(
            `Could not resolve "${mock.specifier}" from ${previewDir}, so its sb.mock() call is ignored.`,
          )
        }

        for (const path of resolved) {
          this.mocksByPath.set(normalize(path), mock)
        }
      }

      this.lastPreviewMtime = previewMtime

      if (mocks.length > 0) {
        logger.info(`Mock map updated with ${mocks.length} mocks.`)
      }
    }

    // DIVERGES FROM UPSTREAM — upstream matches in `afterResolve` and calls
    // `factory.hooks.resolve` again so webpack rebuilds createData and re-matches loaders.
    // Rspack computes rules, loaders, module type and parser before `afterResolve`, and its
    // JS `normalModuleFactory.hooks.resolve` is a passive tapable hook with no Rust re-entry,
    // so the match has to happen before resolution instead.
    // https://github.com/storybookjs/storybook/blob/bc5ae1af0f074bf2b81e3ab64ab07f0237937e2d/code/builders/builder-webpack5/src/plugins/webpack-mock-plugin.ts#L83-L109
    // https://github.com/web-infra-dev/rspack/blob/124d2b66c13e928e378f8fb8c84b721390c3865b/crates/rspack_core/src/normal_module_factory.rs#L1011-L1232
    // DIVERGES FROM UPSTREAM — refresh in `thisCompilation`, not `beforeRun`/`watchRun`.
    // Rspack builds `ResolverFactory` in the Compiler constructor before
    // `applyRspackOptionsDefaults`, and the binding only receives the defaulted resolve
    // options when `#getInstance` creates `JsCompiler`, which happens after `beforeRun`.
    // A `commonjs` resolver created in `beforeRun` is cached by `ResolverFactory.get`
    // without the default `byDependency` conditions and keeps failing for the life of the
    // compiler. Root cause:
    // https://github.com/web-infra-dev/rspack/blob/124d2b66c13e928e378f8fb8c84b721390c3865b/packages/rspack/src/Compiler.ts#L342-L348
    // https://github.com/web-infra-dev/rspack/blob/124d2b66c13e928e378f8fb8c84b721390c3865b/packages/rspack/src/rspack.ts#L78
    // https://github.com/web-infra-dev/rspack/blob/124d2b66c13e928e378f8fb8c84b721390c3865b/crates/rspack_binding_api/src/lib.rs#L373-L379
    // https://github.com/web-infra-dev/rspack/blob/124d2b66c13e928e378f8fb8c84b721390c3865b/packages/rspack/src/Compiler.ts#L628-L638
    // https://github.com/web-infra-dev/rspack/blob/124d2b66c13e928e378f8fb8c84b721390c3865b/packages/rspack/src/ResolverFactory.ts#L82-L108
    // Repro: a package whose exports map only has a require condition fails with
    // PackagePathNotExported from beforeRun but resolves from thisCompilation.
    compiler.hooks.thisCompilation.tap(PLUGIN_NAME, () => {
      this.updatePromise ??= updateMocks().finally(() => {
        this.updatePromise = undefined
      })
    })

    compiler.hooks.normalModuleFactory.tap(PLUGIN_NAME, (factory) => {
      factory.hooks.beforeResolve.tapPromise(
        PLUGIN_NAME,
        async (resolveData) => {
          // The refresh starts once per compilation in `thisCompilation`; wait for it
          // without a per-request preview stat.
          if (this.updatePromise) {
            await this.updatePromise
          }

          // Skip the resolver call entirely when no `sb.mock()` calls are declared.
          if (this.mocksByPath.size === 0) {
            return
          }

          const { request } = resolveData
          if (!request || isUnmatchableRequest(request)) {
            return
          }

          // A package the browser build cannot resolve, such as one with a server-only
          // `exports` map, still needs its manual mock, so redirect it by exact request
          // before the resolver runs at all.
          const redirectPath = this.redirectsBySpecifier.get(request)
          if (redirectPath) {
            resolveData.request = redirectPath
            resolveData.context = dirname(redirectPath)
            return
          }

          const resolved = this.resolveRequest(resolveData.context, request)
          if (!resolved) {
            return
          }

          // `resolveSync` returns the full resource including query/fragment; upstream
          // matches on `resourceResolveData.path`, which has neither.
          const mock = this.mocksByPath.get(
            normalize(pathFromResource(resolved)),
          )
          if (!mock) {
            return
          }

          if (mock.redirectPath) {
            resolveData.request = mock.redirectPath
            resolveData.context = dirname(mock.redirectPath)
          } else {
            // The query selects the post-loader rule registered by
            // `pluginStorybookMock`; `spy` travels through the rule options.
            resolveData.request = withAutomockQuery(
              resolved,
              AUTOMOCK_QUERY_MARKER,
              mock.spy,
            )
          }
        },
      )
    })

    compiler.hooks.afterCompile.tap(PLUGIN_NAME, (compilation) => {
      compilation.fileDependencies.add(this.options.previewConfigPath)

      for (const mock of this.mocksByPath.values()) {
        if (mock.redirectPath && mock.redirectPath.includes('__mocks__')) {
          compilation.contextDependencies.add(dirname(mock.redirectPath))
        }
      }
    })
  }

  /**
   * `beforeResolve` does not expose the dependency type, so try the ESM resolver first
   * (matching an `import`) and fall back to the CommonJS resolver for `require`-only
   * packages. Rule-level `resolve` overrides are also unavailable before resolution.
   */
  private resolveRequest(context: string, request: string) {
    for (const resolver of this.resolvers) {
      try {
        const resolved = resolver.resolveSync({}, context, request)
        if (resolved) {
          return resolved
        }
      } catch {
        // Try the next resolver; an unmatched request is left to Rspack.
      }
    }
    return undefined
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
}

function isUnmatchableRequest(request: string) {
  return (
    request.includes('!') ||
    (!isAbsolute(request) && SCHEME_PATTERN.test(request))
  )
}

function pathFromResource(resource: string) {
  const markerIndex = resource.search(/[?#]/)
  return markerIndex === -1 ? resource : resource.slice(0, markerIndex)
}

function withAutomockQuery(resource: string, marker: string, spy: boolean) {
  const fragmentIndex = resource.indexOf('#')
  const fragment = fragmentIndex === -1 ? '' : resource.slice(fragmentIndex)
  const withoutFragment =
    fragmentIndex === -1 ? resource : resource.slice(0, fragmentIndex)
  const separator = withoutFragment.includes('?') ? '&' : '?'
  return `${withoutFragment}${separator}${marker}&spy=${spy}${fragment}`
}

function resolveWithWebpack(
  resolver: RspackResolver,
  context: string,
  specifier: string,
) {
  return new Promise<string | undefined>((resolve) => {
    resolver.resolve({}, context, specifier, {}, (error, _result, request) => {
      const path = request?.path
      resolve(!error && typeof path === 'string' ? path : undefined)
    })
  })
}
