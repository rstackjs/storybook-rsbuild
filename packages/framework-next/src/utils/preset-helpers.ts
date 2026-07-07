/**
 * Pure helpers kept separate from `preset.ts` because `preset.ts` resolves
 * builder/loader paths at module load via `import.meta.resolve`, which is a
 * no-op under some test runtimes and would break direct imports from tests.
 */

import { builtinModules } from 'node:module'

function loaderNameOf(use: any): string | null {
  if (typeof use === 'string') return use
  if (typeof use === 'object' && use !== null) return use.loader ?? null
  return null
}

function asUseArray(use: any): any[] {
  if (!use) return []
  return Array.isArray(use) ? use : [use]
}

export function walkRules(
  rules: any[] | undefined,
  fn: (rule: any) => void,
): void {
  if (!rules) return
  for (const rule of rules) {
    if (!rule || typeof rule !== 'object') continue
    fn(rule)
    if (rule.oneOf) walkRules(rule.oneOf, fn)
    if (Array.isArray(rule.rules)) walkRules(rule.rules, fn)
  }
}

/**
 * Strip at most one trailing `$` (webpack/rspack exact-match marker) so a key's
 * base name can be compared against a block/allow list. `react$` → `react`,
 * `styled-jsx/style$` → `styled-jsx/style`, `react$$` → `react$` (only one `$`
 * removed, so a pathological double-marker is not accidentally matched).
 */
function stripExactMatchMarker(key: string): string {
  return key.endsWith('$') ? key.slice(0, -1) : key
}

export function filterNextAliases(
  alias: Record<string, string | string[] | false>,
): Record<string, string | string[] | false> {
  const blocked = ['react', 'react-dom', 'react-server-dom-webpack']
  const filtered: Record<string, string | string[] | false> = {}
  for (const [key, value] of Object.entries(alias)) {
    // Compare against the base name so webpack's exact-match spelling
    // (`react$`, `react-dom$`, `react/jsx-runtime$`) is dropped too — a user
    // `next.config.webpack()` alias like `react$: 'preact/compat'` would
    // otherwise slip past and split the React identity.
    const bare = stripExactMatchMarker(key)
    if (blocked.some((b) => bare === b || bare.startsWith(`${b}/`))) continue
    filtered[key] = value
  }
  return filtered
}

/**
 * Framework-reserved alias keys whose resolution the framework must own: the
 * `next/image` mock and the `styled-jsx` singleton (`styled-jsx`,
 * `styled-jsx/style`, …). A user `next.config.webpack()` alias delta spelled
 * with the same key — plain or `$`-exact — would otherwise silently override the
 * mock (broken `/_next/image` requests) or split the styled-jsx identity. Base
 * name is compared so both `next/image` and `next/image$` are caught.
 */
export function isProtectedFrameworkAliasKey(key: string): boolean {
  const bare = stripExactMatchMarker(key)
  return (
    bare === 'next/image' ||
    bare === 'styled-jsx' ||
    bare.startsWith('styled-jsx/')
  )
}

type AliasMap = Record<string, string | string[] | false>

export interface AliasLayers {
  /** Final alias map. */
  alias: AliasMap
  /** User-delta keys dropped to preserve the React singleton (warn per key). */
  droppedReactKeys: string[]
  /** User-delta keys dropped to preserve the next/image mock / styled-jsx (warn). */
  droppedProtectedKeys: string[]
}

/**
 * Assemble `resolve.alias` in precedence order, keeping framework-critical
 * aliases from being shadowed. `overrides` (STORYBOOK_OVERRIDE_ALIASES) is spread
 * FIRST because rspack matches aliases in strict insertion order, so a surviving
 * base/user key can't intercept an exact request the mock/singleton must own.
 * React/RSC keys are stripped from both `base` and `userDelta`
 * (`filterNextAliases`); next/image + styled-jsx keys are stripped from
 * `userDelta` (reported) and silently from `base` (Next.js's own entries, not
 * user additions). Returns the dropped user-delta keys so the caller can warn —
 * keeping this layering a pure, testable seam.
 */
