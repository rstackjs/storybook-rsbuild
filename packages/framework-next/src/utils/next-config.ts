import { createRequire } from 'node:module'
import { logger } from 'storybook/internal/node-logger'
import { readProvidedMap, walkRules } from './preset-helpers'

/**
 * The RSPACK_CONFIG_VALIDATE mode to use: a user-supplied value always wins;
 * otherwise the non-silent 'loose' default (see the assignment above). Extracted
 * so the "respect override, default when unset" contract is unit-testable
 * without wrestling the module-load side effect.
 */
export function resolveRspackValidateMode(current: string | undefined): string {
  return current ?? 'loose'
}

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
   * `nextConfig.images.disableStaticImages` (default false). When true, static
   * image imports resolve to a bare URL string instead of `StaticImageData`,
   * matching Next.js. Threaded into the static-image stub loader in preset.ts.
   */
  imagesDisableStaticImports: boolean
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

/**
 * The Next.js config-loading phase that matches the Storybook build mode:
 * dev → PHASE_DEVELOPMENT_SERVER, production → PHASE_PRODUCTION_BUILD. Governs
 * which `.env.*` files `@next/env` loads and which branch a phase-conditional
 * `next.config` function takes. Pure/exported for unit testing.
 */
export function configLoadPhase(
  dev: boolean,
  phases: {
    PHASE_DEVELOPMENT_SERVER: string
    PHASE_PRODUCTION_BUILD: string
  },
): string {
  return dev ? phases.PHASE_DEVELOPMENT_SERVER : phases.PHASE_PRODUCTION_BUILD
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
export const DUMMY_NEXT_ARGS = {
  buildId: 'storybook-dev',
  encryptionKey: 'storybook-encryption-key-1234567890ab',
  rewrites: { beforeFiles: [], afterFiles: [], fallback: [] },
  originalRewrites: undefined,
  originalRedirects: undefined,
  entrypoints: {
    // Use the bare **array** entry shape, not the `{ import: [...] }` descriptor.
    // Next's own `clientEntries` builds `main-app` as an array, and plugins that
    // patch the client entry — PWA / service-worker plugins like `@serwist/next`
    // and `next-pwa` — call array methods on it (`entries['main-app'].includes(x)`,
    // `.unshift(x)`). In production, `getBaseWebpackConfig` eagerly evaluates the
    // entry chain, so this dummy reaches those plugins; the object form has no
    // `.includes` and throws `entries.main-app.includes is not a function`, which
    // aborts the whole bridge. The array form matches Next and survives the patch.
    // (The entry portion of the output is discarded anyway — see AGENTS.md.)
    'main-app': ['next/dist/client/next-dev.js'],
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
  imagesDisableStaticImports: false,
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
  {
    dev = true,
    allowMissingNextBridge = false,
  }: { dev?: boolean; allowMissingNextBridge?: boolean } = {},
): Promise<NextRspackExtraction> {
  // Set at extraction time (not module load): all Next.js/rspack reads below are
  // call-time — `doExtract` reaches Next internals only via dynamic `import()`,
  // and @rspack/core reads RSPACK_CONFIG_VALIDATE at compile time — so setting
  // here still lands before every reader. These are NOT unset afterward:
  // NEXT_RSPACK is read at loader-run time during the Storybook compile, and
  // RSPACK_CONFIG_VALIDATE governs the final compile too. See AGENTS.md Shim
  // Catalogue.
  //
  // Must be set before any Next.js internal imports so that
  // getBaseWebpackConfig() emits rspack-compatible config.
  process.env.NEXT_RSPACK = 'true'
  // This var is process-wide and is ALSO read by @rspack/core when Rsbuild calls
  // `rspack(finalConfig)` at compile time, so it governs validation of the whole
  // final Storybook build — including the user's own webpackFinal/tools.rspack
  // mutations. Next.js emits webpack-only keys that @rspack/core 1.5.0's schema
  // rejects, so 'strict' can't be used; but 'loose-silent' would suppress a typo
  // in the user's config too. Default to the loosest NON-silent mode ('loose':
  // prints validation issues as warnings, never throws) so config typos still
  // surface. Only default when unset so a user can override (e.g.
  // RSPACK_CONFIG_VALIDATE=strict to debug, or 'loose-silent' to restore the old
  // behavior). Read only by @rspack/core <= 1.5.x (Next 15 rows); rspack 1.6.0
  // removed JS-side validation, so it is vestigial on Next 16 rows.
  process.env.RSPACK_CONFIG_VALIDATE = resolveRspackValidateMode(
    process.env.RSPACK_CONFIG_VALIDATE,
  )
  // Setting this var makes Next.js's loadConfig() SKIP loadWebpackHook(), which
  // would otherwise install ~40 process-wide require-hook aliases remapping
  // 'webpack', 'webpack-sources', '@babel/runtime', etc. to next/dist/compiled/*
  // for the entire Storybook process (hijacking those requires in user
  // webpackFinal / webpackAddons code that does `require('webpack')`). (It only
  // *throws* in standalone/untraced installs, not a normal one.)
  process.env.__NEXT_PRIVATE_RENDER_WORKER = 'defined'

  const projectDir = dir || process.cwd()
  const nextVersion = getNextVersion()

  try {
    return await doExtract(projectDir, nextVersion, dev)
  } catch (err) {
    return resolveBridgeFailure(err, {
      dev,
      allowMissingNextBridge,
      nextVersion,
    })
  }
}

/**
 * Attributed-log + failure policy for a bridge extraction error.
 *
 * Always logs the named error and the ORIGINAL stack. The React-only degrade is
 * the intended recovery for `storybook dev` (best-effort boot), but a
 * production `storybook build` HARD-FAILS by re-throwing the original error so
 * CI catches a broken artifact instead of shipping one where every Next.js
 * feature is silently dead. `allowMissingNextBridge` opts prod back into the
 * degrade for intentional React-only static builds. Exported so the policy is
 * unit-testable without wrestling `doExtract`'s dynamic imports.
 */
export function resolveBridgeFailure(
  err: unknown,
  {
    dev,
    allowMissingNextBridge,
    nextVersion,
  }: {
    dev: boolean
    allowMissingNextBridge: boolean
    nextVersion: [number, number] | null
  },
): NextRspackExtraction {
  const versionLabel = nextVersion ? nextVersion.join('.') : 'unknown'
  logger.error(
    `Failed to bridge Next.js config (next@${versionLabel}). ` +
      'Storybook will boot with React support only — ' +
      'Next.js features (CSS, fonts, images, navigation mocks) will not work.' +
      selectBridgeFailureHint(err),
  )
  // Preserve the full original error (stack included) — the message alone is
  // rarely enough to locate a failure originating inside next.config. The stack
  // must survive in BOTH the log above AND the re-thrown error below.
  logger.error(err instanceof Error ? (err.stack ?? err.message) : String(err))
  // Dev degrades to React-only; prod hard-fails unless explicitly opted out.
  if (!dev && !allowMissingNextBridge) throw err
  return EMPTY_EXTRACTION
}

/**
 * Pick the actionable remediation hint for a bridge extraction failure. The
 * fallback to React-only is the intended recovery for the *expected* failure —
 * `next-rspack` not installed — but for other errors the same degrade hides the
 * real cause, so we attribute the likely source. Exported for direct unit test.
 */
export function selectBridgeFailureHint(err: unknown): string {
  if (isMissingNextRspackError(err)) {
    return ' Install next-rspack in your Next.js project and keep it aligned with your next version.'
  }
  if (isMissingPagesOrAppDirError(err)) {
    // `findPagesDir` throws this when neither directory exists at the project
    // root — almost always because the resolved root is wrong, not a bad hook.
    return (
      " Next.js couldn't find a `pages` or `app` directory at the project" +
      ' root, which usually means the project root is wrong. Set' +
      ' `framework.options.nextConfigPath` in .storybook/main.* so the directory' +
      ' containing your next.config.* is used as the project root.'
    )
  }
  return (
    ' This usually means a plugin or `webpack()` hook in your next.config threw' +
    ' while Storybook extracted the build config. The original error and stack' +
    ' follow.'
  )
}

function isMissingNextRspackError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  return (
    err.message.includes('next-rspack/rspack-core') ||
    err.message.includes('@rspack/core is not available')
  )
}

function isMissingPagesOrAppDirError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  return err.message.includes("Couldn't find any `pages` or `app` directory")
}

