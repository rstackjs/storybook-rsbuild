import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

/**
 * Storybook's rsbuild compilation uses `@rspack/core` resolved through
 * `@rsbuild/core`; Next.js's extracted config is produced by `next-rspack` and
 * carries plugin instances bound to the `@rspack/core` resolved through
 * `next-rspack` (directly on 15.x, via `@next/rspack-core` on 16.x).
 *
 * When the two resolve to different copies, plugin hooks bind to one
 * `NormalModule` identity while the compilation runs on another — taps never
 * fire, and failures surface as inscrutable runtime errors far from the root
 * cause. The pins are version-specific (see the version matrix in docs), so
 * this check refuses to start with a mismatched graph.
 */
const MATRIX_URL =
  'https://storybook.rsbuild.rs/guide/framework/next#version-matrix'

export interface ResolvedRspack {
  source: string
  pkgPath: string
  version: string
}

/**
 * Exported for unit testing — decides whether a pair of resolved
 * `@rspack/core` locations constitute a mismatch. Returns the error message
 * (or `null` for OK). Extracted so tests don't have to stage filesystem
 * fixtures just to exercise the comparison.
 */
export function describeRspackMismatch(
  rsbuildSide: ResolvedRspack | undefined,
  nextSide: ResolvedRspack | undefined,
): string | null {
  if (!rsbuildSide || !nextSide) return null
  if (
    rsbuildSide.version === nextSide.version &&
    rsbuildSide.pkgPath === nextSide.pkgPath
  ) {
    return null
  }
  return [
    '[storybook-next-rsbuild] @rspack/core version mismatch detected.',
    '',
    `  via ${rsbuildSide.source}:`,
    `    ${rsbuildSide.version}  (${rsbuildSide.pkgPath})`,
    `  via ${nextSide.source}:`,
    `    ${nextSide.version}  (${nextSide.pkgPath})`,
    '',
    'Both sides must resolve to the same @rspack/core for the Next.js bridge',
    `to work. Pick compatible versions from the matrix: ${MATRIX_URL}`,
  ].join('\n')
}

function readVersion(pkgJsonPath: string): string | undefined {
  try {
    return JSON.parse(readFileSync(pkgJsonPath, 'utf8')).version
  } catch {
    return undefined
  }
}

function resolvePkgJson(fromPath: string, pkgName: string): string | undefined {
  try {
    return createRequire(fromPath).resolve(`${pkgName}/package.json`)
  } catch {
    return undefined
  }
}

function resolveFromRsbuild(): ResolvedRspack | undefined {
  const rsbuildPkg = resolvePkgJson(import.meta.url, '@rsbuild/core')
  if (!rsbuildPkg) return
  const pkgPath = resolvePkgJson(rsbuildPkg, '@rspack/core')
  if (!pkgPath) return
  const version = readVersion(pkgPath)
  if (!version) return
  return { source: '@rsbuild/core', pkgPath, version }
}

function resolveFromNextRspack(cwd: string): ResolvedRspack | undefined {
  // Next-rspack must be resolvable from the user's project root.
  const nextRspackPkg = resolvePkgJson(`${cwd}/`, 'next-rspack')
  if (!nextRspackPkg) return

  // Next 16.x routes through `@next/rspack-core` (which pins `@rspack/core`).
  const nextCorePkg = resolvePkgJson(nextRspackPkg, '@next/rspack-core')
  if (nextCorePkg) {
    const pkgPath = resolvePkgJson(nextCorePkg, '@rspack/core')
    if (pkgPath) {
      const version = readVersion(pkgPath)
      if (version) {
        return { source: 'next-rspack → @next/rspack-core', pkgPath, version }
      }
    }
  }

  // Next 15.x — `next-rspack` depends on `@rspack/core` directly.
  const pkgPath = resolvePkgJson(nextRspackPkg, '@rspack/core')
  if (!pkgPath) return
  const version = readVersion(pkgPath)
  if (!version) return
  return { source: 'next-rspack', pkgPath, version }
}

export function checkRspackInvariant(cwd: string = process.cwd()): void {
  // Silent when either side can't be resolved — downstream code paths already
  // throw with more specific diagnostics (missing peer, missing next-rspack, etc.).
  const message = describeRspackMismatch(
    resolveFromRsbuild(),
    resolveFromNextRspack(cwd),
  )
  if (message) throw new Error(message)
}