export function buildAliasLayers(
  base: AliasMap,
  userDelta: AliasMap,
  overrides: AliasMap,
): AliasLayers {
  const filteredUser = filterNextAliases(userDelta)
  const droppedReactKeys = Object.keys(userDelta).filter(
    (k) => !(k in filteredUser),
  )
  const droppedProtectedKeys: string[] = []
  for (const k of Object.keys(filteredUser)) {
    if (isProtectedFrameworkAliasKey(k)) {
      delete filteredUser[k]
      droppedProtectedKeys.push(k)
    }
  }
  const filteredBase = filterNextAliases(base)
  for (const k of Object.keys(filteredBase)) {
    if (isProtectedFrameworkAliasKey(k)) delete filteredBase[k]
  }
  return {
    alias: { ...overrides, ...filteredBase, ...filteredUser },
    droppedReactKeys,
    droppedProtectedKeys,
  }
}

/**
 * Build a Storybook loader chain from Next.js's client JS rule:
 * swap `next-swc-loader` for our shim (strips `pitch` that breaks virtual
 * modules), drop server-only `next-flight-*`, and pass everything else through
 * unchanged — notably `builtin:react-refresh-loader`, which Next.js only emits
 * into the dev `rawRules`.
 *
 * Mode-correctness is free because we extract in the matching mode: `preset.ts`
 * calls `getBaseWebpackConfig({ dev: !isProduction })`, so the SWC options
 * (`dev` / `hasReactRefresh`) and the presence of the refresh loader already
 * reflect the build mode. No post-hoc prod stripping is needed.
 *
 * Picking the "client" rule: Next.js emits several `next-swc-loader` rules —
 * RSC rules pair it with `next-flight-*`, the `issuerLayer: 'api-node'`
 * API-route rule ships it alone, and the real client rule pairs it with
 * `builtin:react-refresh-loader`. We must reach the right one by the SAME
 * criterion in both modes (never by walk order):
 *   - `refresh`: paired with `builtin:react-refresh-loader` — the dev client
 *     rule. Only this rule carries the per-module Fast Refresh footer (the
 *     `module.hot.accept` self-accept).
 *   - `bare`: non-flight, with NEITHER an `issuerLayer` (string or function) NOR
 *     a `resourceQuery`. This uniquely selects Next.js's pages catch-all rule —
 *     the client target in prod, where Next.js emits no refresh loader at all.
 *   - `plain`: first non-flight rule that DID carry a layer/query (the
 *     `issuerLayer: 'api-node'`/`'api-edge'` server rules, the edge-ssr
 *     `resourceQuery` rule, …). A degraded fallback: these compile on a SERVER
 *     layer, so `serverComponents: false` / `server-only` validation semantics
 *     differ from a real `next build`.
 *   - `any`: last resort — any SWC-bearing rule at all, even flight-paired.
 * Precedence is `refresh` → `bare` → `plain` → `any`. Picking a refresh-less
 * rule in DEV (the bug this guards against: the `api-node` rule sorts before the
 * client rule) serves stories without the footer, so SWC's
 * `$RefreshReg$`/`$RefreshSig$` calls bind to the no-op globals in
 * `react-refresh-entry.cjs`, nothing self-accepts, and edits remount the
 * component — losing React state (plain HMR, not Fast Refresh). Picking a
 * layered `plain` rule in PROD compiles client stories down a server path.
 */
/**
 * Whether a loader name refers to Next.js's JS `next-swc-loader`, tolerant of
 * both POSIX and Windows separators (`.../loaders/next-swc-loader`,
 * `...\\loaders\\next-swc-loader`). Mirrors `TARGET_CSS_RE`'s both-separators
 * standard. Deliberately does NOT match `builtin:next-swc-loader` — that variant
 * (emitted when `BUILTIN_SWC_LOADER` is set) has a different options schema and
 * panics on standard `@rspack/core`; it is detected separately and warned about.
 */
const NEXT_SWC_LOADER_RE = /(^|[\\/])next-swc-loader$/
export function isNextSwcLoaderName(name: string | null | undefined): boolean {
  return !!name && NEXT_SWC_LOADER_RE.test(name)
}

export type SwcRuleTier = 'refresh' | 'bare' | 'plain' | 'any'

export interface SwcRuleSelection {
  /** The chosen client `next-swc-loader` rule, or `null` if none exists. */
  clientRule: any | null
  /** Which selection tier the chosen rule came from (`null` when none). */
  tier: SwcRuleTier | null
  /**
   * The chosen rule's `issuerLayer` (string or function), or `null` when the
   * rule has none / no rule was selected. Surfaced so `preset.ts` can name the
   * server layer in its prod-degradation warning without re-walking the rules.
   */
  clientIssuerLayer: string | ((...args: any[]) => any) | null
  /**
   * Whether a `builtin:next-swc-loader` rule was seen. Emitted by Next.js when
   * `BUILTIN_SWC_LOADER` is set; we can't shim it, so its presence explains a
   * `null` chain and drives an actionable warning in `preset.ts`.
   */
  sawBuiltinSwcLoader: boolean
}

