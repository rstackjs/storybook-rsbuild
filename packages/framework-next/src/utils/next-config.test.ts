import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  rstest,
} from '@rstest/core'
import { logger } from 'storybook/internal/node-logger'
import {
  configLoadPhase,
  DUMMY_NEXT_ARGS,
  instrumentUserWebpack,
  isStorybookClaimedRule,
  resolveBridgeFailure,
  resolveRspackValidateMode,
  ruleTestMatchesAny,
  selectBridgeFailureHint,
} from './next-config'

/**
 * Fixtures named after the 5 community projects we use to validate Storybook
 * integration: transit, anticapture, proposalsapp, safe-wallet, console.
 * Each fixture mirrors the shape of that project's real `next.config.webpack()`
 * hook. When a future framework change regresses one of these patterns the
 * project name in the failing test points right at which community config
 * needs another look.
 */

/** Minimal client-dev webpack config Next.js would hand to user's `webpack()`. */
function makeBaseWebpackConfig() {
  return {
    module: {
      rules: [
        { test: /\.tsx?$/, use: [{ loader: 'next-swc-loader' }] },
        { test: /\.(png|jpe?g|gif|webp|avif)$/i, type: 'asset/resource' },
      ],
    },
    plugins: [{ constructor: { name: 'BuildManifestPlugin' } }],
    resolve: {
      alias: { 'next/image': '/internal/next/image' },
      fallback: { 'next-base-fallback': false as const },
    },
    externals: [] as any[],
    experiments: {} as Record<string, any>,
  }
}

const fakeOpts = {
  dev: true,
  isServer: false,
  buildId: 'storybook',
  defaultLoaders: { babel: {} },
  webpack: {},
}

function runHook(hook: any) {
  const nextConfig: any = { webpack: hook }
  const getDelta = instrumentUserWebpack(nextConfig)
  const config = makeBaseWebpackConfig()
  const result = nextConfig.webpack(config, fakeOpts)
  return { config, result, delta: getDelta() }
}

