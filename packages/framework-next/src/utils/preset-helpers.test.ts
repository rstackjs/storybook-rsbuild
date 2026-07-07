import { rspack } from '@rsbuild/core'
import { describe, expect, it } from '@rstest/core'
import {
  analyzeNextLoaderChain,
  buildAliasLayers,
  buildNextLoaderChain,
  dedupProvidePluginKeys,
  filterNextAliases,
  filterNextPlugins,
  isNextSwcLoaderName,
  isProtectedFrameworkAliasKey,
  isRuntimeCssUrl,
  makeBarrelRule,
  makeFontRule,
  mergeFallback,
  NODE_BUILTINS_FALLBACK,
  partitionDefinePlugins,
  readProvidedMap,
  replaceSwcRules,
  resolveNodeProtocolRequest,
  ruleLoaderNames,
  rulesCongruentForDedup,
  rulesHandleSass,
  ruleTestSignature,
  TARGET_CSS_RE,
  withRuntimeUrlFilter,
} from './preset-helpers'

describe('filterNextAliases', () => {
  it('drops react / react-dom aliases so Storybook owns React identity', () => {
    const input = {
      react: '/next/dist/compiled/react',
      'react-dom': '/next/dist/compiled/react-dom',
      'react-dom/client': '/next/dist/compiled/react-dom/client',
      'react-server-dom-webpack/client': '/somewhere',
      'next/head': '/next/dist/shared/lib/head',
    }
    expect(filterNextAliases(input)).toEqual({
      'next/head': '/next/dist/shared/lib/head',
    })
  })

  it('preserves unrelated aliases including ones that merely contain "react"', () => {
    const input = {
      reactish: '/some/path',
      'my-react-addon': '/other',
      'next/image': '/mock',
    }
    expect(filterNextAliases(input)).toEqual(input)
  })

  it('keeps false and array alias values', () => {
    const input = {
      'next/head': false as const,
      'next/link': ['/a', '/b'],
    }
    expect(filterNextAliases(input)).toEqual(input)
  })

  it('drops webpack exact-match ($) react keys (preact/compat aliasing)', () => {
    const input = {
      react$: '/preact/compat',
      'react-dom$': '/preact/compat',
      'react/jsx-runtime$': '/preact/jsx-runtime',
      'react-dom/client$': '/preact/compat/client',
      'next/head': '/keep',
    }
    expect(filterNextAliases(input)).toEqual({ 'next/head': '/keep' })
  })

  it('keeps $-suffixed keys that merely contain react (preact$, reactish$)', () => {
    const input = {
      preact$: '/preact',
      reactish$: '/reactish',
      'my-react$': '/mine',
    }
    expect(filterNextAliases(input)).toEqual(input)
  })

  it('strips only one trailing $ (react$$ is not a blocked react key)', () => {
    const input = { react$$: '/weird' }
    expect(filterNextAliases(input)).toEqual(input)
  })
})

describe('isProtectedFrameworkAliasKey', () => {
  it('protects next/image, next/legacy/image and styled-jsx keys (plain and $-exact, subpaths)', () => {
    for (const k of [
      'next/image',
      'next/image$',
      'next/legacy/image',
      'next/legacy/image$',
      'styled-jsx',
      'styled-jsx$',
      'styled-jsx/style',
      'styled-jsx/style.js',
      'styled-jsx/css$',
    ]) {
      expect(isProtectedFrameworkAliasKey(k)).toBe(true)
    }
  })

  it('does not protect unrelated or near-miss keys', () => {
    for (const k of [
      'next/imagex',
      'next/image-loader',
      'next/legacy/imagex',
      'next/legacy/image-loader',
      'styled-jsxx',
      'next/link',
      'react',
    ]) {
      expect(isProtectedFrameworkAliasKey(k)).toBe(false)
    }
  })
})

describe('buildAliasLayers', () => {
  const OVERRIDES = {
    'next/image$': '/mock/next-image',
    'styled-jsx': '/resolved/styled-jsx',
  }

  it('layers overrides → base → user delta with user winning ordinary keys', () => {
    const { alias } = buildAliasLayers(
      { 'next/head': '/base/head', 'next/link': '/base/link' },
      { 'next/link': '/user/link' },
      OVERRIDES,
    )
    expect(alias).toEqual({
      'next/image$': '/mock/next-image',
      'styled-jsx': '/resolved/styled-jsx',
      'next/head': '/base/head',
      'next/link': '/user/link',
    })
  })

  it('spreads overrides FIRST so insertion order keeps the mock/singleton ahead', () => {
    const { alias } = buildAliasLayers({}, {}, OVERRIDES)
    expect(Object.keys(alias)).toEqual(['next/image$', 'styled-jsx'])
  })

  it('strips react/RSC from both base and user delta, reporting dropped user keys', () => {
    const { alias, droppedReactKeys } = buildAliasLayers(
      { react: '/base/react', 'next/head': '/base/head' },
      { react: '/user/react', 'react-dom$': '/user/react-dom' },
      OVERRIDES,
    )
    expect(alias.react).toBeUndefined()
    expect(alias['next/head']).toBe('/base/head')
    expect(droppedReactKeys.sort()).toEqual(['react', 'react-dom$'])
  })

  it('strips protected keys from the user delta (reported) and silently from base', () => {
    const { alias, droppedProtectedKeys } = buildAliasLayers(
      { 'styled-jsx$': '/base/styled-jsx', 'next/head': '/base/head' },
      { 'next/image$': '/user/image', 'next/link': '/user/link' },
      OVERRIDES,
    )
    // Override wins for the protected key; user's attempt is dropped + reported.
    expect(alias['next/image$']).toBe('/mock/next-image')
    expect(alias['styled-jsx$']).toBeUndefined()
    expect(alias['next/link']).toBe('/user/link')
    expect(droppedProtectedKeys).toEqual(['next/image$'])
  })

  it('does not mutate its inputs', () => {
    const base = { react: '/base/react', 'next/head': '/base/head' }
    const userDelta = { 'next/image$': '/user/image' }
    buildAliasLayers(base, userDelta, OVERRIDES)
    expect(base).toEqual({ react: '/base/react', 'next/head': '/base/head' })
    expect(userDelta).toEqual({ 'next/image$': '/user/image' })
  })
})