/**
 * Single source of truth for picking the client `next-swc-loader` rule out of
 * Next.js's emitted rules. Shared by `buildNextLoaderChain` (returns the chain)
 * and `analyzeNextLoaderChain` (returns diagnostics) so the two can't drift.
 * See `buildNextLoaderChain`'s doc for why the refresh-paired rule is preferred.
 */
function selectClientSwcRule(rawRules: any[]): SwcRuleSelection {
  let refreshSwcRule: any = null
  let bareSwcRule: any = null
  let plainSwcRule: any = null
  let anySwcRule: any = null
  let sawBuiltinSwcLoader = false
  walkRules(rawRules, (rule) => {
    const names = asUseArray(rule.use).map(loaderNameOf)
    if (names.some((n) => n === 'builtin:next-swc-loader')) {
      sawBuiltinSwcLoader = true
    }
    const hasSwc = names.some(isNextSwcLoaderName)
    if (!hasSwc) return
    anySwcRule ??= rule
    if (names.some((n) => n?.includes('next-flight'))) return
    if (names.some((n) => n?.includes('react-refresh-loader'))) {
      refreshSwcRule ??= rule
    } else if (rule.issuerLayer == null && rule.resourceQuery == null) {
      // The pages catch-all: no layer, no query. In prod (no refresh loader) this
      // is the real client rule; a layered rule (`api-node`, edge-ssr query, …)
      // would compile client stories on a server layer.
      bareSwcRule ??= rule
    } else {
      plainSwcRule ??= rule
    }
  })
  // Single precedence source: refresh-paired rule wins, then the bare pages
  // catch-all, then a layered/queried SWC rule, then any SWC rule at all.
  // `clientRule` and `tier` must never disagree.
  const tiers: Array<[SwcRuleTier, any]> = [
    ['refresh', refreshSwcRule],
    ['bare', bareSwcRule],
    ['plain', plainSwcRule],
    ['any', anySwcRule],
  ]
  const selected = tiers.find(([, rule]) => rule)
  return {
    clientRule: selected?.[1] ?? null,
    tier: selected?.[0] ?? null,
    clientIssuerLayer: selected?.[1]?.issuerLayer ?? null,
    sawBuiltinSwcLoader,
  }
}

export function buildNextLoaderChain(
  rawRules: any[],
  shimPath: string,
): any[] | null {
  const { clientRule } = selectClientSwcRule(rawRules)
  if (!clientRule) return null

  return asUseArray(clientRule.use).flatMap((use) => {
    const name = loaderNameOf(use)
    if (isNextSwcLoaderName(name)) {
      // Preserve Next.js's computed options verbatim — they already match the
      // build mode (dev extraction → refresh on; prod extraction → refresh off).
      return [{ loader: shimPath, options: use.options || {} }]
    }
    if (name?.includes('next-flight')) return []
    return [use]
  })
}

/**
 * Pure diagnostics companion to `buildNextLoaderChain`, reusing the same
 * selector. `tier` tells the caller which rule was chosen — the dev client rule
 * (`'refresh'`), the prod pages catch-all (`'bare'`), or a degraded fallback
 * (`'plain'`/`'any'`); `clientIssuerLayer` names the chosen rule's server layer
 * (if any) for prod-degradation warnings, and `sawBuiltinSwcLoader` explains a
 * `null` chain. `preset.ts` gates warnings on these without duplicating the walk.
 */
export function analyzeNextLoaderChain(rawRules: any[]): {
  tier: SwcRuleTier | null
  clientIssuerLayer: string | ((...args: any[]) => any) | null
  sawBuiltinSwcLoader: boolean
} {
  const { tier, clientIssuerLayer, sawBuiltinSwcLoader } =
    selectClientSwcRule(rawRules)
  return { tier, clientIssuerLayer, sawBuiltinSwcLoader }
}

/**
 * Drop `builtin:react-refresh-loader` from a loader chain. Used for rules that
 * match by `mimetype` (inline / `data:` JS) — see `replaceSwcRules`.
 */
