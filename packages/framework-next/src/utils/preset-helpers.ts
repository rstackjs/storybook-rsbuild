/**
 * Pure helpers kept separate from `preset.ts` because `preset.ts` resolves
 * builder/loader paths at module load via `import.meta.resolve`, which is a
 * no-op under some test runtimes and would break direct imports from tests.
 */

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
 * keep `builtin:react-refresh-loader`, swap `next-swc-loader` for our shim
 * (strips `pitch` that breaks virtual modules), drop server-only `next-flight-*`.
 *
 * In production (`isDev: false`), drop `builtin:react-refresh-loader` and force
 * `next-swc-loader.options.dev = false`. Next.js's extraction always runs in
 * dev mode, so without this its dev-only injections leak into prod bundles.
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
  { isDev }: { isDev: boolean } = { isDev: true },
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
    if (name === 'builtin:react-refresh-loader') {
      return isDev ? [use] : []
    }
    if (name === 'next-swc-loader' || name?.endsWith('/next-swc-loader')) {
      const options = use.options || {}
      // In prod, `next-swc-loader` must not emit React Refresh runtime calls:
      // - `dev: false` turns off dev-time hot-reload transforms
      // - `hasReactRefresh: false` prevents the loader from injecting
      //   `$ReactRefreshRuntime$` references that resolve to nothing once we
      //   drop `ReactRefreshRspackPlugin` (DEV_ONLY) from the prod plugin set
      // Without the second flag, prod bundles fail at runtime with
      // `$ReactRefreshRuntime$ is not defined` — the symptom only surfaces in
      // the browser, not in `storybook build`, so it's easy to miss in CI.
      const adjusted = isDev
        ? options
        : { ...options, dev: false, hasReactRefresh: false }
      return [{ loader: shimPath, options: adjusted }]
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
 * Prod-only sanitization: Next.js's `getBaseWebpackConfig()` is called in dev
 * mode (see `utils/next-config.ts`), so every `oneOf` branch under the client
 * rule — including barrel-optimize and other secondary chains — bakes in
 * `builtin:react-refresh-loader` + `hasReactRefresh: true`. `buildNextLoaderChain`
 * + `replaceSwcRules` already neutralize the primary client chain; this pass
 * catches the remaining co-extracted branches that survive into `rspackConfig`.
 *
 * Without this, prod bundles still emit `$ReactRefreshRuntime$.refresh(...)`
 * calls (via barrel-optimize compilations of `@mui/*`/`lodash`/...), but the
 * `ReactRefreshRspackPlugin` we relied on to provide `$ReactRefreshRuntime$`
 * is gated `DEV_ONLY` — symptom is a silent build followed by every story
 * throwing `$ReactRefreshRuntime$ is not defined` at iframe load.
 *
 * Convergent: one walk, one rule, "in prod nobody emits HMR runtime calls."
 */
export function sanitizeReactRefreshForProd(rules: any[]): void {
  let removed = 0
  let patched = 0
  walkRules(rules, (rule) => {
    if (!rule.use) return
    rule.use = asUseArray(rule.use)
      .filter((use) => {
        const drop = loaderNameOf(use) === 'builtin:react-refresh-loader'
        if (drop) removed++
        return !drop
      })
      .map((use) => {
        const name = loaderNameOf(use)
        if (
          name?.endsWith('next-swc-loader') ||
          name?.endsWith('swc-loader-shim.cjs')
        ) {
          patched++
          const useObj =
            typeof use === 'object' && use !== null ? use : { loader: name }
          return {
            ...useObj,
            options: { ...(useObj.options || {}), hasReactRefresh: false },
          }
        }
        return use
      })
  })
  // eslint-disable-next-line no-console
  console.error(
    `[storybook-next-rsbuild] prod sanitize: -${removed} refresh-loader, ~${patched} swc-loader options patched`,
  )
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
 *   (complements our `ReactRefreshInitPlugin` which handles the `injectIntoGlobalHook` bootstrap)
 */
export const KEEP_PLUGIN_NAMES = new Set([
  'CssExtractRspackPlugin',
  'ProvidePlugin',
  'ReactRefreshRspackPlugin',
  'RspackProvidePlugin',
])

/** Plugins from {@link KEEP_PLUGIN_NAMES} that must NOT leak into prod builds. */
const DEV_ONLY_PLUGIN_NAMES = new Set(['ReactRefreshRspackPlugin'])

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

export function filterNextPlugins(
  rawPlugins: any[],
  { isDev }: { isDev: boolean } = { isDev: true },
): any[] {
  return rawPlugins.filter((plugin) => {
    const name = plugin?.constructor?.name
    if (!name || !KEEP_PLUGIN_NAMES.has(name)) return false
    if (!isDev && DEV_ONLY_PLUGIN_NAMES.has(name)) return false
    return true
  })
}

const CSS_LOADER_MARKERS = [
  'css-loader',
  'postcss-loader',
  'lightningcss-loader',
  'sass-loader',
  'less-loader',
  'resolve-url-loader',
  'next-font-loader',
  'next-flight-css-loader',
  'next-style-loader',
  'mini-css-extract',
  'CssExtract',
]

const CSS_TEST_RE = /\.(css|s[ac]ss|less|styl)|target\.css/

function isCssLoaderUse(use: any): boolean {
  const name = loaderNameOf(use)
  return !!name && CSS_LOADER_MARKERS.some((m) => name.includes(m))
}

function isNextFontLoader(use: any): boolean {
  const name = loaderNameOf(use)
  return name === 'next-font-loader' || !!name?.endsWith('/next-font-loader')
}

function isCssRule(rule: any): boolean {
  if (!rule || typeof rule !== 'object') return false

  if (isCssLoaderUse(rule) || asUseArray(rule.use).some(isCssLoaderUse)) {
    return true
  }
  if (rule.oneOf?.some(isCssRule)) return true
  if (rule.rules?.some(isCssRule)) return true

  if (rule.test) {
    const patterns = Array.isArray(rule.test) ? rule.test : [rule.test]
    const source = patterns
      .map((t: any) => (t instanceof RegExp ? t.source : String(t)))
      .join('|')
    if (CSS_TEST_RE.test(source)) return true
  }

  return false
}

function isErrorLoaderUse(use: any): boolean {
  const name = loaderNameOf(use)
  return typeof name === 'string' && name.includes('error-loader')
}

const BARREL_TEST_RE = /__barrel_optimize__/
const BARREL_NARROWED_TEST = /__barrel_optimize__/

function flattenTestParts(test: any): any[] {
  if (!test) return []
  if (Array.isArray(test)) return test
  if (typeof test === 'object' && Array.isArray(test.or)) return test.or
  return [test]
}

/**
 * `next/dist/build/swc/options` rewrites `import { x } from '@scope/pkg'` into
 * `import { x } from '__barrel_optimize__?names=x!=!@scope/pkg'` when
 * `optimizePackageImports` is enabled (default for many libs in Next 15+).
 * The synthetic specifier needs Next.js's own JS rule chain to resolve — without
 * it, rspack reports "no loader for this file type" on every MUI/lodash import.
 */
function isBarrelOptimizeRule(rule: any): boolean {
  return flattenTestParts(rule?.test).some((t) => {
    if (typeof t === 'string') return t.includes('__barrel_optimize__')
    if (t instanceof RegExp) return BARREL_TEST_RE.test(t.source)
    return false
  })
}

/**
 * Strip Next.js's `_app.js`-only Pages-Router CSS guards.
 *
 * Next.js's CSS rule chain has two restrictions that don't apply to Storybook:
 *
 * 1. An `error-loader` branch that throws "Global CSS cannot be imported from
 *    files other than your Custom <App>". Storybook has no `_app.js`, so any
 *    `import './globals.css'` from `preview.tsx` would hit it.
 * 2. The remaining `oneOf` branches restrict by `issuer` (pages/_app.js or
 *    node_modules). Storybook imports match neither, so without stripping
 *    `issuer` rspack falls back to JS-parsing the .css file.
 *
 * Applied recursively before `prepareNextCssRules` consumes the chain.
 */
function stripNextCssRestrictions(rule: any): any {
  if (!rule || typeof rule !== 'object') return rule
  if (Array.isArray(rule.oneOf)) {
    // Next.js's client rule mixes CSS branches with JS branches (`next-swc-loader`,
    // `next-flight-loader`) under one `oneOf`. Pulling the whole rule into Storybook
    // makes the JS branches re-run our SWC chain on TSX files, producing duplicate
    // `$RefreshSig$` declarations. Keep only branches that are themselves CSS or
    // exclusively handle `__barrel_optimize__` virtual specifiers (see
    // `isBarrelOptimizeRule`).
    rule.oneOf = rule.oneOf
      .filter((r: any) => !asUseArray(r?.use).some(isErrorLoaderUse))
      .filter((r: any) => isCssRule(r) || isBarrelOptimizeRule(r))
      .map((r: any) => {
        // Barrel branches' `test` typically `or`s the file-extension regex with
        // the barrel marker (e.g. `{ or: [/\.tsx?$/, '__barrel_optimize__'] }`).
        // Narrow to barrel only so this branch does not also catch regular TSX.
        if (!isCssRule(r) && isBarrelOptimizeRule(r)) {
          r.test = BARREL_NARROWED_TEST
        }
        delete r.issuer
        return stripNextCssRestrictions(r)
      })
  }
  if (Array.isArray(rule.rules)) {
    rule.rules = rule.rules.map(stripNextCssRestrictions)
  }
  if (isCssRule(rule)) delete rule.issuer
  return rule
}

/**
 * Extract Next.js CSS rules and splice our URL-rewrite loader before every
 * `next-font-loader`. Why the rewriter: `next-font-loader` emits CSS with
 * `url(/_next/static/media/[hash])` but writes binaries to `static/media/`,
 * relying on a Next.js dev-server alias we don't have. See
 * `loaders/next-font-url-rewrite.cjs`. Spliced *before* next-font-loader so
 * it runs *after* it (loaders apply right-to-left).
 *
 * Also strips the Pages-Router `_app.js`-only guards (see
 * `stripNextCssRestrictions`) so Storybook imports work without users having
 * to patch `tools.rspack` from `main.ts`.
 */
export function prepareNextCssRules(
  rawRules: any[],
  rewriterPath: string,
): any[] {
  const rules = rawRules.filter(isCssRule).map(stripNextCssRestrictions)
  walkRules(rules, (rule) => {
    if (!rule.use) return
    const uses = asUseArray(rule.use)
    const fontIdx = uses.findIndex(isNextFontLoader)
    if (fontIdx < 0) return
    uses.splice(fontIdx, 0, { loader: rewriterPath })
    rule.use = uses
  })
  return rules
}