/**
 * Detects `turbopack` loader/resolve config the webpack-config bridge cannot
 * honor. Turbopack is Next 16's default bundler, and `turbopack.rules` /
 * `resolveAlias` / `resolveExtensions` is exactly where a default Next 16
 * project wires SVGR-style loaders — yet `getBaseWebpackConfig` never reads the
 * `turbopack` key, making it the only dropped-config surface with no signal.
 * Also inspects the legacy pre-16 spelling `experimental.turbo` (same shape).
 *
 * Returns a single warning message naming which keys were found (and whether
 * they came from the legacy location), or `null` when nothing relevant is
 * present. Pure/exported so the key detection is unit-testable. We deliberately
 * do NOT translate turbopack rules into rspack rules — that is simulation,
 * which this package rejects; the fix is to mirror them via `webpack()`.
 */
export function describeUnbridgedTurbopackConfig(
  nextConfig: any,
): string | null {
  const TURBO_KEYS = ['rules', 'resolveAlias', 'resolveExtensions'] as const
  const hasEntries = (v: unknown): boolean => {
    if (Array.isArray(v)) return v.length > 0
    if (v && typeof v === 'object') return Object.keys(v).length > 0
    return false
  }
  const collect = (cfg: any, location: string): string[] =>
    cfg && typeof cfg === 'object'
      ? TURBO_KEYS.filter((k) => hasEntries(cfg[k])).map(
          (k) => `${location}.${k}`,
        )
      : []

  const found = [
    ...collect(nextConfig?.turbopack, 'turbopack'),
    ...collect(nextConfig?.experimental?.turbo, 'experimental.turbo'),
  ]
  if (found.length === 0) return null

  const usesLegacy = found.some((f) => f.startsWith('experimental.turbo.'))
  return (
    `Detected Turbopack config (${found.join(', ')}) that is not bridged. ` +
    'The Next.js → Storybook bridge reads only the webpack config, so ' +
    'these Turbopack loader/resolve settings (SVGR etc.) are ignored' +
    (usesLegacy
      ? ' (`experimental.turbo` is the pre-16 spelling of `turbopack`).'
      : '.') +
    ' Mirror them the Storybook way via the `webpack()` snippet in the docs ' +
    '(Advanced: custom loaders that span both layers, e.g. SVGR).'
  )
}