function stripReactRefreshLoader(chain: any[]): any[] {
  return chain.filter(
    (use) => !loaderNameOf(use)?.includes('react-refresh-loader'),
  )
}

export function replaceSwcRules(rules: any[], nextChain: any[]): boolean {
  let replaced = false
  walkRules(rules, (rule) => {
    if (!rule.use) return
    // A `mimetype` rule (no file `test`) matches inline modules — `data:` URIs and
    // virtual JS. Rsbuild's `text/javascript` mimetype rule also catches
    // html-rspack-plugin's synthetic `data:text/javascript,__webpack_public_path__…`
    // entry, which its child compiler evaluates in a Node `vm`. A Fast Refresh
    // footer there dereferences `__webpack_require__.c` (absent in that bare
    // runtime) and crashes `storybook dev` outright (no module cache → TypeError).
    // Inline `data:` JS never needs Fast Refresh, so swap in a refresh-less chain
    // for mimetype rules; real source (file `test` rules) keeps the footer.
    const chain =
      rule.mimetype != null ? stripReactRefreshLoader(nextChain) : nextChain
    let mutated = false
    const next = asUseArray(rule.use).flatMap((use) => {
      if (loaderNameOf(use) !== 'builtin:swc-loader') return [use]
      mutated = true
      return chain
    })
    if (mutated) {
      rule.use = next
      replaced = true
    }
  })
  return replaced
}

/**
 * Allowlist of Next.js plugins to inject into Storybook. Allowlist (not
 * denylist) because Next.js adds/renames plugins across versions and an
 * unknown new plugin may write to disk, throw, or pollute the bundle.
 * - `CssExtractRspackPlugin`: Next's CSS-extract plugin, kept defensively. It is
 *   inert in practice — Rsbuild owns the CSS pipeline and `next/font` is injected
 *   at runtime by the font loader, so no Next.js CSS rules ever feed it.
 * - `ProvidePlugin` / `RspackProvidePlugin`: defines globals like `Buffer` /
 *   `process` that browser-built Node libs (next-auth, openid-client, ...)
 *   rely on. Rsbuild doesn't auto-provide these, so without keeping Next.js's
 *   `ProvidePlugin` such libs throw `Buffer is not defined` at story render
 *   time even though the build succeeds.
 * - `ReactRefreshRspackPlugin`: provides `$ReactRefreshRuntime$` via ProvidePlugin
 *   (complements our `ReactRefreshInitPlugin` which handles the `injectIntoGlobalHook`
 *   bootstrap). Naturally dev-only: we extract with `dev: !isProduction`, so
 *   Next.js omits this plugin from the prod `rawPlugins` — no explicit gating needed.
 */
export const KEEP_PLUGIN_NAMES = new Set([
  'CssExtractRspackPlugin',
  'ProvidePlugin',
  'ReactRefreshRspackPlugin',
  'RspackProvidePlugin',
])

const PROVIDE_PLUGIN_NAMES = new Set(['ProvidePlugin', 'RspackProvidePlugin'])

function isProvidePlugin(plugin: any): boolean {
  return PROVIDE_PLUGIN_NAMES.has(plugin?.constructor?.name)
}

/**
 * Read a webpack/rspack plugin's `{ key: spec }` definitions map. Works for
 * ProvidePlugin and DefinePlugin alike: webpack stores definitions on a
 * public `.definitions` property, rspack's JS wrapper stashes the
 * constructor arg on `._args[0]`. Returns `null` when neither shape applies.
 */
export function readProvidedMap(plugin: any): Record<string, unknown> | null {
  const definitions = plugin?.definitions
  if (definitions && typeof definitions === 'object') return definitions
  const arg = plugin?._args?.[0]
  return arg && typeof arg === 'object' ? arg : null
}

/**
 * Strip ProvidePlugin keys from Next.js's instance that Rsbuild already
 * provides. Rspack warns on any duplicate ProvidePlugin key whose value
 * differs from a previous registration, and Rsbuild ships `process` with a
 * pre-resolved path while Next.js declares it with a bare `['process']`
 * specifier — same key, different value. Dropping the overlap keeps
 * Next.js's additive entries (notably `Buffer`, which `next-auth` /
 * `openid-client` rely on at story render time).
 */
