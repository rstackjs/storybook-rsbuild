import { createRequire } from 'node:module'
import { describe, expect, it, rs } from '@rstest/core'

const require = createRequire(import.meta.url)
const loader: (
  this: { callback: (...args: unknown[]) => void },
  source: unknown,
  sourceMap: unknown,
  meta: unknown,
) => void = require('../loaders/next-font-url-rewrite.cjs')

function runLoader(source: unknown, meta: unknown = undefined) {
  const callback = rs.fn()
  loader.call({ callback }, source, 'source-map', meta)
  return callback
}

describe('next-font-url-rewrite loader', () => {
  it('rewrites /_next/static/media/ → /static/media/ in CSS strings', () => {
    const source = `@font-face { src: url(/_next/static/media/font.woff2) }`
    const callback = runLoader(source, {})
    expect(callback).toHaveBeenCalledTimes(1)
    const [err, rewritten, map, meta] = callback.mock.calls[0]
    expect(err).toBeNull()
    expect(rewritten).toBe('@font-face { src: url(/static/media/font.woff2) }')
    expect(map).toBe('source-map')
    expect(meta).toEqual({})
  })

  it('replaces every occurrence, not just the first', () => {
    const source = [
      'url(/_next/static/media/a.woff2)',
      'url(/_next/static/media/b.woff2)',
    ].join('\n')
    const callback = runLoader(source, {})
    const [, rewritten] = callback.mock.calls[0]
    expect(rewritten).toBe(
      'url(/static/media/a.woff2)\nurl(/static/media/b.woff2)',
    )
  })

  it('strips meta.ast so css-loader re-parses the rewritten source', () => {
    const callback = runLoader('ignored', {
      ast: { type: 'postcss' },
      other: 'kept',
    })
    const [, , , meta] = callback.mock.calls[0]
    expect(meta).toEqual({ other: 'kept' })
    expect(meta).not.toHaveProperty('ast')
  })

  it('passes non-string sources through unchanged (e.g. Buffer)', () => {
    const buf = Buffer.from('url(/_next/static/media/font.woff2)')
    const callback = runLoader(buf, {})
    const [, rewritten] = callback.mock.calls[0]
    expect(rewritten).toBe(buf)
  })

  it('tolerates missing meta', () => {
    const callback = runLoader('body { color: red }', undefined)
    const [, , , meta] = callback.mock.calls[0]
    expect(meta).toEqual({})
  })
})