describe('readProvidedMap', () => {
  it('reads `.definitions` when present (webpack-public path)', () => {
    const plugin = { definitions: { Buffer: ['buffer', 'Buffer'] } }
    expect(readProvidedMap(plugin)).toEqual({ Buffer: ['buffer', 'Buffer'] })
  })

  it('falls back to `_args[0]` when definitions is absent (rspack-internal path)', () => {
    const plugin = { _args: [{ Buffer: ['buffer', 'Buffer'] }] }
    expect(readProvidedMap(plugin)).toEqual({ Buffer: ['buffer', 'Buffer'] })
  })

  it('returns null for non-ProvidePlugin shapes', () => {
    expect(readProvidedMap({})).toBeNull()
    expect(readProvidedMap({ _args: ['not-an-object'] })).toBeNull()
    expect(readProvidedMap(null)).toBeNull()
  })
})

describe('dedupProvidePluginKeys (proposalsapp / safe-wallet pattern)', () => {
  class RspackProvidePlugin {
    public definitions: Record<string, unknown>
    constructor(definitions: Record<string, unknown>) {
      this.definitions = definitions
    }
  }
  class OtherPlugin {}

  it('drops keys from the Next plugin that Rsbuild already provides', () => {
    const rsbuild = [new RspackProvidePlugin({ process: '/abs/process' })]
    const next = [
      new RspackProvidePlugin({
        Buffer: ['buffer', 'Buffer'],
        process: ['process'],
      }),
    ]
    const out = dedupProvidePluginKeys(rsbuild, next) as RspackProvidePlugin[]
    expect(out).toHaveLength(1)
    expect(out[0].definitions).toEqual({ Buffer: ['buffer', 'Buffer'] })
  })

  it('removes the Next plugin entirely when every key is covered', () => {
    const rsbuild = [
      new RspackProvidePlugin({ process: '/abs/process', Buffer: '/abs/buf' }),
    ]
    const next = [
      new RspackProvidePlugin({
        process: ['process'],
        Buffer: ['buffer', 'Buffer'],
      }),
    ]
    const out = dedupProvidePluginKeys(rsbuild, next)
    expect(out).toEqual([])
  })

  it('keeps the original instance untouched when no keys overlap', () => {
    const rsbuild = [new RspackProvidePlugin({ process: '/abs/process' })]
    const nextPlugin = new RspackProvidePlugin({
      Buffer: ['buffer', 'Buffer'],
    })
    const out = dedupProvidePluginKeys(rsbuild, [nextPlugin])
    expect(out).toEqual([nextPlugin])
    expect(out[0]).toBe(nextPlugin)
  })

  it('passes non-ProvidePlugin entries through unchanged', () => {
    const rsbuild = [new RspackProvidePlugin({ process: '/abs/process' })]
    const other = new OtherPlugin()
    const out = dedupProvidePluginKeys(rsbuild, [other])
    expect(out).toEqual([other])
  })

  it('handles undefined rsbuild plugins list', () => {
    const next = [new RspackProvidePlugin({ Buffer: ['buffer', 'Buffer'] })]
    const out = dedupProvidePluginKeys(undefined, next) as RspackProvidePlugin[]
    expect(out[0].definitions).toEqual({ Buffer: ['buffer', 'Buffer'] })
  })
})

describe('dedupProvidePluginKeys (F14 unreadable-shape hardening)', () => {
  // Named ProvidePlugin but with neither `.definitions` nor `_args` → the
  // internal-shape read fails, mirroring a future rspack wrapper change.
  class ProvidePlugin {}
  // rspack-style wrapper that stashes ALL ctor args (not just the first).
  class RspackProvidePlugin {
    public _args: any[]
    constructor(...args: any[]) {
      this._args = args
    }
  }

  it('fires onUnreadable("rsbuild") and skips dedup when rsbuild plugin is unreadable', () => {
    const calls: Array<{ side: string }> = []
    const nextPlugin = new RspackProvidePlugin({ Buffer: ['buffer', 'Buffer'] })
    const out = dedupProvidePluginKeys(
      [new ProvidePlugin()],
      [nextPlugin],
      (_p, side) => calls.push({ side }),
    )
    expect(calls).toEqual([{ side: 'rsbuild' }])
    // Dedup skipped → next plugin forwarded intact.
    expect(out).toEqual([nextPlugin])
  })

  it('fires onUnreadable("next") and forwards the plugin when next plugin is unreadable', () => {
    const calls: Array<{ side: string }> = []
    const nextPlugin = new ProvidePlugin()
    const out = dedupProvidePluginKeys(
      [new RspackProvidePlugin({ process: '/abs/process' })],
      [nextPlugin],
      (_p, side) => calls.push({ side }),
    )
    expect(calls).toEqual([{ side: 'next' }])
    expect(out).toEqual([nextPlugin])
  })

  it('preserves trailing constructor args when reconstructing', () => {
    const rsbuild = [new RspackProvidePlugin({ process: '/abs/process' })]
    const next = [
      new RspackProvidePlugin(
        { process: ['process'], Buffer: ['buffer', 'Buffer'] },
        'trailing-arg',
      ),
    ]
    const out = dedupProvidePluginKeys(rsbuild, next) as RspackProvidePlugin[]
    expect(out).toHaveLength(1)
    // process dropped (rsbuild provides it), Buffer kept, trailing arg carried.
    expect(out[0]._args).toEqual([
      { Buffer: ['buffer', 'Buffer'] },
      'trailing-arg',
    ])
  })
})

