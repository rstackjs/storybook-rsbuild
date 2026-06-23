import { createRequire } from 'node:module'
import { logger } from 'storybook/internal/node-logger'
import { readProvidedMap, walkRules } from './preset-helpers'

// Must be set before any Next.js internal imports so that
// getBaseWebpackConfig() emits rspack-compatible config.
process.env.NEXT_RSPACK = 'true'
process.env.RSPACK_CONFIG_VALIDATE = 'loose-silent'
// Prevents Next.js from erroring about missing render worker context
process.env.__NEXT_PRIVATE_RENDER_WORKER = 'defined'

export interface NextRspackExtraction {
  /** resolve.alias from getBaseWebpackConfig (absolute paths) */
  alias: Record<string, string | string[] | false>
  /** top-level resolve.fallback (e.g. `{ process: <polyfill> }`) */
  fallback: Record<string, string | string[] | false>
  /** DefinePlugin definitions (process.env.__NEXT_*, etc.) */
  defines: Record<string, any>
  /** resolveLoader configuration */
  resolveLoader: Record<string, any>
  /** Raw module rules from getBaseWebpackConfig (client; mode matches build). */
  rawRules: any[]
  /** Raw plugin instances from getBaseWebpackConfig (client; mode matches build). */
  rawPlugins: any[]
  /**
   * Delta added by the user's `next.config.webpack(config, opts)` hook,
   * captured by wrapping the hook before `getBaseWebpackConfig()` invokes it.
   * Append-only for arrays; key-diff for objects. Empty when the user did not
   * define a `webpack` hook. Forwarded into the rspack config in `preset.ts`
   * (bypassing Next.js's plugin allowlist by design — user-authored plugins
   * are user intent, not Next.js base output).
   */
  userDelta: UserWebpackDelta
}

export interface UserWebpackDelta {
  /** Rules appended by the user's webpack() hook. */
  rules: any[]
  /** Plugin instances appended by the user's webpack() hook. */
  plugins: any[]
  /** Aliases added or overwritten by the user. */
  alias: Record<string, string | string[] | false>
  /** Fallback entries added or overwritten by the user. */
  fallback: Record<string, string | string[] | false>
  /** Experiment keys added or changed by the user. */
  experiments: Record<string, any>
  /** Externals appended by the user (array form only). */
  externals: any[]
}

const EMPTY_USER_DELTA: UserWebpackDelta = {
  rules: [],
  plugins: [],
  alias: {},
  fallback: {},
  experiments: {},
  externals: [],
}

const req = createRequire(import.meta.url)

let cachedVersion: [number, number] | null | undefined

/**
 * `[major, minor]` of the resolvable `next` package, or `null` if not found.
 */
export function getNextVersion(): [number, number] | null {
  if (cachedVersion !== undefined) return cachedVersion
  try {
    const { version } = req('next/package.json')
    const [maj, min] = version.split('.').map((n: string) => parseInt(n, 10))
    cachedVersion = Number.isNaN(maj) || Number.isNaN(min) ? null : [maj, min]
  } catch {
    cachedVersion = null
  }
  return cachedVersion
}

const PREVIEW_KEYS = {
  previewModeId: 'storybook-preview',
  previewModeSigningKey: 'storybook-signing-key',
  previewModeEncryptionKey: 'storybook-encryption-key',
}

/**
 * Dummy values fed to `getBaseWebpackConfig()` to satisfy its required params.
 * Storybook never produces a real `.next/` build or serves draft-mode pages,
 * so these code paths are dead in our case — the values are inert, not secrets.
 * Keyed separately from version-dependent params (see `buildWebpackConfigParams`).
 * See AGENTS.md § Shim Catalogue.
 */
const DUMMY_NEXT_ARGS = {
  buildId: 'storybook-dev',
  encryptionKey: 'storybook-encryption-key-1234567890ab',
  rewrites: { beforeFiles: [], afterFiles: [], fallback: [] },
  originalRewrites: undefined,
  originalRedirects: undefined,
  entrypoints: {
    'main-app': { import: ['next/dist/client/next-dev.js'] },
  },
}

/**
 * Build the `getBaseWebpackConfig` options for the detected Next.js version.
 * Signature drift: 15.x uses `edgePreviewProps`; 16.0+ renamed to
 * `previewProps` (now required).
 */
function buildWebpackConfigParams(
  version: [number, number] | null,
  base: Record<string, any>,
): Record<string, any> {
  const params: Record<string, any> = { ...base }

  if (!version || version[0] >= 16) {
    params.previewProps = PREVIEW_KEYS
  } else if (version[0] === 15) {
    params.edgePreviewProps = PREVIEW_KEYS
  } else {
    logger.warn(
      `Next.js ${version.join('.')} is below the supported range (15.3+). ` +
        'Bridge may fail or produce incorrect config.',
    )
    params.edgePreviewProps = PREVIEW_KEYS
  }

  return params
}

