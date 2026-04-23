/**
 * Helpers for users who need to extend the rspack config from `tools.rspack`
 * in `.storybook/main.ts`.
 *
 * These are intentionally small and stable so users can reach into rspack's
 * rule tree without re-implementing recursive walks.
 */

type RspackConfig = {
  module?: { rules?: any[] | undefined } | undefined
  [key: string]: any
}

type RuleBranch = Record<string, any>

function rulesOf(config: RspackConfig): any[] {
  config.module ??= {}
  config.module.rules ??= []
  return config.module.rules
}

function isMatchingRule(rule: any, predicate: RegExp): boolean {
  if (!rule || typeof rule !== 'object') return false
  const tests = Array.isArray(rule.test)
    ? rule.test
    : rule.test
      ? [rule.test]
      : []
  return tests.some((t: any) => t instanceof RegExp && predicate.test(t.source))
}

/**
 * Find every rule whose `test` matches `predicate` and `unshift` `branch` into
 * its `oneOf`. Returns the number of rules mutated.
 *
 * Use case: Rsbuild's default SVG rule registers four `oneOf` branches
 * (`svg-asset-url|inline|raw|asset`) where the last one is a catch-all that
 * wins over any user-added SVG rule. Pushing a custom rule via `tools.rspack`
 * therefore silently no-ops. Unshifting into the existing `oneOf` instead
 * makes the user rule win for matching issuers.
 *
 * @example
 *   tools: {
 *     rspack: (config) => {
 *       unshiftIntoOneOf(config, /\\?\\.svg/i, {
 *         issuer: { and: [/\\.(js|ts|md)x?$/] },
 *         use: [{ loader: '@svgr/webpack', options: { titleProp: true } }],
 *       })
 *     },
 *   }
 */
export function unshiftIntoOneOf(
  config: RspackConfig,
  testPredicate: RegExp,
  branch: RuleBranch,
): number {
  let mutated = 0
  const walk = (rules: any[]): void => {
    for (const rule of rules) {
      if (!rule) continue
      if (isMatchingRule(rule, testPredicate) && Array.isArray(rule.oneOf)) {
        rule.oneOf.unshift(branch)
        mutated++
      }
      if (Array.isArray(rule.oneOf)) walk(rule.oneOf)
      if (Array.isArray(rule.rules)) walk(rule.rules)
    }
  }
  walk(rulesOf(config))
  return mutated
}