describe('_args[0] plugin-definitions contract (real rspack plugins)', () => {
  // Contract pin (F11-adjacent): `readProvidedMap` / `dedupProvidePluginKeys`
  // read rspack's INTERNAL `._args[0]` — there is no public getter. The other
  // suites hand-build fixtures; this one constructs REAL plugins so a future
  // rspack wrapper-shape change flips from a silent runtime warn in user
  // projects into red CI on the rspack-bump PR. Bare `@rspack/core` does not
  // resolve under pnpm strict linking — go through `@rsbuild/core`'s `rspack`.

  it('round-trips a real DefinePlugin definitions map through readProvidedMap', () => {
    const defines = {
      'process.env.NODE_ENV': JSON.stringify('production'),
      __NEXT_TEST: JSON.stringify(true),
    }
    expect(readProvidedMap(new rspack.DefinePlugin(defines))).toEqual(defines)
  })

  it('round-trips a real ProvidePlugin definitions map through readProvidedMap', () => {
    const provided = { Buffer: ['buffer', 'Buffer'], process: ['process'] }
    expect(readProvidedMap(new rspack.ProvidePlugin(provided))).toEqual(
      provided,
    )
  })

  it('dedupProvidePluginKeys drops overlapping keys across real ProvidePlugins', () => {
    const rsbuild = [new rspack.ProvidePlugin({ process: '/abs/process' })]
    const next = [
      new rspack.ProvidePlugin({
        Buffer: ['buffer', 'Buffer'],
        process: ['process'],
      }),
    ]
    const out = dedupProvidePluginKeys(rsbuild, next)
    expect(out).toHaveLength(1)
    // `process` dropped (rsbuild provides it), `Buffer` survives.
    expect(readProvidedMap(out[0])).toEqual({ Buffer: ['buffer', 'Buffer'] })
  })

  it('dedupProvidePluginKeys removes a real ProvidePlugin when every key is covered', () => {
    const rsbuild = [
      new rspack.ProvidePlugin({ process: '/abs/process', Buffer: '/abs/buf' }),
    ]
    const next = [
      new rspack.ProvidePlugin({
        process: ['process'],
        Buffer: ['buffer', 'Buffer'],
      }),
    ]
    expect(dedupProvidePluginKeys(rsbuild, next)).toEqual([])
  })
})

describe('partitionDefinePlugins (WI-9e drop-log truthfulness)', () => {
  // The defines harvest reads ALL DefinePlugins wholesale into `source.define`,
  // so a user next.config.webpack() DefinePlugin is ALREADY bridged. The
  // partition keeps preset.ts from (a) claiming it was "dropped" and (b)
  // re-pushing it under the gate, which would double-apply the definitions.

  it('splits real DefinePlugin instances from the rest', () => {
    const define = new rspack.DefinePlugin({ __FLAG: JSON.stringify(true) })
    const provide = new rspack.ProvidePlugin({ Buffer: ['buffer', 'Buffer'] })
    const { definePlugins, rest } = partitionDefinePlugins([define, provide])
    expect(definePlugins).toEqual([define])
    expect(rest).toEqual([provide])
  })

  it('matches DefinePlugin and RspackDefinePlugin by constructor name', () => {
    class DefinePlugin {}
    class RspackDefinePlugin {}
    class SomeOtherPlugin {}
    const a = new DefinePlugin()
    const b = new RspackDefinePlugin()
    const c = new SomeOtherPlugin()
    const { definePlugins, rest } = partitionDefinePlugins([a, b, c])
    expect(definePlugins).toEqual([a, b])
    expect(rest).toEqual([c])
  })

  it('preserves order and buckets everything else as rest', () => {
    class DefinePlugin {}
    const d1 = new DefinePlugin()
    const other = { constructor: { name: 'CopyPlugin' } }
    const bare = null
    const { definePlugins, rest } = partitionDefinePlugins([other, d1, bare])
    expect(definePlugins).toEqual([d1])
    expect(rest).toEqual([other, bare])
  })
})

describe('filterNextPlugins', () => {
  class CssExtractRspackPlugin {}
  class ReactRefreshRspackPlugin {}
  class BuildManifestPlugin {}
  class NextExternalsPlugin {}

  it('keeps only the allowlisted plugins', () => {
    const css = new CssExtractRspackPlugin()
    const refresh = new ReactRefreshRspackPlugin()
    const plugins = [
      new BuildManifestPlugin(),
      css,
      new NextExternalsPlugin(),
      refresh,
      null,
      undefined,
      { something: true },
    ]
    expect(filterNextPlugins(plugins as any[])).toEqual([css, refresh])
  })

  it('returns [] when no allowlisted plugins are present', () => {
    const plugins = [new BuildManifestPlugin(), new NextExternalsPlugin()]
    expect(filterNextPlugins(plugins as any[])).toEqual([])
  })

  it('keeps ReactRefreshRspackPlugin when present (dev rawPlugins)', () => {
    // Mode is handled at extraction time: prod runs `getBaseWebpackConfig({
    // dev:false })`, so this plugin is simply absent from prod rawPlugins —
    // the allowlist no longer needs an explicit prod gate.
    const css = new CssExtractRspackPlugin()
    const refresh = new ReactRefreshRspackPlugin()
    expect(filterNextPlugins([css, refresh] as any[])).toEqual([css, refresh])
  })
})

