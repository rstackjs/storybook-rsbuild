import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { RsbuildConfig, Rspack } from '@rsbuild/core'
import { loadConfig, mergeRsbuildConfig } from '@rsbuild/core'
import { pluginTypeCheck } from '@rsbuild/plugin-type-check'
// @ts-expect-error (I removed this on purpose, because it's incorrect)
import CaseSensitivePathsPlugin from 'case-sensitive-paths-webpack-plugin'
import { pluginHtmlMinifierTerser } from 'rsbuild-plugin-html-minifier-terser'
import {
  getBuilderOptions,
  isPreservingSymlinks,
  normalizeStories,
  stringifyProcessEnvs,
} from 'storybook/internal/common'
import { globalsNameReferenceMap } from 'storybook/internal/preview/globals'
import type { Options } from 'storybook/internal/types'
import { dedent } from 'ts-dedent'
import type { BuilderOptions, TypescriptOptions } from '../types'
import { getVirtualModules } from './virtual-module-mapping'

const require = createRequire(import.meta.url)

const getAbsolutePath = <T extends string>(input: T): T => {
  const storybookPath = fileURLToPath(
    import.meta.resolve('storybook/package.json'),
  )

  // Can't directly use `import.meta.resolve` here because `parentURL` parameter is not standardized yet.
  return dirname(
    require.resolve(join(input, 'package.json'), {
      paths: [dirname(storybookPath)],
    }),
  ) as any as T
}

const maybeGetAbsolutePath = <I extends string>(input: I): I | false => {
  try {
    return getAbsolutePath(input)
  } catch (_e) {
    return false
  }
}

const builtInResolveExtensions = [
  '.mjs',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.json',
  '.cjs',
]

/** @see https://github.com/web-infra-dev/rsbuild/blob/d8204bb72b5dd32dc736372dff6bb618675a4ad5/packages/core/src/constants.ts#L61 */
const RAW_QUERY_REGEX = /[?&]raw(?:&|=|$)/

const globalPath = maybeGetAbsolutePath('@storybook/global')

// these packages are not pre-bundled because of react dependencies.
// these are not dependencies of the builder anymore, thus resolving them can fail.
// we should remove the aliases in 8.0, I'm not sure why they are here in the first place.
const storybookPaths: Record<string, string> = {
  // biome-ignore lint/complexity/useLiteralKeys: dynamic key required for conditional spread
  ...(globalPath ? { ['@storybook/global']: globalPath } : {}),
}

export type RsbuildBuilderOptions = Options & {
  typescriptOptions: TypescriptOptions
}

