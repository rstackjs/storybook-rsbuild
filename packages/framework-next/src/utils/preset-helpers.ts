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

export function filterNextAliases(
  alias: Record<string, string | string[] | false>,
): Record<string, string | string[] | false> {
  const blocked = ['react', 'react-dom', 'react-server-dom-webpack']
  const filtered: Record<string, string | string[] | false> = {}
  for (const [key, value] of Object.entries(alias)) {
    if (blocked.some((b) => key === b || key.startsWith(`${b}/`))) continue
    filtered[key] = value
  }
  return filtered
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
 * Picking the "client" rule: Pages Router puts the loader chain at the top
 * level alongside `builtin:react-refresh-loader`. App Router emits multiple
 * nested rules under `oneOf` branches — some pair `next-swc-loader` with
 * `next-flight-loader` (RSC), others ship the plain client transform. We
 * prefer the plainest rule (just `next-swc-loader`, no flight pairings) since
 * Storybook stories run as client components.
 */
export function buildNextLoaderChain(
  rawRules: any[],
  shimPath: string,
): any[] | null {
  let plainSwcRule: any = null
  let anySwcRule: any = null
  walkRules(rawRules, (rule) => {
    const names = asUseArray(rule.use).map(loaderNameOf)
    const hasSwc = names.some(
      (n) => n === 'next-swc-loader' || n?.endsWith('/next-swc-loader'),
    )
    if (!hasSwc) return
    anySwcRule ??= rule
    const hasFlight = names.some((n) => n?.includes('next-flight'))
    if (!hasFlight && !plainSwcRule) plainSwcRule = rule
  })
  const clientRule = plainSwcRule ?? anySwcRule
  if (!clientRule) return null

  return asUseArray(clientRule.use).flatMap((use) => {
    const name = loaderNameOf(use)
    if (name === 'next-swc-loader' || name?.endsWith('/next-swc-loader')) {
      // Preserve Next.js's computed options verbatim — they already match the
      // build mode (dev extraction → refresh on; prod extraction → refresh off).
      return [{ loader: shimPath, options: use.options || {} }]
    }
    if (name?.includes('next-flight')) return []
    return [use]
  })
}

export function replaceSwcRules(rules: any[], nextChain: any[]): boolean {
  let replaced = false
  walkRules(rules, (rule) => {
    if (!rule.use) return
    let mutated = false
    const next = asUseArray(rule.use).flatMap((use) => {
      if (loaderNameOf(use) !== 'builtin:swc-loader') return [use]
      mutated = true
      return nextChain
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
 * - `CssExtractRspackPlugin`: drives the CSS pipeline; required for `next/font` target.css
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
export function dedupProvidePluginKeys(
  rsbuildPlugins: readonly any[] | undefined,
  nextPlugins: readonly any[],
): any[] {
  const rsbuildKeys = new Set<string>()
  for (const plugin of rsbuildPlugins ?? []) {
    if (!isProvidePlugin(plugin)) continue
    const provided = readProvidedMap(plugin)
    if (provided) {
      for (const k of Object.keys(provided)) rsbuildKeys.add(k)
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
      out.push(new plugin.constructor(filtered))
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
 * Matches the synthetic `…/next/font/{google,local}/target.css` module that
 * `next-swc` emits for every `next/font` call. Mirrors `@storybook/nextjs`'s
 * regex so the same paths route to our font loader (and are excluded from
 * Rsbuild's CSS pipeline). The character classes cover both POSIX and Windows
 * separators.
 */
export const TARGET_CSS_RE = /next(\\|\/|\\\\).*(\\|\/|\\\\)target\.css$/

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
 * win. Bare specifiers only; the `node:`-prefixed forms are dropped earlier by
 * `IgnoreNodeProtocolPlugin`. Sourced from `node:module`'s `builtinModules` so
 * every builtin is covered (`querystring`, `punycode`, `url`, ...) — a
 * hand-written allowlist drifts behind Node releases and creates "module not
 * found" errors for transitive deps importing obscure builtins.
 */
export const NODE_BUILTINS_FALLBACK: Record<string, false> = Object.fromEntries(
  builtinModules.map((m) => [m, false as const]),
)

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