describe('buildNextLoaderChain', () => {
  const SHIM = '/shim/swc-loader-shim.cjs'

  it('returns null when no rule carries next-swc-loader at all', () => {
    const rules = [
      {
        test: /\.tsx?$/,
        use: [{ loader: 'css-loader' }],
      },
    ]
    expect(buildNextLoaderChain(rules, SHIM)).toBeNull()
  })

  it('falls back to a refresh-less next-swc-loader rule when none is paired', () => {
    // When no rule pairs `builtin:react-refresh-loader` (e.g. prod extraction,
    // or a stripped-down config), a lone `next-swc-loader` rule still maps to
    // the shim. This is the fallback tier — not the preferred dev path.
    const swcOpts = { isServer: false }
    const rules = [
      {
        test: /\.tsx?$/,
        use: [{ loader: 'next-swc-loader', options: swcOpts }],
      },
    ]
    const chain = buildNextLoaderChain(rules, SHIM)
    expect(chain).toEqual([{ loader: SHIM, options: swcOpts }])
  })

  it('prefers the refresh-paired client rule over an earlier refresh-less rule', () => {
    // Real bug: Next.js emits the `issuerLayer: 'api-node'` rule (next-swc
    // alone, no flight) BEFORE the client rule that pairs
    // `builtin:react-refresh-loader`. First-match-wins served stories without
    // the Fast Refresh footer, so edits remounted the component and lost React
    // state. The selector must reach the refresh-paired rule.
    const clientOpts = { isServer: false, hasReactRefresh: true }
    const rules = [
      {
        issuerLayer: 'api-node',
        test: /\.tsx?$/,
        use: [{ loader: 'next-swc-loader', options: { isServer: false } }],
      },
      {
        test: /\.tsx?$/,
        use: [
          { loader: 'builtin:react-refresh-loader' },
          { loader: 'next-swc-loader', options: clientOpts },
        ],
      },
    ]
    const chain = buildNextLoaderChain(rules, SHIM)
    expect(chain).toEqual([
      { loader: 'builtin:react-refresh-loader' },
      { loader: SHIM, options: clientOpts },
    ])
  })

  it('selects the refresh-paired rule regardless of order (not first-match)', () => {
    // Mirror of the api-node case with the order flipped: the refresh-paired
    // rule comes FIRST. It must still win — selection buckets rules by
    // capability, it is not order-dependent.
    const clientOpts = { isServer: false, hasReactRefresh: true }
    const rules = [
      {
        test: /\.tsx?$/,
        use: [
          { loader: 'builtin:react-refresh-loader' },
          { loader: 'next-swc-loader', options: clientOpts },
        ],
      },
      {
        issuerLayer: 'api-node',
        test: /\.tsx?$/,
        use: [{ loader: 'next-swc-loader', options: { isServer: false } }],
      },
    ]
    const chain = buildNextLoaderChain(rules, SHIM)
    expect(chain).toEqual([
      { loader: 'builtin:react-refresh-loader' },
      { loader: SHIM, options: clientOpts },
    ])
  })

  it('never selects a flight-paired rule even when it also carries refresh', () => {
    // App Router emits an SSR rule pairing `builtin:react-refresh-loader` WITH
    // `next-flight-loader`. The flight guard runs before refresh classification
    // so that rule is skipped for the refresh-only client rule — selecting the
    // flight one would compile client stories down the RSC path.
    const clientOpts = { isServer: false, hasReactRefresh: true }
    const rules = [
      {
        test: /\.tsx?$/,
        use: [
          { loader: 'builtin:react-refresh-loader' },
          { loader: 'next-flight-loader' },
          { loader: 'next-swc-loader', options: { isServer: true } },
        ],
      },
      {
        test: /\.tsx?$/,
        use: [
          { loader: 'builtin:react-refresh-loader' },
          { loader: 'next-swc-loader', options: clientOpts },
        ],
      },
    ]
    const chain = buildNextLoaderChain(rules, SHIM)
    expect(chain).toEqual([
      { loader: 'builtin:react-refresh-loader' },
      { loader: SHIM, options: clientOpts },
    ])
  })

  it('prefers the plain client rule over flight-paired variants', () => {
    const swcOpts = { isServer: false }
    const rules = [
      {
        test: /\.tsx?$/,
        use: [
          { loader: 'next-flight-loader' },
          { loader: 'next-swc-loader', options: { isServer: true } },
        ],
      },
      {
        test: /\.tsx?$/,
        use: [{ loader: 'next-swc-loader', options: swcOpts }],
      },
    ]
    const chain = buildNextLoaderChain(rules, SHIM)
    expect(chain).toEqual([{ loader: SHIM, options: swcOpts }])
  })

  it('swaps next-swc-loader for the shim and drops next-flight-* loaders', () => {
    const swcOpts = { isServer: false }
    const refresh = { loader: 'builtin:react-refresh-loader' }
    const rules = [
      {
        test: /\.tsx?$/,
        use: [
          refresh,
          { loader: 'next-flight-client-entry-loader' },
          { loader: 'next-swc-loader', options: swcOpts },
        ],
      },
    ]

    const chain = buildNextLoaderChain(rules, SHIM)
    expect(chain).toEqual([refresh, { loader: SHIM, options: swcOpts }])
  })

  it('matches even when rules are nested via oneOf', () => {
    const swcOpts = { isServer: false }
    const rules = [
      {
        oneOf: [
          {
            test: /\.tsx?$/,
            use: [
              { loader: 'builtin:react-refresh-loader' },
              { loader: 'next-swc-loader', options: swcOpts },
            ],
          },
        ],
      },
    ]
    const chain = buildNextLoaderChain(rules, SHIM)
    expect(chain).not.toBeNull()
    expect(chain![1]).toEqual({ loader: SHIM, options: swcOpts })
  })

  it('handles loader entries specified as bare strings', () => {
    const rules = [
      {
        use: ['builtin:react-refresh-loader', 'next-swc-loader'],
      },
    ]
    const chain = buildNextLoaderChain(rules, SHIM)
    expect(chain).toEqual([
      'builtin:react-refresh-loader',
      { loader: SHIM, options: {} },
    ])
  })

  it('preserves Next.js swc options verbatim (mode set at extraction)', () => {
    // In prod we extract with `dev:false`, so Next.js already emits
    // `dev:false, hasReactRefresh:false` and omits the refresh loader. The
    // chain builder passes those options straight through — no post-hoc edits.
    const prodSwcOpts = { isServer: false, dev: false, hasReactRefresh: false }
    const rules = [
      {
        test: /\.tsx?$/,
        use: [{ loader: 'next-swc-loader', options: prodSwcOpts }],
      },
    ]
    const chain = buildNextLoaderChain(rules, SHIM)
    expect(chain).toEqual([{ loader: SHIM, options: prodSwcOpts }])
  })
})

