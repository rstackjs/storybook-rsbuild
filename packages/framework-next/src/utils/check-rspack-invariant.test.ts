import { describe, expect, it } from '@rstest/core'
import { describeRspackMismatch } from './check-rspack-invariant'

const makeSide = (
  over: Partial<{ source: string; pkgPath: string; version: string }> = {},
) => ({
  source: '@rsbuild/core',
  pkgPath:
    '/repo/node_modules/@rsbuild/core/node_modules/@rspack/core/package.json',
  version: '1.6.7',
  ...over,
})

describe('describeRspackMismatch', () => {
  it('returns null when either side is absent', () => {
    expect(describeRspackMismatch(undefined, makeSide())).toBeNull()
    expect(describeRspackMismatch(makeSide(), undefined)).toBeNull()
    expect(describeRspackMismatch(undefined, undefined)).toBeNull()
  })

  it('returns null when both sides resolve to the same path and version', () => {
    const a = makeSide()
    const b = makeSide({ source: 'next-rspack' })
    expect(describeRspackMismatch(a, b)).toBeNull()
  })

  it('flags a mismatch when versions differ', () => {
    const a = makeSide({ version: '1.6.7' })
    const b = makeSide({ source: 'next-rspack', version: '1.4.5' })
    const out = describeRspackMismatch(a, b)
    expect(out).toContain('1.6.7')
    expect(out).toContain('1.4.5')
    expect(out).toContain('@rspack/core version mismatch')
  })

  it('flags a mismatch when paths differ even with matching versions', () => {
    // Two installed copies of the same version are still a doppelganger.
    const a = makeSide({ pkgPath: '/repo/a/@rspack/core/package.json' })
    const b = makeSide({
      source: 'next-rspack',
      pkgPath: '/repo/b/@rspack/core/package.json',
    })
    const out = describeRspackMismatch(a, b)
    expect(out).toContain('mismatch detected')
    expect(out).toContain('/repo/a/')
    expect(out).toContain('/repo/b/')
  })
})
