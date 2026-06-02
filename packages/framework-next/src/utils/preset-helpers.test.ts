import { describe, expect, it } from '@rstest/core'
import {
  buildNextLoaderChain,
  dedupProvidePluginKeys,
  filterNextAliases,
  filterNextPlugins,
  isRuntimeCssUrl,
  makeBarrelRule,
  makeFontRule,
  mergeFallback,
  NODE_BUILTINS_FALLBACK,
  readProvidedMap,
  replaceSwcRules,
  resolveNodeProtocolRequest,
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

  it('does not match ordinary css', () => {
    expect(TARGET_CSS_RE.test('src/app/globals.css')).toBe(false)
    expect(TARGET_CSS_RE.test('src/Other.module.css')).toBe(false)
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
