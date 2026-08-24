import { describe, expect, it } from '@rstest/core'
import {
  describeNextRspackPairingMismatch,
  describeRspackMismatch,
} from './check-rspack-invariant'

const makeSide = (
  over: Partial<{ source: string; pkgPath: string; version: string }> = {},
) => ({
  source: '@rsbuild/core',
  pkgPath:
    '/repo/node_modules/@rsbuild/core/node_modules/@rspack/core/package.json',
  version: '2.0.4',
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
    const b = makeSide({ source: 'next-rspack → @next/rspack-core' })
    expect(describeRspackMismatch(a, b)).toBeNull()
  })

  it('flags a version mismatch when versions differ (realign via matrix)', () => {
    const a = makeSide({ version: '2.0.8' })
    const b = makeSide({
      source: 'next-rspack → @next/rspack-core',
      version: '2.0.4',
    })
    const out = describeRspackMismatch(a, b)
    expect(out).toContain('2.0.8')
    expect(out).toContain('2.0.4')
    expect(out).toContain('@rspack/core version mismatch')
    // The version-mismatch branch does NOT claim duplicate copies.
    expect(out).not.toContain('duplicate physical copies')
  })

  it('directs rspack 1 users to upgrade Next.js when the majors differ', () => {
    const a = makeSide({ version: '2.0.4' })
    const b = makeSide({
      source: 'next-rspack → @next/rspack-core',
      version: '1.6.7',
    })
    const out = describeRspackMismatch(a, b)
    expect(out).toContain('unsupported @rspack/core major')
    expect(out).toContain('next <=16.2')
    expect(out).toContain('Upgrade `next` and `next-rspack`')
    expect(out).toContain('>=16.3.0')
    expect(out).toContain('2.0.4')
    expect(out).toContain('1.6.7')
    expect(out).not.toContain('version mismatch')
    expect(out).not.toContain('duplicate physical copies')
    expect(out).not.toContain('Pin `next`')
  })

  it('reports duplicate physical copies (not a version mismatch) when only paths differ', () => {
    // Same version, different files: yarn Berry peer-split doppelganger. The
    // message must NOT say "version mismatch" (versions are equal) and must
    // point at pinning the splitting peer / deduping, not the @rspack/core pin.
    const a = makeSide({
      version: '2.0.4',
      pkgPath: '/repo/.yarn/__virtual__/A/@rspack/core/package.json',
    })
    const b = makeSide({
      source: 'next-rspack → @next/rspack-core',
      version: '2.0.4',
      pkgPath: '/repo/.yarn/__virtual__/B/@rspack/core/package.json',
    })
    const out = describeRspackMismatch(a, b)
    expect(out).toContain('duplicate physical copies of @rspack/core@2.0.4')
    expect(out).not.toContain('version mismatch')
    expect(out).toContain('@swc/helpers')
    expect(out).toContain('dedupe')
    expect(out).toContain('/__virtual__/A/')
    expect(out).toContain('/__virtual__/B/')
  })
})

describe('describeNextRspackPairingMismatch', () => {
  it('returns null when either version is unresolved', () => {
    expect(describeNextRspackPairingMismatch(undefined, '16.3.2')).toBeNull()
    expect(describeNextRspackPairingMismatch('16.3.2', undefined)).toBeNull()
    expect(describeNextRspackPairingMismatch(undefined, undefined)).toBeNull()
  })

  it('returns null when next and next-rspack are the exact same version', () => {
    expect(describeNextRspackPairingMismatch('16.3.2', '16.3.2')).toBeNull()
  })

  it('flags a mismatch even within the supported minor', () => {
    const out = describeNextRspackPairingMismatch('16.3.2', '16.3.1')
    expect(out).toContain('16.3.2')
    expect(out).toContain('16.3.1')
    expect(out).toContain('next-rspack must match next exactly')
    expect(out).toContain('Install next-rspack@16.3.2')
  })
})