/**
 * Rebuild a ProvidePlugin with a filtered definitions map, carrying any trailing
 * constructor args through unchanged. When the map was read from rspack's
 * internal `_args`, `_args.slice(1)` preserves extra ctor args; the public
 * `.definitions` (webpack) shape has no `_args`, so it degrades to a single-arg
 * reconstruction.
 */
function reconstructProvidePlugin(
  plugin: any,
  filtered: Record<string, unknown>,
): any {
  const trailing = Array.isArray(plugin?._args) ? plugin._args.slice(1) : []
  return new plugin.constructor(filtered, ...trailing)
}

export function dedupProvidePluginKeys(
  rsbuildPlugins: readonly any[] | undefined,
  nextPlugins: readonly any[],
  onUnreadable?: (plugin: any, side: 'rsbuild' | 'next') => void,
): any[] {
  const rsbuildKeys = new Set<string>()
  for (const plugin of rsbuildPlugins ?? []) {
    if (!isProvidePlugin(plugin)) continue
    const provided = readProvidedMap(plugin)
    if (provided) {
      for (const k of Object.keys(provided)) rsbuildKeys.add(k)
    } else {
      // Same fragile `_args[0]` read the DefinePlugin extraction warns about;
      // surface it here too so a future rspack wrapper-shape change is
      // attributable instead of silently disabling dedup.
      onUnreadable?.(plugin, 'rsbuild')
    }
  }
  const out: any[] = []
  for (const plugin of nextPlugins) {
    if (!isProvidePlugin(plugin)) {
      out.push(plugin)
      continue
    }
    const provided = readProvidedMap(plugin)
    if (!provided) {
      onUnreadable?.(plugin, 'next')
      out.push(plugin)
      continue
    }
    let dropped = 0
    const filtered: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(provided)) {
      if (rsbuildKeys.has(k)) dropped++
      else filtered[k] = v
    }
    if (dropped === 0) {
      out.push(plugin)
    } else if (Object.keys(filtered).length > 0) {
      out.push(reconstructProvidePlugin(plugin, filtered))
    }
  }
  return out
}

export function filterNextPlugins(rawPlugins: any[]): any[] {
  return rawPlugins.filter((plugin) => {
    const name = plugin?.constructor?.name
    return !!name && KEEP_PLUGIN_NAMES.has(name)
  })
}

/* -------------------------------------------------------------------------- */
/* CSS URL handling                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Matches the synthetic `…/(next|@next)/font/**\/target.css` module that
 * `next-swc` emits for every `next/font` call. Deliberately *tighter* than
 * `@storybook/nextjs`'s upstream regex (which only requires `next<sep>…<sep>
 * target.css`): without a left boundary and a `font` segment, upstream also
 * matches a user stylesheet named `target.css` under any dir named `next`
 * (e.g. a project rooted at `~/projects/next/` or a `src/mynext/` folder),
 * which would wrongly route it to the font loader and crash with an
 * unattributable JSON error. We anchor on the real module shape: a path
 * separator (or string start), then `next`/`@next`, then `font`, then any
 * subdir, ending in `target.css`. The separator class covers POSIX `/`,
 * Windows `\`, and double-escaped `\\`.
 */
export const TARGET_CSS_RE =
  /(^|\\|\/|\\\\)@?next(\\|\/|\\\\)font(\\|\/|\\\\).*target\.css$/

/**
 * Root-absolute (`/fonts/x.css`, `/images/y.png`) and scheme-absolute
 * (`https://…`, `data:…`) URLs reference assets served at runtime, not modules
 * to bundle. Next.js's CSS loaders pass them through unresolved (via
 * `cssFileResolve`); Rsbuild's css-loader, left to its defaults, tries to
 * resolve `/…` against the filesystem and fails the build. We mirror Next.js by
 * skipping them in `tools.cssLoader`.
 */
export const isRuntimeCssUrl = (url: string): boolean =>
  url.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(url)

/**
 * Merge a runtime-URL passthrough `filter` into a css-loader `url`/`import`
 * option, preserving any object form Rsbuild/the user already set (a boolean or
 * `undefined` is replaced wholesale). Shared by both options in `tools.cssLoader`
 * so the predicate lives in one place — see `isRuntimeCssUrl`.
 */
export const withRuntimeUrlFilter = (existing: unknown) => ({
  ...(typeof existing === 'object' && existing !== null ? existing : {}),
  filter: (url: string) => !isRuntimeCssUrl(url),
})