const EMPTY_EXTRACTION: NextRspackExtraction = {
  alias: {},
  fallback: {},
  defines: {},
  resolveLoader: {},
  rawRules: [],
  rawPlugins: [],
  userDelta: EMPTY_USER_DELTA,
}

/**
 * Wraps `nextConfig.webpack` so we observe the rspack config both before and
 * after the user's hook runs, without invoking `getBaseWebpackConfig()` twice.
 * Strategy:
 *   1. Snapshot identity sets / value maps of the fields we care about *before*
 *      the hook (reference identity, not array length).
 *   2. Let the hook run with the real Next.js arguments (`opts.dev`,
 *      `opts.isServer`, `opts.defaultLoaders`, ...).
 *   3. Compute the delta as "entries present after but not before".
 *
 * The captured delta is exposed via `getDelta()`, called after
 * `getBaseWebpackConfig()` returns. If the user did not define a `webpack`
 * hook, this is a no-op and `getDelta()` returns an empty delta.
 *
 * Field policy:
 *   rules / plugins / externals : additions by reference identity
 *   alias / fallback            : key-diff (added or value-changed keys)
 *   experiments                 : shallow merge (added or value-changed keys)
 *   optimization / cache / etc. : silent skip (Rsbuild/Storybook territory)
 */
export function instrumentUserWebpack(nextConfig: any): () => UserWebpackDelta {
  const original = nextConfig?.webpack
  if (typeof original !== 'function') {
    return () => EMPTY_USER_DELTA
  }

  let captured: UserWebpackDelta = EMPTY_USER_DELTA

  nextConfig.webpack = (webpackConfig: any, opts: any) => {
    // Coerce `externals` to an array before the user hook runs.
    // Next.js's NEXT_RSPACK=true client-dev base config may emit `externals`
    // as a non-array shape (object/function/undefined), but most user
    // `next.config.webpack()` hooks assume the webpack convention of
    // `config.externals.push(...)`. Coercing here lets webpack-style hooks
    // append cleanly without per-project workarounds. Pre-existing object
    // entries are migrated as a single-element array so we don't lose them.
    if (webpackConfig && !Array.isArray(webpackConfig.externals)) {
      const existing = webpackConfig.externals
      webpackConfig.externals =
        existing == null ||
        (typeof existing === 'object' && Object.keys(existing).length === 0)
          ? []
          : [existing]
    }
    const before = snapshotForDelta(webpackConfig)
    const after = original(webpackConfig, opts) ?? webpackConfig
    captured = computeDelta(before, after)
    return after
  }

  return () => captured
}

interface DeltaSnapshot {
  /**
   * Identity sets / value maps of what the config carried BEFORE the user hook
   * ran. Anything present afterward but absent here is a user addition. Using
   * reference identity (not array length) means an addition is captured no
   * matter where in the array it lands, and a removal simply doesn't surface —
   * the framework forwards additions only.
   */
  rules: Set<unknown>
  plugins: Set<unknown>
  externals: Set<unknown>
  externalsIsArray: boolean
  alias: Map<string, unknown>
  fallback: Map<string, unknown>
  experiments: Map<string, unknown>
}

function snapshotForDelta(cfg: any): DeltaSnapshot {
  const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
  return {
    rules: new Set(arr(cfg?.module?.rules)),
    plugins: new Set(arr(cfg?.plugins)),
    externals: new Set(arr(cfg?.externals)),
    externalsIsArray: Array.isArray(cfg?.externals),
    alias: new Map(Object.entries(cfg?.resolve?.alias ?? {})),
    fallback: new Map(Object.entries(cfg?.resolve?.fallback ?? {})),
    experiments: new Map(Object.entries(cfg?.experiments ?? {})),
  }
}

function computeDelta(before: DeltaSnapshot, after: any): UserWebpackDelta {
  const added = (v: unknown, seen: Set<unknown>): any[] =>
    Array.isArray(v) ? v.filter((x) => !seen.has(x)) : []

  return {
    rules: added(after?.module?.rules, before.rules).filter(
      (rule) => !isStorybookClaimedRule(rule),
    ),
    plugins: added(after?.plugins, before.plugins),
    externals: before.externalsIsArray
      ? added(after?.externals, before.externals)
      : [],
    alias: diffRecord(before.alias, after?.resolve?.alias ?? {}),
    fallback: diffRecord(before.fallback, after?.resolve?.fallback ?? {}),
    experiments: diffRecord(before.experiments, after?.experiments ?? {}),
  }
}