export default async (
  options: RsbuildBuilderOptions,
  extraWebpackConfig?: Rspack.Configuration,
): Promise<RsbuildConfig> => {
  const { rsbuildConfigPath, addonDocs } =
    await getBuilderOptions<BuilderOptions>(options)
  const webpackConfigFromPresets =
    await options.presets.apply<Rspack.Configuration>('webpack', {}, options)

  if (addonDocs) {
    console.warn(
      '`addonDocs` option is deprecated and will be removed in future versions. Please use `@storybook/addon-docs` option instead.',
    )
  }

  const {
    outputDir = join('.', 'public'),
    quiet,
    packageJson,
    configType,
    presets,
    previewUrl,
    typescriptOptions,
    features,
  } = options

  const isProd = configType === 'PRODUCTION'
  const workingDir = process.cwd()

  const [
    coreOptions,
    frameworkOptions,
    envs,
    logLevel,
    headHtmlSnippet,
    bodyHtmlSnippet,
    template,
    docsOptions,
    entries,
    nonNormalizedStories,
    _modulesCount,
    build,
    tagsOptions,
  ] = await Promise.all([
    presets.apply('core'),
    presets.apply('frameworkOptions'),
    presets.apply<Record<string, string>>('env'),
    presets.apply('logLevel', undefined),
    presets.apply('previewHead'),
    presets.apply('previewBody'),
    presets.apply<string>('previewMainTemplate'),
    presets.apply('docs'),
    presets.apply<string[]>('entries', []),
    presets.apply('stories', []),
    options.cache?.get('modulesCount', 1000),
    options.presets.apply('build'),
    presets.apply('tags', {}),
  ])

  const stories = normalizeStories(nonNormalizedStories, {
    configDir: options.configDir,
    workingDir,
  })

  const shouldCheckTs =
    typescriptOptions.check && !typescriptOptions.skipCompiler
  const tsCheckOptions = typescriptOptions.checkOptions || {}

  const builderOptions = await getBuilderOptions<BuilderOptions>(options)
  const cacheConfig = builderOptions.fsCache ? true : undefined

  const shouldDisableDevFeatures =
    process.env.SB_RSBUILD_TEST_MINIMAL_DEV === 'true'

  let lazyCompilationConfig: Rspack.Configuration['lazyCompilation']

  if (!isProd) {
    if (shouldDisableDevFeatures) {
      lazyCompilationConfig = false
    } else {
      lazyCompilationConfig =
        builderOptions.lazyCompilation === undefined
          ? {
              entries: false,
            }
          : builderOptions.lazyCompilation
    }
  }

  const shouldDisableHmr = shouldDisableDevFeatures

  if (!template) {
    throw new Error(dedent`
      Storybook's Webpack5 builder requires a template to be specified.
      Somehow you've ended up with a falsy value for the template option.

      Please file an issue at https://github.com/storybookjs/storybook with a reproduction.
    `)
  }

  const externals: Record<string, string> = globalsNameReferenceMap

  // TODO: remove in v3 (SB10)
  if (build?.test?.disableBlocks) {
    externals['@storybook/blocks'] = '__STORYBOOK_BLOCKS_EMPTY_MODULE__'
  }

  const { virtualModules: virtualModuleMapping, entries: dynamicEntries } =
    await getVirtualModules(options)

  let contentFromConfig: RsbuildConfig = {}
  const { content } = await loadConfig({
    cwd: workingDir,
    path: rsbuildConfigPath,
  })

  const { environments, ...withoutEnv } = content
  if (content.environments) {
    const envCount = Object.keys(content.environments).length
    if (envCount === 0) {
      // Empty useless environment field.
      contentFromConfig = withoutEnv
    } else if (envCount === 1) {
      // Directly use the unique environment.
      contentFromConfig = mergeRsbuildConfig(
        withoutEnv,
        content.environments[0],
      )
    } else {
      // User need to specify the environment first if more than one provided.
      const userEnv = builderOptions.environment
      if (typeof userEnv !== 'string') {
        throw new Error(
          'You must specify an environment when there are multiple environments in the Rsbuild config.',
        )
      }

      if (Object.keys(content.environments).includes(userEnv)) {
        contentFromConfig = mergeRsbuildConfig(
          withoutEnv,
          content.environments[userEnv],
        )
      } else {
        throw new Error(
          `The specified environment "${userEnv}" is not found in the Rsbuild config.`,
        )
      }
    }
  } else {
    contentFromConfig = content
  }

  const resourceFilename = isProd
    ? 'static/media/[name].[contenthash:8][ext]'
    : 'static/media/[path][name][ext]'

  const rsbuildConfig = mergeRsbuildConfig(contentFromConfig, {
    output: {
      cleanDistPath: false,
      assetPrefix: '/',
      dataUriLimit: {
        media: 10000,
      },
      sourceMap: {
        js: options.build?.test?.disableSourcemaps
          ? false
          : 'cheap-module-source-map',
        css: !options.build?.test?.disableSourcemaps,
      },
      distPath: {
        root: resolve(process.cwd(), outputDir),
      },
      filename: {
        js: isProd
          ? '[name].[contenthash:8].iframe.bundle.js'
          : '[name].iframe.bundle.js',
        image: resourceFilename,
        font: resourceFilename,
        media: resourceFilename,
      },
      externals,
    },
    server: {
      // Storybook will handle public directory itself, disable Rsbuild's public dir
      // feature to prevent overwriting Storybook's public directory.
      publicDir: false,
    },
    dev: {
      assetPrefix: '/',
      progressBar: !quiet,
      hmr: shouldDisableHmr ? false : undefined,
    },
    resolve: {
      alias: {
        ...storybookPaths,
      },
    },
    source: {
      define: {
        ...stringifyProcessEnvs(envs),
        NODE_ENV: JSON.stringify(process.env.NODE_ENV),
      },
    },
    performance: {
      chunkSplit: {
        strategy: 'custom',
        splitChunks: {
          chunks: 'all',
        },
      },
      buildCache: cacheConfig,
    },
    plugins: [
      shouldCheckTs ? pluginTypeCheck(tsCheckOptions) : null,
      pluginHtmlMinifierTerser(() => ({
        collapseWhitespace: true,
        removeComments: true,
        removeRedundantAttributes: true,
        removeScriptTypeAttributes: false,
        removeStyleLinkTypeAttributes: true,
        useShortDoctype: true,
      })),
    ].filter(Boolean),
    tools: {
      swc: (config) => {
        config.env ??= {}
        // Ensure the deconstruction of the in-play function in parameters.
        config.env.bugfixes = true
      },
      rspack: (config, { addRules, appendRules, rspack, mergeConfig }) => {
        addRules({
          test: /\.stories\.([tj])sx?$|(stories|story)\.mdx$/,
          exclude: /node_modules/,
          enforce: 'post',
          use: [
            {
              loader: require.resolve(
                'storybook-builder-rsbuild/loaders/export-order-loader',
              ),
            },
          ],
        })

        // Disable warning for dynamic requires
        config.module ??= {}
        config.module.parser ??= {}
        config.module.parser.javascript ??= {}
        config.module.parser.javascript.unknownContextCritical = false

        config.resolve ??= {}
        config.resolve.symlinks = !isPreservingSymlinks()
        config.resolve.extensions = Array.from(
          new Set([
            ...(config.resolve.extensions ?? []),
            ...builtInResolveExtensions,
          ]),
        )

        config.watchOptions = {
          ignored: /node_modules/,
        }

        config.ignoreWarnings = [
          ...(config.ignoreWarnings || []),
          /export '\S+' was not found in 'global'/,
          /export '\S+' was not found in '@storybook\/global'/,
        ]

        config.resolve ??= {}
        config.resolve.fallback ??= {
          stream: false,
          path: require.resolve('path-browserify'),
          assert: require.resolve('browser-assert'),
          util: require.resolve('util'),
          url: require.resolve('url'),
          fs: false,
          constants: require.resolve('constants-browserify'),
        }

        config.optimization ??= {}
        config.optimization.runtimeChunk = true
        config.optimization.usedExports = options.build?.test
          ?.disableTreeShaking
          ? false
          : isProd
        config.optimization.moduleIds = 'named'

        // If using react-dom-shim with React 16/17, `useId` won't be exported in dependency,
        // which will cause an HarmonyLinkingError. Set `exportsPresence` to `false` to allow
        // doing this runtime detection.
        config.module ??= {}
        config.module.parser ??= {}
        config.module.parser.javascript ??= {}
        config.module.parser.javascript.exportsPresence = false

        if (!rspack.experiments?.VirtualModulesPlugin) {
          throw new Error(
            'rspack.experiments.VirtualModulesPlugin requires at least 1.5.0 version of @rsbuild/core, please upgrade or downgrade storybook-rsbuild-builder to lower version.',
          )
        }

        config.plugins ??= []
        config.plugins.push(
          ...[
            Object.keys(virtualModuleMapping).length > 0
              ? new rspack.experiments.VirtualModulesPlugin(
                  virtualModuleMapping,
                )
              : (null as any),
            new rspack.ProvidePlugin({
              process: require.resolve('process/browser.js'),
            }),
            new CaseSensitivePathsPlugin(),
          ].filter(Boolean),
        )

        config.experiments ??= {}
        config.experiments.outputModule = false
        config.externalsType = 'var'
        config.output ??= {}
        config.output.module = false
        config.output.chunkFormat = 'array-push'
        config.output.chunkLoading = 'jsonp'

        if (lazyCompilationConfig !== undefined) {
          config.lazyCompilation = lazyCompilationConfig
        }

        // Fallback rule for raw imports (e.g., `import docs from './README.md?raw'`).
        // This is a low-priority rule that handles any file with `?raw` query as raw string.
        // Placed at the end of rules array via appendRules to ensure it doesn't override
        // more specific rules from Rsbuild's asset/script plugins.
        // @see https://github.com/storybookjs/storybook/blob/8486c72ce5fc4946755cafdcdb671f6f5dd9937d/code/builders/builder-webpack5/src/preview/base-webpack.config.ts
        appendRules({
          resourceQuery: RAW_QUERY_REGEX,
          type: 'asset/source',
        })

        return mergeConfig(
          config,
          extraWebpackConfig || {},
          webpackConfigFromPresets,
        )
      },
      htmlPlugin: {
        filename: 'iframe.html',
        // FIXME: `none` isn't a known option
        chunksSortMode: 'none' as any,
        alwaysWriteToDisk: true,
        inject: false,
        template,
        templateParameters: {
          version:
            packageJson?.version ?? '0.0.0-storybook-rsbuild-unknown-version',
          globals: {
            CONFIG_TYPE: configType,
            LOGLEVEL: logLevel,
            FRAMEWORK_OPTIONS: frameworkOptions,
            CHANNEL_OPTIONS: coreOptions.channelOptions,
            FEATURES: features,
            PREVIEW_URL: previewUrl,
            STORIES: stories.map((specifier) => ({
              ...specifier,
              importPathMatcher: specifier.importPathMatcher.source,
            })),
            DOCS_OPTIONS: docsOptions,
            TAGS_OPTIONS: tagsOptions,
            ...(build?.test?.disableBlocks
              ? { __STORYBOOK_BLOCKS_EMPTY_MODULE__: {} }
              : {}),
          },
          headHtmlSnippet,
          bodyHtmlSnippet,
        },
      },
    },
  })

  // Override `config.source.entry` here, prevent it from merging with user config entries.
  // see https://github.com/rstackjs/storybook-rsbuild/issues/43.
  // see https://github.com/rstackjs/storybook-rsbuild/issues/357.
  rsbuildConfig.source ??= {}
  rsbuildConfig.source.entry = {
    main: [...(entries ?? []), ...dynamicEntries],
  }

  return rsbuildConfig
}
