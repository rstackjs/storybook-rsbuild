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

function walkRules(rules: any[] | undefined, fn: (rule: any) => void): void {
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
 */
export function buildNextLoaderChain(
  rawRules: any[],
  shimPath: string,
  { isDev }: { isDev: boolean } = { isDev: true },
): any[] | null {
  let clientRule: any = null
  walkRules(rawRules, (rule) => {
    if (clientRule) return
    const names = asUseArray(rule.use).map(loaderNameOf)
    if (
      names.includes('builtin:react-refresh-loader') &&
      names.includes('next-swc-loader')
    ) {
      clientRule = rule
    }
  })
  if (!clientRule) return null

  return asUseArray(clientRule.use).flatMap((use) => {
    const name = loaderNameOf(use)
    if (name === 'builtin:react-refresh-loader') {
      return isDev ? [use] : []
    }
    if (name === 'next-swc-loader' || name?.endsWith('/next-swc-loader')) {
      const options = use.options || {}
      const adjusted = isDev ? options : { ...options, dev: false }
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
 * Allowlist of Next.js plugins to inject into Storybook. Allowlist (not
 * denylist) because Next.js adds/renames plugins across versions and an
 * unknown new plugin may write to disk, throw, or pollute the bundle.
 * - `CssExtractRspackPlugin`: drives the CSS pipeline; required for `next/font` target.css
 * - `ReactRefreshRspackPlugin`: provides `$ReactRefreshRuntime$` via ProvidePlugin
 *   (complements our `ReactRefreshInitPlugin` which handles the `injectIntoGlobalHook` bootstrap)
 */
export const KEEP_PLUGIN_NAMES = new Set([
  'CssExtractRspackPlugin',
  'ReactRefreshRspackPlugin',
])

/** Plugins from {@link KEEP_PLUGIN_NAMES} that must NOT leak into prod builds. */
const DEV_ONLY_PLUGIN_NAMES = new Set(['ReactRefreshRspackPlugin'])

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
    rule.oneOf = rule.oneOf
      .filter((r: any) => !asUseArray(r?.use).some(isErrorLoaderUse))
      .map((r: any) => {
        if (isCssRule(r)) delete r.issuer
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