describe('SWC rule selection against real Next.js oneOf order (WI-4)', () => {
  const SHIM = '/shim/swc-loader-shim.cjs'

  // Transcribed from a REAL production extraction — `getBaseWebpackConfig({
  // dev: false })` against `sandboxes/nextjs` (next@16.2.9, next-rspack). The
  // SWC-bearing rules are reproduced in emitted order with their `issuerLayer` /
  // `resourceQuery` narrowing and their `serverComponents` swc option; only the
  // pages catch-all (last) has neither a layer nor a query. First-match-wins
  // would pick the leading `api-node` rule (`serverComponents: false`), so the
  // `bare` tier is what reaches Next.js's real client rule.
  const swc = (serverComponents: boolean) => ({
    loader: 'next-swc-loader',
    options: { isServer: serverComponents, serverComponents },
  })
  const buildProdRules = () => [
    { issuerLayer: 'api-node', test: /\.(tsx|ts|js)$/, use: [swc(false)] },
    { issuerLayer: 'api-edge', test: /\.(tsx|ts|js)$/, use: [swc(false)] },
    {
      issuerLayer: 'middleware',
      test: /\.(tsx|ts|js)$/,
      use: [{ loader: 'next-flight-loader' }, swc(true)],
    },
    {
      issuerLayer: 'instrument',
      test: /\.(tsx|ts|js)$/,
      use: [{ loader: 'next-flight-loader' }, swc(true)],
    },
    // Real config emits a function-valued issuerLayer here; a function is
    // non-null, so this rule lands in the `plain` bucket, not `bare`.
    { issuerLayer: () => true, test: /\.(tsx|ts|js)$/, use: [swc(true)] },
    {
      resourceQuery: /__next_edge_ssr_entry__/,
      test: /\.(tsx|ts|js)$/,
      use: [swc(true)],
    },
    {
      issuerLayer: 'app-pages-browser',
      test: /\.(tsx|ts|js)$/,
      use: [{ loader: 'next-flight-client-module-loader' }, swc(true)],
    },
    {
      issuerLayer: 'ssr',
      test: /\.(tsx|ts|js)$/,
      use: [{ loader: 'next-flight-client-module-loader' }, swc(true)],
    },
    // The pages catch-all: no issuerLayer, no resourceQuery. This is the client
    // target the `bare` tier must reach.
    { test: /\.(tsx|ts|js)$/, use: [swc(true)] },
  ]

  it('prod: selects the bare pages catch-all, not the leading api-node rule', () => {
    const rules = buildProdRules()
    const { tier, clientIssuerLayer } = analyzeNextLoaderChain(rules)
    expect(tier).toBe('bare')
    expect(clientIssuerLayer).toBeNull()

    // The shim inherits the selected rule's swc options — the catch-all is
    // `serverComponents: true`, NOT the api-node rule's `false`.
    const chain = buildNextLoaderChain(rules, SHIM)
    const selected = chain?.find((u) => u?.loader === SHIM)
    expect(selected?.options?.serverComponents).not.toBe(false)
    expect(selected?.options?.serverComponents).toBe(true)
  })

  it('dev: selects the refresh-paired client rule (same criterion, different tier)', () => {
    // Dev extraction emits the same server rules PLUS the client rule paired
    // with `builtin:react-refresh-loader` (the Fast Refresh footer carrier).
    const rules = buildProdRules()
    const clientOpts = { isServer: false, serverComponents: true }
    rules.push({
      test: /\.(tsx|ts|js)$/,
      use: [
        { loader: 'builtin:react-refresh-loader' },
        { loader: 'next-swc-loader', options: clientOpts },
      ],
    } as any)
    const { tier } = analyzeNextLoaderChain(rules)
    expect(tier).toBe('refresh')

    const chain = buildNextLoaderChain(rules, SHIM)
    expect(chain).toEqual([
      { loader: 'builtin:react-refresh-loader' },
      { loader: SHIM, options: clientOpts },
    ])
  })
})

describe('isNextSwcLoaderName (separator-agnostic matcher)', () => {
  it('matches bare and both-separator paths', () => {
    expect(isNextSwcLoaderName('next-swc-loader')).toBe(true)
    expect(isNextSwcLoaderName('/abs/loaders/next-swc-loader')).toBe(true)
    expect(isNextSwcLoaderName('C:\\abs\\loaders\\next-swc-loader')).toBe(true)
  })

  it('does NOT match builtin:next-swc-loader or unrelated names', () => {
    // The builtin variant has a different options schema and panics on standard
    // @rspack/core — it must be detected separately, not shimmed as a match.
    expect(isNextSwcLoaderName('builtin:next-swc-loader')).toBe(false)
    expect(isNextSwcLoaderName('next-swc-loader-extra')).toBe(false)
    expect(isNextSwcLoaderName('my-next-swc-loader-x')).toBe(false)
    expect(isNextSwcLoaderName(null)).toBe(false)
    expect(isNextSwcLoaderName(undefined)).toBe(false)
  })
})

describe('buildNextLoaderChain (F3 hardening)', () => {
  const SHIM = '/shim/swc-loader-shim.cjs'

  it('builds the chain from a backslash (Windows) next-swc-loader path', () => {
    const swcOpts = { isServer: false }
    const rules = [
      {
        test: /\.tsx?$/,
        use: [
          { loader: 'builtin:react-refresh-loader' },
          { loader: 'C:\\proj\\loaders\\next-swc-loader', options: swcOpts },
        ],
      },
    ]
    expect(buildNextLoaderChain(rules, SHIM)).toEqual([
      { loader: 'builtin:react-refresh-loader' },
      { loader: SHIM, options: swcOpts },
    ])
  })

  it('returns null when only builtin:next-swc-loader is present (unshimmable)', () => {
    const rules = [
      {
        test: /\.tsx?$/,
        use: [{ loader: 'builtin:next-swc-loader', options: {} }],
      },
    ]
    expect(buildNextLoaderChain(rules, SHIM)).toBeNull()
  })
})

describe('analyzeNextLoaderChain (tier + builtin diagnostics)', () => {
  it('reports the refresh tier for a refresh-paired dev rule', () => {
    const rules = [
      {
        test: /\.tsx?$/,
        use: [
          { loader: 'builtin:react-refresh-loader' },
          { loader: 'next-swc-loader', options: {} },
        ],
      },
    ]
    expect(analyzeNextLoaderChain(rules)).toEqual({
      tier: 'refresh',
      clientIssuerLayer: null,
      sawBuiltinSwcLoader: false,
    })
  })

  it('reports the bare tier for a layer-less non-flight rule (prod catch-all)', () => {
    // A non-flight rule with neither issuerLayer nor resourceQuery is Next.js's
    // pages catch-all — the prod client target. Even with the refresh loader
    // renamed away, it classifies as `bare`, not `plain`.
    const rules = [
      {
        test: /\.tsx?$/,
        use: [
          { loader: 'builtin:react-refresh' },
          { loader: 'next-swc-loader', options: {} },
        ],
      },
    ]
    expect(analyzeNextLoaderChain(rules)).toEqual({
      tier: 'bare',
      clientIssuerLayer: null,
      sawBuiltinSwcLoader: false,
    })
  })

  it('reports the plain tier + issuerLayer for a layered non-flight rule', () => {
    // A non-flight rule scoped by issuerLayer (e.g. `api-node`) is a degraded
    // fallback: it compiles on a server layer. `clientIssuerLayer` surfaces the
    // layer name so preset.ts can name it in the prod-degradation warning.
    const rules = [
      {
        issuerLayer: 'api-node',
        test: /\.tsx?$/,
        use: [
          { loader: 'next-swc-loader', options: { serverComponents: false } },
        ],
      },
    ]
    expect(analyzeNextLoaderChain(rules)).toEqual({
      tier: 'plain',
      clientIssuerLayer: 'api-node',
      sawBuiltinSwcLoader: false,
    })
  })

  it('reports null tier + sawBuiltinSwcLoader for a builtin-only ruleset', () => {
    const rules = [
      {
        test: /\.tsx?$/,
        use: [{ loader: 'builtin:next-swc-loader' }],
      },
    ]
    expect(analyzeNextLoaderChain(rules)).toEqual({
      tier: null,
      clientIssuerLayer: null,
      sawBuiltinSwcLoader: true,
    })
  })

  it('reports the any tier for a flight-only rule (prod-ish extraction)', () => {
    const rules = [
      {
        test: /\.tsx?$/,
        use: [
          { loader: 'next-flight-loader' },
          { loader: 'next-swc-loader', options: {} },
        ],
      },
    ]
    expect(analyzeNextLoaderChain(rules)).toEqual({
      tier: 'any',
      clientIssuerLayer: null,
      sawBuiltinSwcLoader: false,
    })
  })
})

