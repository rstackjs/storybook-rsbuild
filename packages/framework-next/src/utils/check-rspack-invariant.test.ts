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

  it('flags a version mismatch when versions differ (realign via matrix)', () => {
    const a = makeSide({ version: '1.6.7' })
    const b = makeSide({ source: 'next-rspack', version: '1.4.5' })
    const out = describeRspackMismatch(a, b)
    expect(out).toContain('1.6.7')
    expect(out).toContain('1.4.5')
    expect(out).toContain('@rspack/core version mismatch')
    // The version-mismatch branch does NOT claim duplicate copies.
    expect(out).not.toContain('duplicate physical copies')
  })

  it('flags no compatible pairing when the @rspack/core majors differ (next 16.3+ wall)', () => {
    // next-rspack@16.3 moved to @rspack/core 2.x while @rsbuild/core is still on
    // 1.x — no matrix row pairs them. The message must point at pinning to 16.2.x
    // and must NOT reuse the same-major shapes' wording.
    const a = makeSide({ version: '1.6.7' })
    const b = makeSide({
      source: 'next-rspack → @next/rspack-core',
      version: '2.0.4',
    })
    const out = describeRspackMismatch(a, b)
    expect(out).toContain('no compatible')
    expect(out).toContain('pairing')
    expect(out).toContain('16.2')
    expect(out).toContain('1.6.7')
    expect(out).toContain('2.0.4')
    expect(out).not.toContain('version mismatch')
    expect(out).not.toContain('duplicate physical copies')
  })

  it('reports duplicate physical copies (not a version mismatch) when only paths differ', () => {
    // Same version, different files: yarn Berry peer-split doppelganger. The
    // message must NOT say "version mismatch" (versions are equal) and must
    // point at pinning the splitting peer / deduping, not the @rspack/core pin.
    const a = makeSide({
      version: '1.5.0',
      pkgPath: '/repo/.yarn/__virtual__/A/@rspack/core/package.json',
    })
    const b = makeSide({
      source: 'next-rspack',
      version: '1.5.0',
      pkgPath: '/repo/.yarn/__virtual__/B/@rspack/core/package.json',
    })
    const out = describeRspackMismatch(a, b)
    expect(out).toContain('duplicate physical copies of @rspack/core@1.5.0')
    expect(out).not.toContain('version mismatch')
    expect(out).toContain('@swc/helpers')
    expect(out).toContain('dedupe')
    expect(out).toContain('/__virtual__/A/')
    expect(out).toContain('/__virtual__/B/')
  })
})