function diffRecord<V>(
  before: Map<string, unknown>,
  after: Record<string, V>,
): Record<string, V> {
  const out: Record<string, V> = {}
  for (const [k, v] of Object.entries(after)) {
    if (!before.has(k) || before.get(k) !== v) out[k] = v
  }
  return out
}

/**
 * File extensions Storybook addons (currently `@storybook/addon-docs`) claim
 * exclusively. User-added rules matching these extensions are dropped from the
 * delta because rspack concatenates loader chains from all matching rules —
 * letting a user-side `@next/mdx` rule co-exist with addon-docs's MDX loader
 * silently fuses their two loader chains into one broken chain, producing the
 * opaque `Module build failed: ×` error.
 *
 * Mental model for the user: in Storybook, `.mdx` is processed by
 * `@storybook/addon-docs`. Your `next.config.webpack()`-added MDX loader
 * (typically from `@next/mdx`) applies to Next.js page MDX, not Storybook
 * stories — they share the extension but not the build context.
 *
 * Convergent in the spirit of the user's directive: a single, explicit
 * exclusion list — not enumeration-by-symptom — anchored to "Storybook addon
 * owns this extension." Extend only when a new conflict surfaces with the same
 * shape.
 */
const STORYBOOK_CLAIMED_EXTENSIONS = ['.mdx']

export function ruleTestMatchesAny(
  test: unknown,
  candidates: readonly string[],
): boolean {
  if (!test) return false
  if (test instanceof RegExp) return candidates.some((p) => test.test(p))
  if (Array.isArray(test)) {
    return test.some((t) => ruleTestMatchesAny(t, candidates))
  }
  if (typeof test === 'object' && test !== null) {
    const t = test as { and?: unknown[]; or?: unknown[] }
    if (Array.isArray(t.or)) {
      return t.or.some((sub) => ruleTestMatchesAny(sub, candidates))
    }
    if (Array.isArray(t.and)) {
      // `{ and: [...] }` means ALL sub-tests must match; the rule applies to a
      // file extension only if every clause matches a representative filename.
      return candidates.some((p) =>
        t.and!.every((sub) => ruleTestMatchesAny(sub, [p])),
      )
    }
  }
  return false
}

export function isStorybookClaimedRule(rule: any): boolean {
  if (!rule || typeof rule !== 'object') return false
  const sampleNames = STORYBOOK_CLAIMED_EXTENSIONS.map((ext) => `probe${ext}`)
  if (ruleTestMatchesAny(rule.test, sampleNames)) {
    logger.info(
      `Dropping user next.config.webpack() rule for ${STORYBOOK_CLAIMED_EXTENSIONS.join('/')} ` +
        '(claimed by @storybook/addon-docs in Storybook context).',
    )
    return true
  }
  return false
}

/**
 * Call Next.js's `getBaseWebpackConfig()` in rspack mode and extract aliases,
 * defines, resolveLoader, raw rules, and raw plugins. On failure, logs the
 * error and returns an empty extraction so Storybook can still boot.
 *
 * `next-rspack` must be installed in the consuming project so that `next`'s
 * internal `require('next-rspack/rspack-core')` can resolve it.
 */
export async function extractNextRspackConfig(
  dir?: string,
  { dev = true }: { dev?: boolean } = {},
): Promise<NextRspackExtraction> {
  const projectDir = dir || process.cwd()
  const nextVersion = getNextVersion()

  try {
    return await doExtract(projectDir, nextVersion, dev)
  } catch (err) {
    const versionLabel = nextVersion ? nextVersion.join('.') : 'unknown'
    const installHint = isMissingNextRspackError(err)
      ? ' Install next-rspack in your Next.js project and keep it aligned with your next version.'
      : ''
    logger.error(
      `Failed to bridge Next.js config (next@${versionLabel}). ` +
        'Storybook will boot with React support only — ' +
        'Next.js features (CSS, fonts, images, navigation mocks) will not work. ' +
        `Error: ${err instanceof Error ? err.message : String(err)}.` +
        installHint,
    )
    return EMPTY_EXTRACTION
  }
}

function isMissingNextRspackError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  return (
    err.message.includes('next-rspack/rspack-core') ||
    err.message.includes('@rspack/core is not available')
  )
}