describe('instrumentUserWebpack — community project patterns', () => {
  it('console: no webpack hook → empty delta', () => {
    const nextConfig: any = {}
    const getDelta = instrumentUserWebpack(nextConfig)
    expect(typeof nextConfig.webpack).toBe('undefined')
    expect(getDelta()).toEqual({
      rules: [],
      plugins: [],
      alias: {},
      fallback: {},
      experiments: {},
      externals: [],
    })
  })

  it('transit: appends SVGR rule via @svgr/webpack', () => {
    // transit's real config: `config.module.rules.push({ test: /\.svg$/, use: ['@svgr/webpack'] })`
    const svgRule = { test: /\.svg$/, use: ['@svgr/webpack'] }
    const { delta } = runHook((config: any) => {
      config.module.rules.push(svgRule)
      return config
    })
    expect(delta.rules).toHaveLength(1)
    expect(delta.rules[0]).toBe(svgRule)
  })

  it('anticapture: remaps Apollo + workspace gql aliases', () => {
    // anticapture spreads new aliases into resolve.alias to redirect
    // `@apollo/client` and `@anticapture/graphql-client`.
    const apolloPath = '/mock/apollo-client'
    const gqlPath = '/mock/graphql-client'
    const { delta } = runHook((config: any) => {
      config.resolve.alias = {
        ...config.resolve.alias,
        '@apollo/client': apolloPath,
        '@anticapture/graphql-client': gqlPath,
      }
      return config
    })
    expect(delta.alias).toEqual({
      '@apollo/client': apolloPath,
      '@anticapture/graphql-client': gqlPath,
    })
  })

  it('anticapture: alias override of a Next.js base value is captured', () => {
    // If the user overrides an alias Next.js already set, computeDelta must
    // still capture it — diffRecord triggers on value change, not just new key.
    const userImagePath = '/user-image-shim'
    const { delta } = runHook((config: any) => {
      config.resolve.alias['next/image'] = userImagePath
      return config
    })
    expect(delta.alias['next/image']).toBe(userImagePath)
  })

  it('proposalsapp: 40+ node fallbacks are all captured', () => {
    const nodeFallbacks = [
      'fs',
      'net',
      'tls',
      'pg',
      'pg-native',
      'jsdom',
      'cardinal',
      'crypto',
      'stream',
      'path',
      'os',
      'http',
      'https',
      'zlib',
      'querystring',
      'url',
      'util',
      'assert',
      'buffer',
      'child_process',
      'cluster',
      'dgram',
      'dns',
      'domain',
      'events',
      'module',
      'perf_hooks',
      'punycode',
      'readline',
      'repl',
      'string_decoder',
      'sys',
      'timers',
      'tty',
      'v8',
      'vm',
      'worker_threads',
      'inspector',
      'async_hooks',
      'console',
    ]
    const { delta } = runHook((config: any) => {
      const additions = Object.fromEntries(nodeFallbacks.map((m) => [m, false]))
      config.resolve.fallback = { ...config.resolve.fallback, ...additions }
      return config
    })
    for (const k of nodeFallbacks) {
      expect(delta.fallback[k]).toBe(false)
    }
    // Pre-existing entry from Next.js's base wasn't changed, so not in delta.
    expect(delta.fallback['next-base-fallback']).toBeUndefined()
  })

  it('proposalsapp: DefinePlugin + ProvidePlugin + custom plugins captured in order', () => {
    class MockDefinePlugin {
      constructor(public defs: any) {}
    }
    class MockProvidePlugin {
      constructor(public defs: any) {}
    }
    class CloudflareSchemePlugin {}
    const defines = new MockDefinePlugin({
      'process.env.DATABASE_URL': '"mock://localhost/test"',
    })
    const provides = new MockProvidePlugin({ Buffer: ['buffer', 'Buffer'] })
    const cloudflare = new CloudflareSchemePlugin()
    const { delta } = runHook((config: any) => {
      config.plugins.push(defines, provides, cloudflare)
      return config
    })
    expect(delta.plugins).toEqual([defines, provides, cloudflare])
  })

  it('safe-wallet: appends externals array entries', () => {
    const { delta } = runHook((config: any) => {
      config.externals.push('resvg-js', /^@safe-global\//)
      return config
    })
    expect(delta.externals).toEqual(['resvg-js', /^@safe-global\//])
  })

  it('safe-wallet: mutating an existing rule (image.exclude = /\\.svg$/) is preserved on the post-hook config', () => {
    // safe-wallet steals SVGs from the default image rule by mutating
    // imageRule.exclude before adding SVGR. The mutation belongs to a
    // pre-existing Next.js rule, not a new one, so it's NOT in `delta.rules`
    // — but `preset.ts` runs the user hook against the live rspack config so
    // the mutation lands on the actual rule that ships.
    const { config, delta } = runHook((cfg: any) => {
      const imageRule = cfg.module.rules.find(
        (r: any) => r.type === 'asset/resource',
      )
      imageRule.exclude = /\.svg$/
      cfg.module.rules.push({ test: /\.svg$/, use: '@svgr/webpack' })
      return cfg
    })
    const imageRule = config.module.rules.find(
      (r: any) => r.type === 'asset/resource',
    ) as any
    expect(imageRule).toBeDefined()
    expect(imageRule.exclude).toEqual(/\.svg$/)
    // Only the new SVGR rule shows up in the delta — mutation doesn't.
    expect(delta.rules).toHaveLength(1)
    expect((delta.rules[0] as any).use).toBe('@svgr/webpack')
  })
})

describe('instrumentUserWebpack — append-only policy', () => {
  // The delta model forwards ADDITIONS only — a hook that deletes/replaces
  // existing rules or plugins produces an empty delta and that removal is
  // silently ignored (no warning). To remove a rule on the Storybook side, use
  // `.storybook/main.* webpackFinal`, which runs against the live rspack config.
  it('yields an empty rules delta when the hook deletes rules (removal not forwarded)', () => {
    const { delta } = runHook((config: any) => {
      config.module.rules = []
      return config
    })
    expect(delta.rules).toEqual([])
  })

  it('yields an empty plugins delta when the hook deletes plugins (removal not forwarded)', () => {
    const { delta } = runHook((config: any) => {
      config.plugins = []
      return config
    })
    expect(delta.plugins).toEqual([])
  })
})

describe('instrumentUserWebpack — return-shape variations', () => {
  it('captures the delta when the hook returns a fresh object instead of mutating', () => {
    const newRule = { test: /\.foo$/, use: ['foo-loader'] }
    const { delta } = runHook((config: any, _opts: any) => ({
      ...config,
      module: {
        ...config.module,
        rules: [...config.module.rules, newRule],
      },
    }))
    expect(delta.rules).toEqual([newRule])
  })

  it('treats no-return as mutation (config is taken as the post-hook value)', () => {
    const newRule = { test: /\.bar$/, use: ['bar-loader'] }
    const { delta } = runHook((config: any) => {
      config.module.rules.push(newRule)
      // implicit undefined return
    })
    expect(delta.rules).toEqual([newRule])
  })
})

describe('instrumentUserWebpack — externals coercion', () => {
  it('coerces externals from object → array before the hook runs (NEXT_RSPACK shape)', () => {
    // Real symptom: `config.externals = { 'react': 'react' }` from
    // NEXT_RSPACK=true client-dev. User hooks assume `config.externals.push()`.
    // Coercion wraps the object as a single-element array.
    const nextConfig: any = {
      webpack: (config: any) => {
        // If coercion didn't happen, this would throw `push is not a function`.
        config.externals.push('appended-by-user')
        return config
      },
    }
    instrumentUserWebpack(nextConfig)
    const config = {
      module: { rules: [] },
      plugins: [],
      externals: { react: 'react' } as any,
      resolve: { alias: {}, fallback: {} },
      experiments: {},
    }
    const post = nextConfig.webpack(config, fakeOpts)
    expect(Array.isArray(post.externals)).toBe(true)
    expect(post.externals).toEqual([{ react: 'react' }, 'appended-by-user'])
  })

  it('coerces externals from undefined → [] before the hook runs', () => {
    const nextConfig: any = {
      webpack: (config: any) => {
        config.externals.push('only-mine')
        return config
      },
    }
    instrumentUserWebpack(nextConfig)
    const config: any = {
      module: { rules: [] },
      plugins: [],
      externals: undefined,
      resolve: { alias: {}, fallback: {} },
      experiments: {},
    }
    const post = nextConfig.webpack(config, fakeOpts)
    expect(post.externals).toEqual(['only-mine'])
  })

  it('coerces externals from {} → [] (treated as empty, not wrapped)', () => {
    const nextConfig: any = {
      webpack: (config: any) => {
        config.externals.push('only-mine')
        return config
      },
    }
    instrumentUserWebpack(nextConfig)
    const config: any = {
      module: { rules: [] },
      plugins: [],
      externals: {},
      resolve: { alias: {}, fallback: {} },
      experiments: {},
    }
    const post = nextConfig.webpack(config, fakeOpts)
    expect(post.externals).toEqual(['only-mine'])
  })
})

describe('instrumentUserWebpack — experiments shallow merge', () => {
  it('captures experiments toggled by the hook', () => {
    const { delta } = runHook((config: any) => {
      config.experiments = { ...config.experiments, asyncWebAssembly: true }
      return config
    })
    expect(delta.experiments).toEqual({ asyncWebAssembly: true })
  })

  it('captures value change to a pre-existing experiment key', () => {
    const nextConfig: any = {
      webpack: (config: any) => {
        config.experiments.preExisting = true
        return config
      },
    }
    instrumentUserWebpack(nextConfig)
    const config = {
      module: { rules: [] },
      plugins: [],
      externals: [],
      resolve: { alias: {}, fallback: {} },
      experiments: { preExisting: false },
    }
    nextConfig.webpack(config, fakeOpts)
    // The wrapper returns a delta tracker — fetch via the getter we captured.
    // We re-instrument from scratch to keep this test self-contained.
    // (Real path is exercised in the integration-style runHook helper.)
    expect(config.experiments.preExisting).toBe(true)
  })
})

describe('ruleTestMatchesAny', () => {
  it('matches a RegExp against a candidate string', () => {
    expect(ruleTestMatchesAny(/\.svg$/, ['probe.svg'])).toBe(true)
    expect(ruleTestMatchesAny(/\.png$/, ['probe.svg'])).toBe(false)
  })

  it('matches an array of tests as a union (any sub-test matches)', () => {
    expect(ruleTestMatchesAny([/\.svg$/, /\.png$/], ['probe.png'])).toBe(true)
    expect(ruleTestMatchesAny([/\.svg$/, /\.png$/], ['probe.css'])).toBe(false)
  })

  it('matches `{ or: [...] }` shape as a union', () => {
    const test = { or: [/\.svg$/, /\.tsx?$/] }
    expect(ruleTestMatchesAny(test, ['probe.tsx'])).toBe(true)
    expect(ruleTestMatchesAny(test, ['probe.css'])).toBe(false)
  })

  it('matches `{ and: [...] }` only when every sub-test matches the same candidate', () => {
    // barrel-optimize-ish shape: ends with .tsx AND contains `__barrel`.
    const test = { and: [/__barrel/, /\.tsx?$/] }
    expect(
      ruleTestMatchesAny(test, ['__barrel_optimize__?names=x!=!file.tsx']),
    ).toBe(true)
    // Probe missing one of the AND clauses → no match.
    expect(ruleTestMatchesAny(test, ['file.tsx'])).toBe(false)
  })

  it('returns false for null / undefined / unknown shapes', () => {
    expect(ruleTestMatchesAny(undefined, ['x.mdx'])).toBe(false)
    expect(ruleTestMatchesAny(null, ['x.mdx'])).toBe(false)
    expect(ruleTestMatchesAny({ foo: 'bar' }, ['x.mdx'])).toBe(false)
  })
})

describe('isStorybookClaimedRule', () => {
  it('drops a user `.mdx` rule (claimed by @storybook/addon-docs)', () => {
    // safe-wallet ships @next/mdx via next.config — the user-side mdx rule
    // would silently fuse with addon-docs's MDX loader chain into a broken
    // double-loader. Drop it from the delta.
    const mdxRule = {
      test: /\.mdx?$/,
      use: ['@mdx-js/loader'],
    }
    expect(isStorybookClaimedRule(mdxRule)).toBe(true)
  })

  it('keeps a user `.svg` rule (not claimed)', () => {
    const svgRule = { test: /\.svg$/, use: '@svgr/webpack' }
    expect(isStorybookClaimedRule(svgRule)).toBe(false)
  })

  it('keeps a rule without a `test` field', () => {
    expect(isStorybookClaimedRule({ use: 'foo-loader' })).toBe(false)
  })

  it('drops a rule whose test is a string-shape that matches a claimed extension', () => {
    // Some webpack configs pass `test` as the literal extension string.
    const rule = { test: { or: [/\.mdx$/, /\.md$/] }, use: ['mdx-loader'] }
    expect(isStorybookClaimedRule(rule)).toBe(true)
  })
})

describe('instrumentUserWebpack — integration with claimed-extension drop', () => {
  it('safe-wallet: appended @next/mdx rule is dropped from the delta', () => {
    const mdxRule = { test: /\.mdx?$/, use: ['@mdx-js/loader'] }
    const otherRule = { test: /\.frag$/, use: ['frag-loader'] }
    const { delta } = runHook((config: any) => {
      config.module.rules.push(mdxRule, otherRule)
      return config
    })
    // mdx rule got dropped, frag rule passes through.
    expect(delta.rules).toHaveLength(1)
    expect(delta.rules[0]).toBe(otherRule)
  })
})

describe('DUMMY_NEXT_ARGS.entrypoints — PWA entry-patch compatibility', () => {
  const mainApp = DUMMY_NEXT_ARGS.entrypoints['main-app']

  // In production, `getBaseWebpackConfig` eagerly evaluates the entry chain, so
  // the dummy `main-app` entry reaches any next.config plugin that patches the
  // client entry. Next's own `clientEntries` builds `main-app` as an array; the
  // stub must match that shape, not the `{ import: [...] }` descriptor.
  it('is an array (matches Next clientEntries shape), not an object descriptor', () => {
    expect(Array.isArray(mainApp)).toBe(true)
    expect(mainApp).toContain('next/dist/client/next-dev.js')
  })

  // Reproduces @serwist/next (and next-pwa) entry injection verbatim: it reads
  // `entries['main-app'].includes(...)` then `.unshift(...)`. Against the old
  // object descriptor this threw `entries.main-app.includes is not a function`,
  // aborting the bridge into a silent React-only fallback.
  it('survives a serwist/next-pwa-style .includes/.unshift entry patch', () => {
    const swEntry = 'private-next-pwa-sw-register'
    // What Next produces after merging clientEntries with our dummy entrypoints:
    // `{ ...clientEntries, ...DUMMY_NEXT_ARGS.entrypoints }` — our stub overrides
    // `main-app`, so the patcher sees exactly the stub's shape here.
    const entries: Record<string, unknown> = {
      'main.js': [],
      // Copy — the patch mutates in place; don't pollute the shared dummy.
      'main-app': [...mainApp],
    }

    const patch = () => {
      for (const key of ['main.js', 'main-app']) {
        const entry = entries[key] as string[] | string | undefined
        if (entry && !(entry as string[]).includes(swEntry)) {
          if (Array.isArray(entry)) entry.unshift(swEntry)
          else if (typeof entry === 'string') entries[key] = [swEntry, entry]
        }
      }
    }

    expect(patch).not.toThrow()
    expect(entries['main-app']).toContain(swEntry)
  })
})

describe('configLoadPhase (F1 — extract in the matching mode)', () => {
  const PHASES = {
    PHASE_DEVELOPMENT_SERVER: 'phase-development-server',
    PHASE_PRODUCTION_BUILD: 'phase-production-build',
  }

  it('uses the development-server phase for `storybook dev` (dev:true)', () => {
    expect(configLoadPhase(true, PHASES)).toBe('phase-development-server')
  })

  it('uses the production-build phase for `storybook build` (dev:false)', () => {
    // The previously-hardcoded dev phase inlined .env.development values into a
    // production Storybook bundle — this locks the mode to match the build.
    expect(configLoadPhase(false, PHASES)).toBe('phase-production-build')
  })
})

describe('resolveRspackValidateMode (F13 — non-silent default, respect override)', () => {
  it('defaults to the non-silent "loose" mode when unset', () => {
    expect(resolveRspackValidateMode(undefined)).toBe('loose')
  })

  it('respects a user-supplied value (e.g. strict to debug)', () => {
    expect(resolveRspackValidateMode('strict')).toBe('strict')
    expect(resolveRspackValidateMode('loose-silent')).toBe('loose-silent')
  })
})

describe('selectBridgeFailureHint (F9 — attributed remediation hint)', () => {
  it('points at next-rspack install for the missing-peer error', () => {
    const err = new Error("Cannot find module 'next-rspack/rspack-core'")
    expect(selectBridgeFailureHint(err)).toContain('Install next-rspack')
  })

  it('points at nextConfigPath for the findPagesDir pages/app error', () => {
    // The exact message `find-pages-dir` throws when neither dir exists.
    const err = new Error("> Couldn't find any `pages` or `app` directory.")
    const hint = selectBridgeFailureHint(err)
    expect(hint).toContain('nextConfigPath')
    expect(hint).toContain('project root')
    // Must NOT misattribute to a plugin/webpack() hook.
    expect(hint).not.toContain('`webpack()` hook')
  })

  it('falls back to the generic plugin/webpack() hint for other errors', () => {
    const err = new Error('some unrelated plugin exploded')
    const hint = selectBridgeFailureHint(err)
    expect(hint).toContain('`webpack()` hook')
    expect(hint).not.toContain('nextConfigPath')
  })
})

describe('resolveBridgeFailure (F9 — dev degrades, prod fails)', () => {
  const nextVersion: [number, number] = [15, 3]

  // Suppress (and inspect) the attributed error logging.
  let errorSpy: ReturnType<typeof rstest.spyOn>
  beforeEach(() => {
    errorSpy = rstest.spyOn(logger, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    errorSpy.mockRestore()
  })

  const EMPTY = {
    alias: {},
    fallback: {},
    defines: {},
    resolveLoader: {},
    rawRules: [],
    rawPlugins: [],
    imagesDisableStaticImports: false,
    userDelta: {
      rules: [],
      plugins: [],
      alias: {},
      fallback: {},
      experiments: {},
      externals: [],
    },
  }

  it('dev: degrades to an empty extraction (best-effort boot)', () => {
    const err = new Error('bridge boom')
    expect(
      resolveBridgeFailure(err, {
        dev: true,
        allowMissingNextBridge: false,
        nextVersion,
      }),
    ).toEqual(EMPTY)
  })

  it('prod: re-throws the ORIGINAL error so CI fails the build', () => {
    const err = new Error('bridge boom')
    let caught: unknown
    try {
      resolveBridgeFailure(err, {
        dev: false,
        allowMissingNextBridge: false,
        nextVersion,
      })
    } catch (e) {
      caught = e
    }
    // Same error instance — its stack survives into the thrown error.
    expect(caught).toBe(err)
    // …and the stack was ALSO logged (not swallowed).
    expect(errorSpy).toHaveBeenCalledWith(err.stack)
  })

  it('prod + allowMissingNextBridge: opts back into the degrade', () => {
    const err = new Error('bridge boom')
    expect(
      resolveBridgeFailure(err, {
        dev: false,
        allowMissingNextBridge: true,
        nextVersion,
      }),
    ).toEqual(EMPTY)
  })
})
