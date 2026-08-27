import { describe, expect, it, rs } from '@rstest/core'

// The shim `require`s next-swc-loader natively — it ships uncompiled so `next`
// resolves from the user's project. We intercept that CJS require with a fake
// mirroring next-swc-loader's real shape: a `default` loader function,
// `raw = true`, and a `pitch` we expect the shim to drop (dropping pitch is the
// shim's whole purpose — pitch reads from disk, which breaks on Storybook's
// in-memory virtual entries). `hoisted` builds the spy before the hoisted mock.
const { impl } = rs.hoisted(() => ({ impl: rs.fn(() => 'compiled-source') }))

rs.mockRequire('next/dist/build/webpack/loaders/next-swc-loader', () => ({
  default: impl,
  raw: true,
  pitch: () => 'should-not-be-forwarded',
}))

const shim: {
  (this: unknown, ...args: unknown[]): unknown
  raw?: unknown
  pitch?: unknown
} = require('../loaders/swc-loader-shim.cjs')

describe('swc-loader-shim', () => {
  it('forwards the `raw` flag from next-swc-loader', () => {
    expect(shim.raw).toBe(true)
  })

  it('keeps `pitch` stripped (undefined)', () => {
    expect(shim.pitch).toBeUndefined()
  })

  it('delegates to the impl, forwarding `this` and args', () => {
    const fakeThis = { resourcePath: '/virtual/entry.js' }
    const result = shim.call(fakeThis, 'source-buffer', { map: 1 })

    expect(impl).toHaveBeenCalledTimes(1)
    expect(impl).toHaveBeenCalledWith('source-buffer', { map: 1 })
    expect(impl.mock.instances[0]).toBe(fakeThis)
    expect(result).toBe('compiled-source')
  })
})
