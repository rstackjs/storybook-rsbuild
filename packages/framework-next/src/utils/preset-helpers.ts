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
 */
export function buildNextLoaderChain(
  rawRules: any[],
  shimPath: string,
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
    if (name === 'next-swc-loader' || name?.endsWith('/next-swc-loader')) {
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
 * - `ReactRefreshRspackPlugin`: provides `$ReactRefreshRuntime$` via ProvidePlugin
 *   (complements our `ReactRefreshInitPlugin` which handles the `injectIntoGlobalHook` bootstrap)
 */
export const KEEP_PLUGIN_NAMES = new Set([
  'CssExtractRspackPlugin',
  'ReactRefreshRspackPlugin',
])

export function filterNextPlugins(rawPlugins: any[]): any[] {
  return rawPlugins.filter((plugin) => {
    const name = plugin?.constructor?.name
    return !!name && KEEP_PLUGIN_NAMES.has(name)
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

/**
 * Extract Next.js CSS rules and splice our URL-rewrite loader before every
 * `next-font-loader`. Why the rewriter: `next-font-loader` emits CSS with
 * `url(/_next/static/media/[hash])` but writes binaries to `static/media/`,
 * relying on a Next.js dev-server alias we don't have. See
 * `loaders/next-font-url-rewrite.cjs`. Spliced *before* next-font-loader so
 * it runs *after* it (loaders apply right-to-left).
 */
export function prepareNextCssRules(
  rawRules: any[],
  rewriterPath: string,
): any[] {
  const rules = rawRules.filter(isCssRule)
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
