import { describe, expect, it } from '@rstest/core'

// The loader resolves `next`/`storybook` helpers lazily inside the google/local
// branches, so the SWC-mode parsing and the non-font fallthrough are testable
// without a real Next.js install. The full google/local paths are covered
// end-to-end by the sandbox `Font` story and the community gauntlet.
const loader: (
  this: any,
) => Promise<string> = require('../loaders/storybook-nextjs-font-loader.cjs')

function swcContext(query: object, context: string, rootContext = '/project') {
  return {
    getOptions: () => ({}),
    resourceQuery: `?${JSON.stringify(query)}`,
    context,
    rootContext,
  }
}

describe('storybook-nextjs-font-loader', () => {
  it('returns an empty module for a non next/font source', async () => {
    const ctx = swcContext(
      { path: 'app/page.tsx', import: 'Inter', arguments: [{}] },
      '/project/node_modules/some-pkg',
    )
    const out = await loader.call(ctx)
    expect(out).toBe('module.exports = {}')
  })

  it('uses loader options directly in Babel mode (non-empty getOptions)', async () => {
    const ctx = {
      getOptions: () => ({
        source: '/project/node_modules/some-pkg',
        props: { weight: '700' },
        fontFamily: 'X',
        filename: 'a.tsx',
      }),
      resourceQuery: '',
      context: '/project/elsewhere',
      rootContext: '/project',
    }
    // Source is neither next/font/google nor /local → empty module, without
    // ever parsing a (here empty) resourceQuery.
    await expect(loader.call(ctx)).resolves.toBe('module.exports = {}')
  })

  it('reads font config from the resourceQuery, not loader options', async () => {
    const ctx = swcContext(
      { path: 'a.tsx', import: 'X', arguments: [{ weight: '700' }] },
      '/project/elsewhere',
    )
    // Non-font source short-circuits to the empty module without touching
    // the (empty) loader options object.
    await expect(loader.call(ctx)).resolves.toBe('module.exports = {}')
  })
})