async function doExtract(
  projectDir: string,
  nextVersion: [number, number] | null,
  dev: boolean,
): Promise<NextRspackExtraction> {
  const [constantsMod, traceMod, configMod, webpackConfigMod, pagesDirMod] =
    await Promise.all([
      import('next/constants.js'),
      import('next/dist/trace/index.js'),
      import('next/dist/server/config.js'),
      import('next/dist/build/webpack-config.js'),
      import('next/dist/lib/find-pages-dir.js').catch(() => null),
    ])

  const { PHASE_DEVELOPMENT_SERVER, COMPILER_NAMES } = constantsMod
  const { Span } = traceMod
  // ESM import of CJS module can create double-wrapped default; `as any`
  // because TS types the single-unwrapped `.default` as the function directly
  // (no further `.default`), but at runtime we defend against the wrapped form.
  const loadConfig = (configMod as any).default?.default || configMod.default
  const getBaseWebpackConfig =
    (webpackConfigMod as any).default?.default || webpackConfigMod.default
  const { loadProjectInfo } = webpackConfigMod

  const nextConfig = await loadConfig(PHASE_DEVELOPMENT_SERVER, projectDir)
  // Instrument the user's `webpack(config, opts)` hook (no-op if absent) so we
  // can extract its delta in a single getBaseWebpackConfig() call. Must happen
  // BEFORE loadProjectInfo / getBaseWebpackConfig so the wrapper is the
  // reference Next.js invokes.
  const getUserDelta = instrumentUserWebpack(nextConfig)
  const projectInfo = await loadProjectInfo({
    dir: projectDir,
    config: nextConfig,
    dev,
  })

  const dirs = pagesDirMod?.findPagesDir(projectDir)

  const params = buildWebpackConfigParams(nextVersion, {
    ...DUMMY_NEXT_ARGS,
    config: nextConfig,
    compilerType: COMPILER_NAMES.client,
    dev,
    pagesDir: dirs?.pagesDir,
    appDir: dirs?.appDir,
    runWebpackSpan: new Span({ name: 'storybook' }),
    jsConfig: projectInfo.jsConfig,
    jsConfigPath: projectInfo.jsConfigPath,
    resolvedBaseUrl: projectInfo.resolvedBaseUrl,
    supportedBrowsers: projectInfo.supportedBrowsers,
  })

  const rspackConfig = await getBaseWebpackConfig(projectDir, params)

  const defines: Record<string, any> = {}
  for (const plugin of rspackConfig.plugins || []) {
    const name = plugin?.constructor?.name
    if (name === 'DefinePlugin' || name === 'RspackDefinePlugin') {
      const provided = readProvidedMap(plugin)
      if (provided) {
        Object.assign(defines, provided)
      } else {
        // `readProvidedMap` reads rspack's internal `._args[0]` (no public API
        // for a plugin's definitions map). If a future rspack changes that
        // wrapper shape, extraction would silently yield {} and every Next.js
        // `__NEXT_*` define would go missing — surfacing only as a render-time
        // ReferenceError far from the cause. Warn so the break is attributable.
        logger.warn(
          `Found a ${name} but could not read its definitions ` +
            '(rspack plugin internal `_args[0]` shape may have changed). ' +
            'Next.js defines will be missing — stories relying on them may ' +
            'throw at render. See storybook-next-rsbuild Shim Catalogue.',
        )
      }
    }
  }

  const alias = rspackConfig.resolve?.alias || {}
  const rawRules = rspackConfig.module?.rules || []
  const rawPlugins = rspackConfig.plugins || []

  // Next.js's browser polyfills (`querystring-es3`, `buffer`, `path-browserify`,
  // ...) aren't on `resolve.fallback` — they're tucked inside a top-level rule
  // whose only field is `resolve.fallback`. Harvest those and merge them up so
  // Storybook's global resolver can satisfy `import { parse } from 'querystring'`
  // from user code too. Last-write-wins, matching webpack's rule ordering.
  const fallback: Record<string, string | string[] | false> = {
    ...(rspackConfig.resolve?.fallback || {}),
  }
  walkRules(rawRules, (r) => {
    if (r.resolve?.fallback) Object.assign(fallback, r.resolve.fallback)
  })

  const userDelta = getUserDelta()
  const deltaSummary =
    userDelta.rules.length +
      userDelta.plugins.length +
      Object.keys(userDelta.alias).length +
      Object.keys(userDelta.fallback).length +
      Object.keys(userDelta.experiments).length +
      userDelta.externals.length >
    0
      ? ` (user next.config.webpack: +${userDelta.rules.length} rules, +${userDelta.plugins.length} plugins, +${Object.keys(userDelta.alias).length} aliases, +${Object.keys(userDelta.fallback).length} fallbacks, +${Object.keys(userDelta.experiments).length} experiments, +${userDelta.externals.length} externals)`
      : ''

  logger.info(
    `Extracted Next.js rspack config: ${Object.keys(alias).length} aliases, ` +
      `${Object.keys(defines).length} defines, ` +
      `${rawRules.length} rules, ${rawPlugins.length} plugins` +
      deltaSummary,
  )

  return {
    alias,
    fallback,
    defines,
    resolveLoader: rspackConfig.resolveLoader || {},
    rawRules,
    rawPlugins,
    userDelta,
  }
}
