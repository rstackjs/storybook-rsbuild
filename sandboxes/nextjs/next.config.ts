import { fileURLToPath } from 'node:url'
import type { NextConfig } from 'next'

// Exercises every shape of user webpack delta we extract:
//   1. Append a rule with a *bare* loader name (`@svgr/webpack`) — locks in
//      `resolveLoader.modules` fallback to the consumer's `node_modules`.
//   2. Mutate an existing Next.js rule (image `exclude = /\.svg$/`) — locks in
//      that `tools.rspack` runs the user hook against the live rspack config
//      so mutations on pre-existing rules survive (safe-wallet pattern).
//   3. Add a `resolve.alias` entry — locks in delta-driven alias forwarding
//      (anticapture pattern).
//   4. Push a non-trivial plugin instance — locks in `forwardNextConfigPlugins:
//      false` dropping user plugins by default (proposalsapp / safe-wallet
//      pattern, where forwarded plugins crash rspack's IPC channel).
class StorybookUserPluginProbe {
  apply(compiler: any) {
    // If this plugin actually runs, it writes a marker asset that the e2e can
    // detect. With the default `forwardNextConfigPlugins: false` the marker
    // must NOT appear — that's the regression signal.
    compiler.hooks.thisCompilation.tap(
      'StorybookUserPluginProbe',
      (compilation: any) => {
        compilation.hooks.processAssets.tap(
          'StorybookUserPluginProbe',
          (assets: any) => {
            const { RawSource } = compiler.webpack.sources
            assets['user-plugin-probe.marker.txt'] = new RawSource(
              'user-plugin-ran',
            )
          },
        )
      },
    )
  }
}

const nextConfig: NextConfig = {
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },
  transpilePackages: ['@sandboxes/nextjs-transpiled'],
  webpack: (config, { webpack }) => {
    // (2) Steal SVG from the default image rule before SVGR claims it.
    for (const rule of config.module?.rules ?? []) {
      if (
        rule &&
        typeof rule === 'object' &&
        'type' in rule &&
        typeof rule.type === 'string' &&
        rule.type.startsWith('asset')
      ) {
        const test = (rule as any).test
        if (test instanceof RegExp && test.test('probe.svg')) {
          ;(rule as any).exclude = /\.svg$/
        }
      }
    }
    // (1) SVGR via bare loader name — exercises `resolveLoader.modules`.
    config.module?.rules?.push({
      test: /\.svg$/,
      use: ['@svgr/webpack'],
    })
    // (3) User alias.
    config.resolve = config.resolve ?? {}
    config.resolve.alias = {
      ...(config.resolve.alias as Record<string, string>),
      '@user-alias/probe': fileURLToPath(
        new URL('./src/stories/user-alias-target.ts', import.meta.url),
      ),
    }
    // (4) User-added resolve.fallback for a non-builtin module. Mirrors
    // proposalsapp's pattern of stubbing server-side deps (pg, jsdom, …) so
    // a transitive browser bundle doesn't try to resolve them.
    config.resolve.fallback = {
      ...(config.resolve.fallback as Record<string, string | false>),
      'sandbox-fake-native': false,
    }
    // (5) Plugins forwarded only when framework option
    // `forwardNextConfigPlugins: true` (set in `.storybook/main.ts`).
    // - DefinePlugin: positive assertion via story `UserDefine` reading
    //   __USER_DEFINE__ at runtime.
    // - StorybookUserPluginProbe: silent regression target — taps
    //   `compilation.hooks.processAssets`, which is the hook that crashed
    //   rspack IPC for safe-wallet's CopyPlugin. If the framework regresses
    //   how `processAssets`-using plugins are forwarded, every story will
    //   fail to render (build crash).
    config.plugins = config.plugins ?? []
    config.plugins.push(
      new webpack.DefinePlugin({
        __USER_DEFINE__: JSON.stringify('user-define-value'),
      }),
      new StorybookUserPluginProbe(),
    )
    return config
  },
}

export default nextConfig
