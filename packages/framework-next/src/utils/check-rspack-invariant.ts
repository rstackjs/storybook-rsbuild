import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

/**
 * Storybook's rsbuild compilation uses `@rspack/core` resolved through
 * `@rsbuild/core`; Next.js's extracted config is produced by `next-rspack` and
 * carries plugin instances bound to the `@rspack/core` resolved through
 * `next-rspack` via `@next/rspack-core`.
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

  // Third failure shape, checked first: the two @rspack/core majors differ.
  // storybook-next-rsbuild supports the Rspack 2 line used by Next.js 16.3+;
  // Next.js <=16.2 remains on Rspack 1 and must be upgraded rather than paired
  // with an older @rsbuild/core.
  if (parseInt(rsbuildSide.version, 10) !== parseInt(nextSide.version, 10)) {
    return [
      '[storybook-next-rsbuild] unsupported @rspack/core major detected.',
      '',
      `  via ${rsbuildSide.source}:`,
      `    ${rsbuildSide.version}  (${rsbuildSide.pkgPath})`,
      `  via ${nextSide.source}:`,
      `    ${nextSide.version}  (${nextSide.pkgPath})`,
      '',
      'The two sides resolve @rspack/core copies with different majors, which',
      'cannot interoperate. storybook-next-rsbuild supports next 16.3+ and',
      '@rspack/core 2.x only; next <=16.2 uses @rspack/core 1.x and is unsupported.',
      'Upgrade `next` and `next-rspack` together to >=16.3.0 and install the',
      `matching @rsbuild/core configuration from ${MATRIX_URL}`,
    ].join('\n')
  }

  // Two distinct failure shapes with different fixes. When the version strings
  // differ, the pins are wrong → realign via the matrix. When they're EQUAL but
  // the physical files differ, the pin is already correct and the tree just has
  // duplicate copies (a package manager materialized one per peer-resolution
  // set — yarn Berry does this via virtual packages over @rspack/core's optional
  // @swc/helpers peer). "Force @rspack/core to X" is a no-op there; you must pin
  // the splitting peer or dedupe. Reporting "version mismatch" for equal
  // versions is both wrong and a dead-end for triage.
  const sameVersion = rsbuildSide.version === nextSide.version
  const header = sameVersion
    ? `duplicate physical copies of @rspack/core@${rsbuildSide.version} detected.`
    : '@rspack/core version mismatch detected.'
  const remediation = sameVersion
    ? [
        'Both sides resolve the same version but to different physical files.',
        'The @rspack/core pin is already correct — the duplication comes from the',
        'package manager materializing one copy per peer-resolution set (yarn Berry',
        "does this via virtual packages over @rspack/core's optional @swc/helpers",
        'peer). Pin the splitting peer to a single version (e.g. add @swc/helpers to',
        'pnpm `overrides` / yarn `resolutions`) or run `yarn dedupe` / `pnpm dedupe`',
        `so both sides collapse to one copy. See ${MATRIX_URL}`,
      ]
    : [
        'Both sides must resolve to the same @rspack/core for the Next.js bridge',
        `to work. Pick compatible versions from the matrix: ${MATRIX_URL}`,
      ]
  return [
    `[storybook-next-rsbuild] ${header}`,
    '',
    `  via ${rsbuildSide.source}:`,
    `    ${rsbuildSide.version}  (${rsbuildSide.pkgPath})`,
    `  via ${nextSide.source}:`,
    `    ${nextSide.version}  (${nextSide.pkgPath})`,
    '',
    ...remediation,
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

  // Next 16.3+ routes through `@next/rspack-core` (which pins `@rspack/core`).
  const nextCorePkg = resolvePkgJson(nextRspackPkg, '@next/rspack-core')
  if (!nextCorePkg) return
  const pkgPath = resolvePkgJson(nextCorePkg, '@rspack/core')
  if (!pkgPath) return
  const version = readVersion(pkgPath)
  if (!version) return
  return { source: 'next-rspack → @next/rspack-core', pkgPath, version }
}

/**
 * Exported for unit testing — a shared `@rspack/core` row is necessary but not
 * sufficient: Next.js loads `next-rspack` internals directly, so `next` and
 * `next-rspack` must be installed at the *exact* same version. Returns the
 * error message (or `null` for OK / unresolved).
 */
export function describeNextRspackPairingMismatch(
  nextVersion: string | undefined,
  nextRspackVersion: string | undefined,
): string | null {
  if (!nextVersion || !nextRspackVersion) return null
  if (nextVersion === nextRspackVersion) return null
  return [
    '[storybook-next-rsbuild] next-rspack must match next exactly.',
    '',
    `  next:        ${nextVersion}`,
    `  next-rspack: ${nextRspackVersion}`,
    '',
    'Next.js loads next-rspack internals directly, so the two must be installed',
    `at the same version. Install next-rspack@${nextVersion}.`,
    '',
    `See ${MATRIX_URL}`,
  ].join('\n')
}

function resolvePackageVersion(cwd: string, pkg: string): string | undefined {
  const pkgPath = resolvePkgJson(`${cwd}/`, pkg)
  if (!pkgPath) return
  return readVersion(pkgPath)
}

export function checkRspackInvariant(cwd: string = process.cwd()): void {
  // Exact next / next-rspack pairing, checked from the target project. Silent
  // when either package can't be resolved — downstream throws more specifically.
  const pairingMessage = describeNextRspackPairingMismatch(
    resolvePackageVersion(cwd, 'next'),
    resolvePackageVersion(cwd, 'next-rspack'),
  )
  if (pairingMessage) throw new Error(pairingMessage)

  // Silent when either side can't be resolved — downstream code paths already
  // throw with more specific diagnostics (missing peer, missing next-rspack, etc.).
  const message = describeRspackMismatch(
    resolveFromRsbuild(),
    resolveFromNextRspack(cwd),
  )
  if (message) throw new Error(message)
}