describe('replaceSwcRules', () => {
  it('replaces every builtin:swc-loader occurrence with the Next.js chain', () => {
    const chain = [{ loader: '/shim.cjs', options: { a: 1 } }]
    const rules = [
      {
        test: /\.jsx?$/,
        use: [{ loader: 'builtin:swc-loader', options: { drop: true } }],
      },
      {
        oneOf: [
          {
            use: [{ loader: 'builtin:swc-loader', options: {} }],
          },
          {
            use: [{ loader: 'asset/resource' }],
          },
        ],
      },
    ]

    const replaced = replaceSwcRules(rules, chain)

    expect(replaced).toBe(true)
    expect(rules[0].use).toEqual(chain)
    expect(rules[1].oneOf![0].use).toEqual(chain)
    // Non-matching rules stay untouched
    expect(rules[1].oneOf![1].use).toEqual([{ loader: 'asset/resource' }])
  })

  it('returns false when no builtin:swc-loader is present', () => {
    const rules = [
      { use: [{ loader: 'next-swc-loader' }] },
      { use: [{ loader: 'asset/resource' }] },
    ]
    expect(replaceSwcRules(rules, [{ loader: '/shim.cjs' }])).toBe(false)
  })

  // streamshub/console (Next 15) regression: Rsbuild's `mimetype` rule for
  // inline text/javascript also matches html-rspack-plugin's synthetic
  // `data:…__webpack_public_path__…` child-compiler entry, which is evaluated
  // in a Node `vm`. Keeping `builtin:react-refresh-loader` there crashes
  // `storybook dev` (no `__webpack_require__.c` in that runtime). Mimetype rules
  // must get a refresh-less chain; real file `test` rules keep the footer.
  it('strips react-refresh-loader from mimetype and scheme (inline/data:) rules only', () => {
    const chain = [
      { loader: 'builtin:react-refresh-loader' },
      { loader: '/shim.cjs', options: { a: 1 } },
    ]
    const rules = [
      {
        test: /\.(?:js|jsx|ts|tsx)$/,
        use: [{ loader: 'builtin:swc-loader' }],
      },
      {
        mimetype: { or: ['text/javascript', 'application/javascript'] },
        use: [{ loader: 'builtin:swc-loader' }],
      },
      {
        // The sibling `scheme: 'data'` rule targets inline `data:` JS by URI
        // scheme; it carries no file `test` and must be stripped like mimetype.
        scheme: 'data',
        use: [{ loader: 'builtin:swc-loader' }],
      },
    ]

    const replaced = replaceSwcRules(rules, chain)

    expect(replaced).toBe(true)
    // File `test` rule keeps the Fast Refresh footer.
    expect(rules[0].use).toEqual(chain)
    // Mimetype rule drops only the refresh loader, keeps the swc shim.
    expect(rules[1].use).toEqual([{ loader: '/shim.cjs', options: { a: 1 } }])
    // Scheme rule likewise drops the refresh loader, keeps the swc shim.
    expect(rules[2].use).toEqual([{ loader: '/shim.cjs', options: { a: 1 } }])
  })
})

// Regression-target units distilled from the community gauntlet (see AGENTS.md
// Shim Catalogue). These lock the CSS-URL passthrough that broke safe-wallet,
// the fallback precedence that keeps Victory/stream libs working (console/oak),
// the next/font + barrel rule shapes, and the svgr dedup signature.

describe('isRuntimeCssUrl (css-loader url/import passthrough)', () => {
  it('flags root-absolute and scheme-absolute URLs as runtime (safe-wallet /images, /fonts)', () => {
    for (const u of [
      '/images/logo.svg',
      '/fonts/fonts.css',
      'https://cdn/x.css',
      'data:image/svg+xml,%3Csvg%3E%3C/svg%3E',
    ]) {
      expect(isRuntimeCssUrl(u)).toBe(true)
    }
  })

  it('covers protocol-relative and bare schemes (transit data:, proposalsapp @import)', () => {
    expect(isRuntimeCssUrl('//cdn/x.css')).toBe(true) // leading-slash branch
    expect(isRuntimeCssUrl('http://x/y.woff2')).toBe(true)
  })

  it('lets relative paths resolve as modules', () => {
    for (const u of ['./a.png', '../b.svg', 'img.png', 'fonts/x.woff2']) {
      expect(isRuntimeCssUrl(u)).toBe(false)
    }
  })
})

describe('withRuntimeUrlFilter', () => {
  it('merges a passthrough filter, preserving an existing object option', () => {
    const out = withRuntimeUrlFilter({ keepImport: true }) as any
    expect(out.keepImport).toBe(true)
    expect(out.filter('/x.png')).toBe(false) // runtime URL → skipped
    expect(out.filter('./x.png')).toBe(true) // relative → resolved
  })

  it('replaces a boolean/undefined option wholesale', () => {
    expect(typeof withRuntimeUrlFilter(true).filter).toBe('function')
    expect(typeof withRuntimeUrlFilter(undefined).filter).toBe('function')
  })

  it('rejects an external @import target (same filter feeds url and import)', () => {
    expect(
      withRuntimeUrlFilter(undefined).filter('https://cdn/styles.css'),
    ).toBe(false)
  })
})

