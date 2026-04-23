import { describe, expect, it } from '@rstest/core'
import {
  buildNextLoaderChain,
  filterNextAliases,
  filterNextPlugins,
  prepareNextCssRules,
  replaceSwcRules,
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

  it('drops dev-only plugins (ReactRefreshRspackPlugin) in production', () => {
    const css = new CssExtractRspackPlugin()
    const refresh = new ReactRefreshRspackPlugin()
    const plugins = [css, refresh]
    expect(filterNextPlugins(plugins as any[], { isDev: false })).toEqual([css])
  })
})

describe('buildNextLoaderChain', () => {
  const SHIM = '/shim/swc-loader-shim.cjs'

  it('returns null when no rule carries both react-refresh and next-swc loaders', () => {
    const rules = [
      {
        test: /\.tsx?$/,
        use: [{ loader: 'next-swc-loader', options: { isServer: false } }],
      },
    ]
    expect(buildNextLoaderChain(rules, SHIM)).toBeNull()
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

  it('drops react-refresh-loader and forces dev:false in production', () => {
    const swcOpts = { isServer: false, dev: true }
    const refresh = { loader: 'builtin:react-refresh-loader' }
    const rules = [
      {
        test: /\.tsx?$/,
        use: [refresh, { loader: 'next-swc-loader', options: swcOpts }],
      },
    ]
    const chain = buildNextLoaderChain(rules, SHIM, { isDev: false })
    expect(chain).toEqual([
      { loader: SHIM, options: { isServer: false, dev: false } },
    ])
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

describe('prepareNextCssRules', () => {
  const REWRITER = '/loaders/next-font-url-rewrite.cjs'

  it('extracts CSS rules identified by loader markers', () => {
    const cssRule = {
      test: /\.css$/,
      use: [{ loader: 'css-loader' }, { loader: 'postcss-loader' }],
    }
    const jsRule = { test: /\.jsx?$/, use: [{ loader: 'next-swc-loader' }] }

    const result = prepareNextCssRules([jsRule, cssRule], REWRITER)

    expect(result).toHaveLength(1)
    expect(result[0]).toBe(cssRule)
  })

  it('extracts via rule.test (scss/less/styl) even without loader markers', () => {
    const rules = [
      { test: /\.scss$/, use: [] },
      { test: /\.less$/, use: [] },
      { test: /\.styl$/, use: [] },
      { test: /\.ts$/, use: [] },
    ]
    const result = prepareNextCssRules(rules, REWRITER)
    expect(result).toHaveLength(3)
  })

  it('matches next/font target.css virtual files via CSS_TEST_RE', () => {
    const rule = { test: /target\.css$/, use: [] }
    const result = prepareNextCssRules([rule], REWRITER)
    expect(result).toContain(rule)
  })

  it('splices the font URL rewriter *before* next-font-loader so it runs after', () => {
    const fontLoader = { loader: 'next-font-loader', options: {} }
    const rule = {
      test: /target\.css$/,
      use: [{ loader: 'css-loader' }, fontLoader],
    }
    const [result] = prepareNextCssRules([rule], REWRITER)
    // Webpack loaders run right-to-left — splicing rewriter *before*
    // next-font-loader in the array means it runs *after*.
    expect(result.use.map((u: any) => u.loader)).toEqual([
      'css-loader',
      REWRITER,
      'next-font-loader',
    ])
  })

  it('splices the rewriter inside nested oneOf rules', () => {
    const rule = {
      test: /\.css$/,
      oneOf: [
        {
          test: /target\.css$/,
          use: [
            { loader: 'css-loader' },
            { loader: 'next-font-loader', options: {} },
          ],
        },
      ],
    }
    const [result] = prepareNextCssRules([rule], REWRITER)
    const inner = result.oneOf[0]
    expect(inner.use.map((u: any) => u.loader)).toEqual([
      'css-loader',
      REWRITER,
      'next-font-loader',
    ])
  })

  it('matches next-font-loader specified by absolute path', () => {
    const rule = {
      test: /\.css$/,
      use: [
        { loader: 'css-loader' },
        { loader: '/abs/path/to/next-font-loader', options: {} },
      ],
    }
    const [result] = prepareNextCssRules([rule], REWRITER)
    expect(result.use.map((u: any) => u.loader)).toEqual([
      'css-loader',
      REWRITER,
      '/abs/path/to/next-font-loader',
    ])
  })

  it('is a no-op on CSS rules that do not use next-font-loader', () => {
    const rule = {
      test: /\.css$/,
      use: [{ loader: 'css-loader' }, { loader: 'postcss-loader' }],
    }
    const [result] = prepareNextCssRules([rule], REWRITER)
    expect(result.use.map((u: any) => u.loader)).toEqual([
      'css-loader',
      'postcss-loader',
    ])
  })

  it('drops oneOf branches that contain Next.js error-loader', () => {
    const rule = {
      test: /\.css$/,
      oneOf: [
        {
          use: [
            {
              loader: '/abs/next/dist/build/webpack/loaders/error-loader',
              options: { reason: 'Global CSS cannot be imported...' },
            },
          ],
        },
        {
          test: /\.css$/,
          issuer: /pages\/_app\.js$/,
          use: [{ loader: 'css-loader' }, { loader: 'postcss-loader' }],
        },
      ],
    }
    const [result] = prepareNextCssRules([rule], REWRITER)
    expect(result.oneOf).toHaveLength(1)
    expect(result.oneOf[0].use[0].loader).toBe('css-loader')
  })

  it('strips issuer constraints from CSS rules so Storybook imports match', () => {
    const rule = {
      test: /\.css$/,
      issuer: /pages\/_app\.js$/,
      use: [{ loader: 'css-loader' }, { loader: 'postcss-loader' }],
    }
    const [result] = prepareNextCssRules([rule], REWRITER)
    expect(result.issuer).toBeUndefined()
  })

  it('strips issuer from CSS branches inside oneOf', () => {
    const rule = {
      test: /\.css$/,
      oneOf: [
        {
          test: /\.css$/,
          issuer: { not: /node_modules/ },
          use: [{ loader: 'css-loader' }],
        },
      ],
    }
    const [result] = prepareNextCssRules([rule], REWRITER)
    expect(result.oneOf[0].issuer).toBeUndefined()
  })

  it('drops non-CSS branches from a mixed oneOf so JS loaders do not run twice', () => {
    // Next.js's client rule wraps both JS branches (next-swc-loader,
    // next-flight-loader) and CSS branches under one oneOf. If we let the JS
    // branches through, TSX files get hit by next-swc-loader once via this
    // pulled-in rule and again via Storybook's swc rule, producing duplicate
    // `$RefreshSig$` declarations.
    const rule = {
      oneOf: [
        { test: /\.tsx?$/, use: [{ loader: 'next-swc-loader' }] },
        {
          test: /\.tsx?$/,
          use: [
            { loader: 'next-flight-loader' },
            { loader: 'next-swc-loader' },
          ],
        },
        {
          test: /\.tsx?$/,
          use: [
            { loader: 'builtin:react-refresh-loader' },
            { loader: 'next-swc-loader' },
          ],
        },
        {
          test: /\.module\.css$/,
          use: [
            { loader: 'next-style-loader' },
            { loader: 'css-loader' },
            { loader: 'postcss-loader' },
          ],
        },
        {
          test: /\.css$/,
          use: [{ loader: 'css-loader' }, { loader: 'postcss-loader' }],
        },
        // empty/unknown branch — neither CSS nor harmful, should still drop
        { test: /\.unknown$/ },
      ],
    }
    const [result] = prepareNextCssRules([rule], REWRITER)
    expect(result.oneOf).toHaveLength(2)
    expect(result.oneOf[0].use[0].loader).toBe('next-style-loader')
    expect(result.oneOf[1].use[0].loader).toBe('css-loader')
  })

  it('keeps __barrel_optimize__ branches but narrows their test off the file-extension OR', () => {
    // Next.js emits a JS branch whose test is `{ or: [/\.tsx?$/, '__barrel_optimize__'] }`
    // — the barrel arm is needed (Next rewrites MUI/lodash imports through
    // `__barrel_optimize__?names=…`), but the file-extension arm makes the branch
    // also catch regular TSX, which is what the duplicate `$RefreshSig$` came from.
    // Keep the branch, drop the extension arm.
    const rule = {
      oneOf: [
        {
          test: { or: [/\.(tsx|ts|js|cjs|mjs|jsx)$/, '__barrel_optimize__'] },
          use: [{ loader: 'next-swc-loader' }],
        },
        { test: /\.tsx?$/, use: [{ loader: 'next-swc-loader' }] },
        {
          test: /\.css$/,
          use: [{ loader: 'css-loader' }],
        },
      ],
    }
    const [result] = prepareNextCssRules([rule], REWRITER)
    // pure-JS branch dropped, barrel + CSS kept
    expect(result.oneOf).toHaveLength(2)
    expect(result.oneOf[0].use[0].loader).toBe('next-swc-loader')
    expect(result.oneOf[0].test).toBeInstanceOf(RegExp)
    expect((result.oneOf[0].test as RegExp).source).toBe('__barrel_optimize__')
    expect(result.oneOf[1].use[0].loader).toBe('css-loader')
  })
})