/* -------------------------------------------------------------------------- */
/* Module rule factories                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Rule that routes `next/font`'s synthetic `target.css` to our font loader as a
 * JS module (runtime `<style>` injection + `{ className, style }`), so it must
 * be parsed as JS rather than handed to rspack's CSS handling. `loaderPath` is
 * resolved by `preset.ts` (via `import.meta.resolve`) and passed in to keep this
 * factory pure/testable.
 */
export function makeFontRule(loaderPath: string) {
  return { test: TARGET_CSS_RE, loader: loaderPath, type: 'javascript/auto' }
}

/**
 * Rule that routes `optimizePackageImports`' `__barrel_optimize__?names=…!=!<pkg>`
 * matchResource through the Next.js SWC loader chain. The `!=!` matchResource is
 * what rule-matching keys off, so the request never hits Rsbuild's `.tsx?`/`.js`
 * rule — the real (often TS) barrel source would otherwise be parsed as plain JS
 * and throw. Returns `null` when there is no SWC chain (Next.js bridge absent).
 */
export function makeBarrelRule(
  nextLoaderChain: any[] | null,
): { test: RegExp; use: any[] } | null {
  return nextLoaderChain
    ? { test: /__barrel_optimize__/, use: nextLoaderChain }
    : null
}

/* -------------------------------------------------------------------------- */
/* resolve.fallback merge                                                     */
/* -------------------------------------------------------------------------- */

type FallbackValue = string | string[] | false | (string | false)[]
export type FallbackMap = Record<string, FallbackValue>

/**
 * Node builtins floor — every builtin mapped to `false`. Merged *under* Next.js's
 * `resolve.fallback` (see `mergeFallback`) so Next.js-supplied polyfills still
 * win. Bare specifiers only; `node:`-prefixed imports are normalized to these
 * bare names earlier by `StripNodeProtocolPlugin` (preset.ts) before resolution,
 * so they land on this same floor. Sourced from `node:module`'s `builtinModules`
 * so
 * every builtin is covered (`querystring`, `punycode`, `url`, ...) — a
 * hand-written allowlist drifts behind Node releases and creates "module not
 * found" errors for transitive deps importing obscure builtins.
 */
export const NODE_BUILTINS_FALLBACK: Record<string, false> = Object.fromEntries(
  builtinModules.map((m) => [m, false as const]),
)

/**
 * Maps a `node:`-prefixed import to the specifier it should resolve to in the
 * browser bundle (used by `StripNodeProtocolPlugin` in preset.ts):
 *   - known builtin (`node:path`) → bare name (`path`), caught by
 *     `NODE_BUILTINS_FALLBACK`'s `false` floor or a Next.js-supplied polyfill;
 *   - `node:`-only specifier with no bare counterpart (`node:sqlite`,
 *     `node:test`) → `emptyModule`, so a dead server-only import doesn't surface
 *     as a "Can't resolve 'sqlite'" build failure;
 *   - any non-`node:` request → returned unchanged.
 *
 * Stripping the scheme *before* resolution is required because rspack's native
 * `node:` scheme handler runs ahead of `resolve.fallback`, so a
 * `resolve.fallback['node:path']` entry never gets consulted.
 */
export const resolveNodeProtocolRequest = (
  request: string,
  emptyModule: string,
): string => {
  if (!request.startsWith('node:')) return request
  const bare = request.slice('node:'.length)
  return bare in NODE_BUILTINS_FALLBACK ? bare : emptyModule
}

/**
 * Layer `resolve.fallback` in precedence order (later generally wins):
 *   1. `builtinFloor`    every Node builtin → `false`
 *   2. `rsbuildFallback` Rsbuild defaults / user `tools.rspack` overrides
 *   3. `nextFallback`    Next.js's polyfills — applied ONLY where the running
 *      value is `false` or unset. Rsbuild defaults `fs`/`stream`/`assert`/… to
 *      `false` even on browser builds, which would suppress Next.js's polyfills
 *      (`stream-browserify`, `buffer`, `util`) and break libs like Victory that
 *      import `readable-stream`. Letting Next.js win over a `false` is
 *      restorative; a non-`false` user entry is real intent we must preserve.
 *   4. `userFallback`    `next.config.webpack` delta — the final word.
 */
