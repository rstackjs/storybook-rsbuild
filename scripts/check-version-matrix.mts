/**
 * Validates the `@rsbuild/core` ↔ `next-rspack` version matrix documented in
 * `website/docs/en/guide/framework/next.mdx` against the live npm registry.
 *
 * The framework's invariant (see `packages/framework-next` check-rspack-invariant):
 * the `@rspack/core` that `@rsbuild/core@<x>` pins MUST equal the one
 * `next-rspack@<next>` brings in — Next 16 via `@next/rspack-core`, Next 15
 * directly. A wrong cell silently hands users a mismatched pair, so this script
 * re-derives every row from the registry and fails on drift.
 *
 * Run: `pnpm tsx ./scripts/check-version-matrix.mts`  (network required).
 * Manual gate — not wired into CI (the `npm view` calls need network); run it
 * locally before a version bump or after editing the matrix table.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// The English doc is the source of truth the matrix parser expects; the zh
// mirror carries the same table data. Fail loudly if it ever moves again
// instead of surfacing a raw ENOENT from the reader below.
const MDX = path.join(root, 'website/docs/en/guide/framework/next.mdx')
if (!fs.existsSync(MDX)) {
  console.error(
    `Version-matrix doc not found at ${MDX}. ` +
      'Update the MDX path in scripts/check-version-matrix.mts if the doc moved.',
  )
  process.exit(1)
}

/** `npm view <spec> <field> --json`, parsed. Returns undefined on empty. */
function npmView(spec: string, field: string): unknown {
  const out = execFileSync('npm', ['view', spec, field, '--json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()
  return out ? JSON.parse(out) : undefined
}

const isStable = (v: string) => !v.includes('-')
const cmpSemver = (a: string, b: string) => {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  return pa[0] - pb[0] || pa[1] - pb[1] || pa[2] - pb[2]
}

/** Highest stable patch of a `pkg@<minor>` range. */
function highestPatch(pkg: string, minor: string): string {
  const raw = npmView(`${pkg}@${minor}`, 'version')
  const versions = (Array.isArray(raw) ? raw : [raw]).filter(
    (v): v is string => typeof v === 'string',
  )
  const stable = versions.filter(isStable).sort(cmpSemver)
  if (!stable.length) throw new Error(`no stable ${pkg}@${minor} on registry`)
  return stable.at(-1) as string
}

/** The exact `@rspack/core` a `next-rspack@<patch>` resolves to. */
function rspackCoreFor(nextRspackVersion: string): {
  rspackCore: string
  chain: string
} {
  const deps =
    (npmView(`next-rspack@${nextRspackVersion}`, 'dependencies') as Record<
      string,
      string
    >) ?? {}
  // Next 15: @rspack/core is a direct dep. Next 16: via @next/rspack-core.
  if (deps['@rspack/core']) {
    return { rspackCore: deps['@rspack/core'], chain: 'direct' }
  }
  const nextCore = deps['@next/rspack-core']
  if (!nextCore) {
    throw new Error(
      `next-rspack@${nextRspackVersion} has neither @rspack/core nor @next/rspack-core`,
    )
  }
  const rspackCore = npmView(
    `@next/rspack-core@${nextCore}`,
    'dependencies.@rspack/core',
  ) as string
  return { rspackCore, chain: `via @next/rspack-core@${nextCore}` }
}

interface Row {
  minor: string
  rspackCore: string
  rsbuildCores: string[]
  line: number
}

/** Pull the matrix rows straight from the doc table. */
function parseMatrix(): Row[] {
  const lines = fs.readFileSync(MDX, 'utf8').split('\n')
  const header = lines.findIndex(
    (l) =>
      l.trim().startsWith('|') &&
      l.includes('next-rspack') &&
      l.includes('@rspack/core') &&
      l.includes('@rsbuild/core'),
  )
  if (header === -1)
    throw new Error('version matrix table not found in next.mdx')
  const rows: Row[] = []
  for (let i = header + 2; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line.startsWith('|')) break
    const cells = line.split('|').map((c) => c.trim())
    const minor = cells[1]?.match(/(\d+\.\d+)\.x/)?.[1]
    if (!minor) continue
    rows.push({
      minor,
      rspackCore: cells[3]?.match(/\d+\.\d+\.\d+/)?.[0] ?? '',
      rsbuildCores: [...(cells[4] ?? '').matchAll(/\d+\.\d+\.\d+/g)].map(
        (m) => m[0],
      ),
      line: i + 1,
    })
  }
  if (!rows.length) throw new Error('no matrix rows parsed from next.mdx')
  return rows
}

let failed = false
const fail = (msg: string) => {
  failed = true
  console.error(`  ✗ ${msg}`)
}

for (const row of parseMatrix()) {
  console.log(`next ${row.minor}.x (next.mdx:${row.line})`)
  const patch = highestPatch('next-rspack', row.minor)
  const { rspackCore, chain } = rspackCoreFor(patch)
  console.log(`  next-rspack@${patch} → @rspack/core ${rspackCore} (${chain})`)

  if (row.rspackCore !== rspackCore) {
    fail(
      `@rspack/core column says ${row.rspackCore}, registry says ${rspackCore}`,
    )
  }
  if (!row.rsbuildCores.length) {
    fail('no @rsbuild/core version parsed from this row')
  }
  for (const rsbuildCore of row.rsbuildCores) {
    const pinned = npmView(
      `@rsbuild/core@${rsbuildCore}`,
      'dependencies.@rspack/core',
    ) as string
    if (pinned !== rspackCore) {
      fail(
        `@rsbuild/core@${rsbuildCore} pins @rspack/core ${pinned}, needs ${rspackCore}`,
      )
    } else {
      console.log(
        `  ✓ @rsbuild/core@${rsbuildCore} pins @rspack/core ${pinned}`,
      )
    }
  }
}

if (failed) {
  console.error('\nVersion matrix is out of sync with the npm registry.')
  process.exit(1)
}
console.log('\nVersion matrix matches the npm registry.')