describe('TARGET_CSS_RE (next/font synthetic module)', () => {
  it('matches synthetic next/font target.css on both separators', () => {
    expect(TARGET_CSS_RE.test('node_modules/next/font/google/target.css')).toBe(
      true,
    )
    expect(
      TARGET_CSS_RE.test('node_modules\\next\\font\\local\\target.css'),
    ).toBe(true)
  })

  it('matches the @next/font variant and pnpm store paths', () => {
    expect(
      TARGET_CSS_RE.test('node_modules/@next/font/google/target.css'),
    ).toBe(true)
    expect(
      TARGET_CSS_RE.test(
        'node_modules/.pnpm/next@16.2.9_react@19.0.0/node_modules/next/font/local/target.css',
      ),
    ).toBe(true)
  })

  it('does not match ordinary css', () => {
    expect(TARGET_CSS_RE.test('src/app/globals.css')).toBe(false)
    expect(TARGET_CSS_RE.test('src/Other.module.css')).toBe(false)
  })

  it('does not false-positive on user target.css under a dir named next (F12)', () => {
    // A project rooted at /…/next/ or a src/mynext/ folder previously matched
    // the looser upstream regex and got wrongly routed to the font loader.
    expect(TARGET_CSS_RE.test('src/mynext/theme/target.css')).toBe(false)
    expect(
      TARGET_CSS_RE.test('/Users/x/projects/next/src/styles/target.css'),
    ).toBe(false)
    expect(TARGET_CSS_RE.test('src/target.css')).toBe(false)
    // `next/fonts` (plural) is not the synthetic `next/font` segment.
    expect(TARGET_CSS_RE.test('node_modules/next/fonts/x/target.css')).toBe(
      false,
    )
  })
})

describe('makeFontRule', () => {
  it('routes target.css to the font loader as a JS module', () => {
    expect(makeFontRule('/loaders/font.cjs')).toEqual({
      test: TARGET_CSS_RE,
      loader: '/loaders/font.cjs',
      type: 'javascript/auto',
    })
  })
})

describe('makeBarrelRule (__barrel_optimize__ → SWC chain)', () => {
  const chain = [{ loader: '/shim.cjs', options: { isServer: false } }]

  it('routes the __barrel_optimize__ matchResource through the SWC chain (safe-wallet @mui)', () => {
    const rule = makeBarrelRule(chain)!
    expect(
      rule.test.test('__barrel_optimize__?names=Button!=!@mui/material'),
    ).toBe(true)
    expect(rule.use).toBe(chain)
  })

  it('does not match ordinary module paths', () => {
    expect(makeBarrelRule(chain)!.test.test('src/App.tsx')).toBe(false)
  })

  it('is null when there is no Next.js loader chain', () => {
    expect(makeBarrelRule(null)).toBeNull()
  })
})

describe('mergeFallback (resolve.fallback precedence)', () => {
  it('lets Next.js polyfills win over Rsbuild stream=false (console victory / oak stream-http)', () => {
    const out = mergeFallback(
      { stream: false, fs: false, assert: false },
      { stream: false, fs: false },
      { stream: '/poly/stream-browserify', util: '/poly/util' },
      {},
    )
    expect(out.stream).toBe('/poly/stream-browserify')
    expect(out.util).toBe('/poly/util')
    expect(out.fs).toBe(false) // Next had no opinion → stays false
  })

  it('preserves a non-false Rsbuild/user-tools entry over a Next polyfill', () => {
    const out = mergeFallback(
      { stream: false },
      { stream: '/rsbuild/stream' }, // explicit intent, not "no opinion"
      { stream: '/poly/stream-browserify' },
      {},
    )
    expect(out.stream).toBe('/rsbuild/stream')
  })

  it('gives the next.config.webpack delta the final word', () => {
    const out = mergeFallback(
      { stream: false },
      { stream: false },
      { stream: '/poly/stream' },
      { stream: false }, // user explicitly stubs it out
    )
    expect(out.stream).toBe(false)
  })

  it('floor maps every Node builtin to false', () => {
    expect(NODE_BUILTINS_FALLBACK.querystring).toBe(false)
    expect(NODE_BUILTINS_FALLBACK.punycode).toBe(false)
    expect(NODE_BUILTINS_FALLBACK.stream).toBe(false)
  })

  it('keeps the floor bare-only — node: scheme is normalized by the strip plugin', () => {
    // The fallback floor must NOT carry `node:`-prefixed keys: rspack resolves
    // the `node:` scheme before consulting resolve.fallback, so such a key is
    // dead. resolveNodeProtocolRequest strips the scheme to land on the bare key.
    expect(NODE_BUILTINS_FALLBACK['node:path']).toBeUndefined()
    expect(NODE_BUILTINS_FALLBACK.path).toBe(false)
  })
})

describe('resolveNodeProtocolRequest (node: scheme handling)', () => {
  const EMPTY = '/abs/empty-module.cjs'

  it('strips node: from a builtin so it lands on the bare fallback floor', () => {
    expect(resolveNodeProtocolRequest('node:path', EMPTY)).toBe('path')
    expect(resolveNodeProtocolRequest('node:fs', EMPTY)).toBe('fs')
  })

  it('strips node: from a subpath builtin (node:fs/promises)', () => {
    // builtinModules includes the `fs/promises` subpath on supported Node, so
    // it stays a bare specifier; if a Node lacks it, it falls to the shim — both
    // resolve to an empty module, never a build error.
    const out = resolveNodeProtocolRequest('node:fs/promises', EMPTY)
    expect(out === 'fs/promises' || out === EMPTY).toBe(true)
  })

  it('routes node:-only specifiers with no bare builtin to the empty shim', () => {
    // node:test / node:sqlite have no bare-name counterpart in builtinModules,
    // so plain stripping would surface "Can't resolve 'test'". They map to the
    // empty shim instead so a dead server-only import never breaks the build.
    expect(resolveNodeProtocolRequest('node:test', EMPTY)).toBe(EMPTY)
    expect(resolveNodeProtocolRequest('node:sqlite', EMPTY)).toBe(EMPTY)
  })

  it('leaves non-node: requests untouched', () => {
    expect(resolveNodeProtocolRequest('path', EMPTY)).toBe('path')
    expect(resolveNodeProtocolRequest('./local', EMPTY)).toBe('./local')
    expect(resolveNodeProtocolRequest('lodash', EMPTY)).toBe('lodash')
  })
})

describe('ruleTestSignature (svgr dedup — safe-wallet / oak)', () => {
  it('produces a stable signature for distinct RegExp instances with the same source', () => {
    expect(ruleTestSignature({ test: /\.svg$/ })).toBe('/\\.svg$/')
    expect(ruleTestSignature({ test: /\.svg$/ })).toBe(
      ruleTestSignature({ test: /\.svg$/ }),
    )
  })

  it('returns null for non-RegExp tests so {and:}/{or:} shapes never cross-match', () => {
    expect(ruleTestSignature({ test: { or: [/\.svg$/] } })).toBeNull()
    expect(ruleTestSignature({ test: 'string' })).toBeNull()
    expect(ruleTestSignature({ use: 'x' })).toBeNull()
    expect(ruleTestSignature(null)).toBeNull()
  })

  it('distinguishes .svg from .css so shared-extension rules are not dropped', () => {
    expect(ruleTestSignature({ test: /\.svg$/ })).not.toBe(
      ruleTestSignature({ test: /\.css$/ }),
    )
  })
})