export function mergeFallback(
  builtinFloor: FallbackMap,
  rsbuildFallback: FallbackMap | undefined,
  nextFallback: FallbackMap,
  userFallback: FallbackMap,
): FallbackMap {
  const fallback: FallbackMap = { ...builtinFloor, ...rsbuildFallback }
  for (const [k, v] of Object.entries(nextFallback)) {
    if (fallback[k] === false || fallback[k] === undefined) fallback[k] = v
  }
  Object.assign(fallback, userFallback)
  return fallback
}

/* -------------------------------------------------------------------------- */
/* Rule dedup signature                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Stable signature for deduping rules by their `test`. Only RegExp tests are
 * comparable — `RegExp.toString()` (e.g. `/\.svg$/`). `{ and: […] }` /
 * `{ or: […] }` shapes would collapse to `[object Object]` and cross-match
 * unrelated rules, so they (and string/function tests) return `null`, meaning
 * "not comparable" — the caller then leaves such rules untouched.
 */
export function ruleTestSignature(rule: any): string | null {
  return rule?.test instanceof RegExp ? rule.test.toString() : null
}

/**
 * Narrowing condition keys that scope a rule to a subset of modules. Two rules
 * with the same `test` but different values here target disjoint module sets and
 * must NOT be deduped against each other.
 */
const NARROWING_CONDITION_KEYS = [
  'include',
  'exclude',
  'issuer',
  'issuerLayer',
  'resourceQuery',
  'resourceFragment',
  'resource',
  'type',
] as const

/**
 * Stable signature for a single condition value, or `null` when the value is not
 * safely comparable (a function or a plain-object matcher). RegExps compare by
 * source, strings verbatim, arrays element-wise. A `null` result forces callers
 * to treat the pair as non-congruent (i.e. do not dedup).
 */
function conditionSignature(value: unknown): string | null {
  if (value == null) return '∅'
  if (value instanceof RegExp) return `re:${value.toString()}`
  if (typeof value === 'string') return `s:${value}`
  if (Array.isArray(value)) {
    const parts = value.map(conditionSignature)
    if (parts.some((p) => p === null)) return null
    return `[${parts.join(',')}]`
  }
  return null
}

/**
 * Whether two rules would genuinely double-process the same modules — i.e. they
 * share the same RegExp `test` AND carry identical (or identically-absent)
 * narrowing conditions. Only then is dropping one a correct dedup; a rule that
 * scopes itself via `include`/`resourceQuery`/`issuer`/… coexists with a
 * bare-`test` rule because rspack fuses loader chains only when the FULL
 * condition set matches the same request. Non-comparable conditions (functions,
 * object matchers) yield `false` — keep both.
 */
export function rulesCongruentForDedup(a: any, b: any): boolean {
  const sigA = ruleTestSignature(a)
  const sigB = ruleTestSignature(b)
  if (!sigA || !sigB || sigA !== sigB) return false
  for (const key of NARROWING_CONDITION_KEYS) {
    const aHas = a?.[key] !== undefined
    const bHas = b?.[key] !== undefined
    if (!aHas && !bHas) continue
    if (aHas !== bHas) return false
    const csa = conditionSignature(a[key])
    const csb = conditionSignature(b[key])
    if (csa === null || csb === null || csa !== csb) return false
  }
  return true
}

/* -------------------------------------------------------------------------- */
/* Sass preflight probe                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Whether a `rules` array (recursing into `oneOf`/`rules`) already handles Sass,
 * either by a `test` RegExp that matches `.scss` or by a rule whose loader chain
 * references `sass-loader`. Loader names are read structurally (string / object
 * `.loader` / array of those) — never via `JSON.stringify`, which returns
 * `undefined` for a function-shaped `use` (legal rspack config) and makes
 * `.includes` throw, and which throws outright on circular loader options. A
 * function-shaped `use` is treated as opaque (not Sass) rather than crashing the
 * build this preflight only exists to *explain*.
 */
export function rulesHandleSass(rules: unknown): boolean {
  if (!Array.isArray(rules)) return false
  return rules.some((rule: any) => {
    if (!rule || typeof rule !== 'object') return false
    if (rule.test instanceof RegExp && rule.test.test('a.scss')) return true
    const names = [
      ...asUseArray(rule.use).map(loaderNameOf),
      loaderNameOf(rule.loader),
    ]
    if (names.some((n) => typeof n === 'string' && n.includes('sass-loader'))) {
      return true
    }
    return rulesHandleSass(rule.oneOf) || rulesHandleSass(rule.rules)
  })
}