/**
 * Feature-detects whether the `__NEXT_PRIVATE_RENDER_WORKER` gate actually held
 * after `loadConfig`. That env var (set at extraction start) makes `loadConfig`
 * skip `loadWebpackHook()`, which otherwise remaps `webpack` and ~40 siblings to
 * `next/dist/compiled/webpack` process-wide via the require-hook's
 * `hookPropertyMap`. If the remap for `webpack` is present anyway, Next changed
 * its gate semantics and `require('webpack')` in user `webpackFinal` code may
 * now resolve to Next's compiled copy instead of the user's own webpack.
 *
 * Reads `hookPropertyMap` from `next/dist/server/require-hook` (verified against
 * next@16.2.9: `loadWebpackHook` calls `addHookAliases([['webpack', ...], ...])`
 * on that shared `Map`). Pure/exported so the detection is unit-testable without
 * loading Next. We check the map's `webpack` key rather than
 * `Module._resolveFilename` identity — the framework's own imports patch
 * `_resolveFilename` unconditionally, so an identity check is a permanent no-op.
 */
export function describeRequireHookRegression(
  hookPropertyMap: unknown,
): string | null {
  if (!(hookPropertyMap instanceof Map) || !hookPropertyMap.has('webpack')) {
    return null
  }
  return (
    "Next.js's require-hook gate changed: the `webpack` require-hook alias is " +
    'installed even though Storybook set `__NEXT_PRIVATE_RENDER_WORKER` to skip ' +
    "`loadWebpackHook()`. `require('webpack')` in your `next.config.webpack()`, " +
    '`webpackFinal`, or webpack addon code may now resolve to ' +
    '`next/dist/compiled/webpack` instead of your own webpack. See the ' +
    'storybook-next-rsbuild Shim Catalogue.'
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

  const { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD, COMPILER_NAMES } =
    constantsMod
  const { Span } = traceMod
  // ESM import of CJS module can create double-wrapped default; `as any`
  // because TS types the single-unwrapped `.default` as the function directly
  // (no further `.default`), but at runtime we defend against the wrapped form.
  const loadConfig = (configMod as any).default?.default || configMod.default
  const getBaseWebpackConfig =
    (webpackConfigMod as any).default?.default || webpackConfigMod.default
  const { loadProjectInfo } = webpackConfigMod

  // Load the config in the phase that MATCHES the build: `storybook dev` →
  // PHASE_DEVELOPMENT_SERVER (loads .env.development[.local]), `storybook build`
  // → PHASE_PRODUCTION_BUILD (loads .env.production[.local]). This makes
  // phase-conditional next.config functions and `@next/env` resolve the same
  // mode `getBaseWebpackConfig({ dev })` extracts, so a production Storybook no
  // longer inlines development env values. (This deliberately diverges from
  // upstream @storybook/nextjs, which always uses PHASE_DEVELOPMENT_SERVER.)
  const phase = configLoadPhase(dev, {
    PHASE_DEVELOPMENT_SERVER,
    PHASE_PRODUCTION_BUILD,
  })
  const nextConfig = await loadConfig(phase, projectDir)
  // Post-check the `__NEXT_PRIVATE_RENDER_WORKER` gate: `loadConfig` should have
  // skipped `loadWebpackHook()`, so the require-hook's `webpack` remap must be
  // absent. If Next changed the gate semantics, warn so a hijacked
  // `require('webpack')` is attributable. Non-fatal if the module path drifts.
  try {
    const requireHookMod: any = await import('next/dist/server/require-hook.js')
    const hookRegression = describeRequireHookRegression(
      requireHookMod.hookPropertyMap ?? requireHookMod.default?.hookPropertyMap,
    )
    if (hookRegression) logger.warn(hookRegression)
  } catch {}
  // Turbopack (Next 16's default bundler) config is not bridged — warn ONCE
  // naming the keys so a dropped SVGR-style loader setup is attributable.
  const turbopackWarning = describeUnbridgedTurbopackConfig(nextConfig)
  if (turbopackWarning) logger.warn(turbopackWarning)
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

  // Force Next.js's JS `next-swc-loader` branch by scrubbing BUILTIN_SWC_LOADER
  // for the extraction. When set (a next-rspack perf knob), Next emits
  // `builtin:next-swc-loader`, which standard @rspack/core panics on and which
  // our loader-chain builder cannot shim — so the bridge would silently degrade
  // to Rsbuild's built-in SWC. Save/restore so we don't leak the change.
  // See AGENTS.md § Shim Catalogue.
  const savedBuiltinSwcLoader = process.env.BUILTIN_SWC_LOADER
  delete process.env.BUILTIN_SWC_LOADER
  let rspackConfig: any
  try {
    rspackConfig = await getBaseWebpackConfig(projectDir, params)
  } finally {
    if (savedBuiltinSwcLoader === undefined) {
      delete process.env.BUILTIN_SWC_LOADER
    } else {
      process.env.BUILTIN_SWC_LOADER = savedBuiltinSwcLoader
    }
  }

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

  // Config provenance: `loadConfig` sets `configFile` to the absolute path of
  // the resolved next.config.* (undefined when none was found and Next.js fell
  // back to defaults). Surface it so a mis-rooted extraction is attributable.
  if (!nextConfig.configFile) {
    logger.warn(
      'No next.config file was found, so Next.js defaults are in effect. If a ' +
        'config was expected, set `framework.options.nextConfigPath` in ' +
        '.storybook/main.* to point at it (its directory is used as the root).',
    )
  }
  const provenance = nextConfig.configFile
    ? ` from ${nextConfig.configFile}`
    : ''
  logger.info(
    `Extracted Next.js rspack config${provenance}: ${Object.keys(alias).length} aliases, ` +
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
    imagesDisableStaticImports: nextConfig.images?.disableStaticImages ?? false,
    userDelta,
  }
}
