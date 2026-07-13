import { fileURLToPath } from 'node:url'
import type { NextConfig } from 'next'

// Exercises every user webpack-delta shape the bridge extracts: bare-loader
// rule, mutated Next rule, resolve.alias, resolve.fallback, forwarded plugins.
class StorybookUserPluginProbe {
  apply(compiler: any) {
    // Writes a marker asset when the plugin runs; the e2e asserts it is absent
    // under the default forwardNextConfigPlugins: false.
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
  // `@sandboxes/nextjs-barrel` is a TS re-export barrel: listing it here makes
  // next-swc emit `__barrel_optimize__` for its named imports, exercising the
  // matchResource → SWC-chain rule (`makeBarrelRule`) against TS source.
  experimental: {
    optimizePackageImports: ['lucide-react', '@sandboxes/nextjs-barrel'],
  },
  // SWC styled-components transform — must flow through our extracted loader
  // chain (exercised by the StyledComponents story).
  compiler: {
    styledComponents: true,
  },
  transpilePackages: ['@sandboxes/nextjs-transpiled'],
  webpack: (config, { webpack }) => {
    // (2) Mutate an existing Next rule: steal SVG from the default asset rule.
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
    // (4) User-added resolve.fallback stubbing a non-builtin module.
    config.resolve.fallback = {
      ...(config.resolve.fallback as Record<string, string | false>),
      'sandbox-fake-native': false,
    }
    // (5) Plugins forwarded only under forwardNextConfigPlugins: true.
    // DefinePlugin is asserted by the UserDefine story; StorybookUserPluginProbe
    // taps processAssets (the hook that crashes rspack IPC when mis-forwarded).
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