describe('rulesCongruentForDedup (condition-aware dedup — F2)', () => {
  it('dedups bare-test vs bare-test with the same RegExp', () => {
    expect(rulesCongruentForDedup({ test: /\.svg$/ }, { test: /\.svg$/ })).toBe(
      true,
    )
  })

  it('keeps rules when one narrows via include and the other does not', () => {
    // Icons-scoped SVGR rule vs an unrelated raw-SVG rule must coexist.
    expect(
      rulesCongruentForDedup(
        { test: /\.svg$/, include: /src\/icons/ },
        { test: /\.svg$/ },
      ),
    ).toBe(false)
    expect(
      rulesCongruentForDedup(
        { test: /\.svg$/, resourceQuery: /raw/ },
        { test: /\.svg$/ },
      ),
    ).toBe(false)
  })

  it('dedups when both carry the identical narrowing condition', () => {
    expect(
      rulesCongruentForDedup(
        { test: /\.svg$/, include: /src\/icons/ },
        { test: /\.svg$/, include: /src\/icons/ },
      ),
    ).toBe(true)
  })

  it('compares array conditions element-wise', () => {
    expect(
      rulesCongruentForDedup(
        { test: /\.svg$/, exclude: [/a/, 'b'] },
        { test: /\.svg$/, exclude: [/a/, 'b'] },
      ),
    ).toBe(true)
    expect(
      rulesCongruentForDedup(
        { test: /\.svg$/, exclude: [/a/, 'b'] },
        { test: /\.svg$/, exclude: [/a/, 'c'] },
      ),
    ).toBe(false)
  })

  it('never dedups non-comparable conditions (functions / object matchers)', () => {
    expect(
      rulesCongruentForDedup(
        { test: /\.svg$/, issuer: () => true },
        { test: /\.svg$/, issuer: () => true },
      ),
    ).toBe(false)
    expect(
      rulesCongruentForDedup(
        { test: /\.svg$/, include: { and: [/a/] } },
        { test: /\.svg$/, include: { and: [/a/] } },
      ),
    ).toBe(false)
  })

  it('never dedups non-RegExp tests', () => {
    expect(rulesCongruentForDedup({ test: 'x' }, { test: 'x' })).toBe(false)
    expect(
      rulesCongruentForDedup({ test: { or: [/a/] } }, { test: { or: [/a/] } }),
    ).toBe(false)
  })

  it('keeps rules with differing enforce out of dedup (F12)', () => {
    // An `enforce: 'pre'` webpackFinal rule runs in a different loader phase than
    // a bare (normal-phase) next.config rule with the same test — dropping either
    // is wrong.
    expect(
      rulesCongruentForDedup(
        { test: /\.svg$/, enforce: 'pre' },
        { test: /\.svg$/ },
      ),
    ).toBe(false)
    expect(
      rulesCongruentForDedup(
        { test: /\.svg$/, enforce: 'pre' },
        { test: /\.svg$/, enforce: 'post' },
      ),
    ).toBe(false)
  })

  it('still dedups congruent rules with identical enforce', () => {
    expect(
      rulesCongruentForDedup(
        { test: /\.svg$/, enforce: 'pre' },
        { test: /\.svg$/, enforce: 'pre' },
      ),
    ).toBe(true)
  })
})

describe('ruleLoaderNames', () => {
  it('joins use-chain loader basenames with an arrow', () => {
    expect(
      ruleLoaderNames({
        use: [
          { loader: '/abs/path/to/next-swc-loader', options: {} },
          '@svgr/webpack',
        ],
      }),
    ).toBe('next-swc-loader → @svgr/webpack')
  })

  it('handles a single string / object use and missing loaders', () => {
    expect(ruleLoaderNames({ use: 'raw-loader' })).toBe('raw-loader')
    expect(ruleLoaderNames({ test: /\.svg$/ })).toBe('(no loaders)')
  })

  it('never throws on a function-shaped use', () => {
    expect(ruleLoaderNames({ use: () => [] })).toBe('<fn>')
  })
})

describe('rulesHandleSass (structural Sass probe — F7)', () => {
  it('detects a rule whose test matches .scss', () => {
    expect(rulesHandleSass([{ test: /\.s[ac]ss$/, use: [] }])).toBe(true)
  })

  it('detects sass-loader in string / object / array use forms', () => {
    expect(rulesHandleSass([{ test: /x/, use: 'sass-loader' }])).toBe(true)
    expect(
      rulesHandleSass([
        { test: /x/, use: { loader: '/p/sass-loader/index.js' } },
      ]),
    ).toBe(true)
    expect(
      rulesHandleSass([
        {
          test: /x/,
          use: [{ loader: 'css-loader' }, { loader: 'sass-loader' }],
        },
      ]),
    ).toBe(true)
    expect(rulesHandleSass([{ loader: 'sass-loader' }])).toBe(true)
  })

  it('recurses into oneOf and nested rules', () => {
    expect(
      rulesHandleSass([{ oneOf: [{ test: /y/, use: 'sass-loader' }] }]),
    ).toBe(true)
    expect(rulesHandleSass([{ rules: [{ test: /\.scss$/, use: [] }] }])).toBe(
      true,
    )
  })

  it('does NOT throw or match on a function-shaped use (F7 crash guard)', () => {
    // JSON.stringify(fn) is undefined → `.includes` used to throw. A function
    // use whose test does not match .scss must be treated as "not sass".
    const rules = [{ test: /\.svg$/, use: () => [{ loader: 'x' }] }]
    expect(() => rulesHandleSass(rules)).not.toThrow()
    expect(rulesHandleSass(rules)).toBe(false)
  })

  it('does NOT throw on circular loader options', () => {
    const circular: any = { loader: 'some-loader', options: {} }
    circular.options.self = circular.options
    expect(() =>
      rulesHandleSass([{ test: /\.js$/, use: [circular] }]),
    ).not.toThrow()
  })

  it('returns false for a non-array input', () => {
    expect(rulesHandleSass(undefined)).toBe(false)
    expect(rulesHandleSass(null)).toBe(false)
  })
})
