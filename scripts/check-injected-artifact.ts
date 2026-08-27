// Preflight guard for the pnpm-injected `storybook-builder-rsbuild` artifact.
//
// `packages/framework-next` consumes the builder via `dependenciesMeta.injected`,
// so pnpm hard-links the built `dist/` into
// `packages/framework-next/node_modules/storybook-builder-rsbuild/dist`. Every
// `builder-rsbuild` rebuild rewrites those files with fresh inodes, severing the
// hard-links while the package version stays identical — nothing detects the
// staleness, so the trust-local-validation workflow silently exercises an old
// builder. This guard hashes a cheap `{relPath,size,mtime}` manifest of both
// dist trees and fails fast when they diverge.
//
// Dependency-free on purpose (node builtins only). Called directly from the
// Next.js e2e spec's `beforeAll` (the only path that boots Storybook against the
// injected builder) — deliberately NOT wired as a global Playwright/Rstest
// setup, so unrelated sandboxes and pure-utility unit tests never hit it.

import { createHash } from 'node:crypto'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

const SOURCE_DIST = 'packages/builder-rsbuild/dist'
const INJECTED_DIST =
  'packages/framework-next/node_modules/storybook-builder-rsbuild/dist'

const REMEDIATION = 'run `pnpm install`'

function findRepoRoot(start: string = process.cwd()): string {
  let dir = start
  while (true) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir
    const parent = dirname(dir)
    if (parent === dir) return start
    dir = parent
  }
}

// Hash a manifest of `{relPath, size, mtimeMs}` for every file in `distDir`.
// We deliberately do NOT read file contents: a severed hard-link changes the
// inode's size/mtime (a rebuild rewrites the file), which the manifest catches
// while staying fast on large dist trees.
function hashDist(distDir: string): string {
  const entries: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (entry.isFile()) {
        const st = statSync(full)
        entries.push(
          `${relative(distDir, full)}\0${st.size}\0${Math.round(st.mtimeMs)}`,
        )
      }
    }
  }
  walk(distDir)
  entries.sort()
  return createHash('sha256').update(entries.join('\n')).digest('hex')
}

/**
 * Throw when the pnpm-injected `storybook-builder-rsbuild/dist` no longer
 * matches `packages/builder-rsbuild/dist` (a rebuild severed the hard-links).
 * A missing injected dir is treated as the same hard failure.
 */
export function assertInjectedBuilderFresh(
  repoRoot: string = findRepoRoot(),
): void {
  const sourceDist = join(repoRoot, SOURCE_DIST)
  const injectedDist = join(repoRoot, INJECTED_DIST)

  if (!existsSync(sourceDist)) {
    throw new Error(
      `[injected-artifact] builder dist not found at ${SOURCE_DIST} — build it first (\`pnpm build\`).`,
    )
  }

  if (!existsSync(injectedDist)) {
    throw new Error(
      `[injected-artifact] injected builder missing at ${INJECTED_DIST} — ${REMEDIATION}.`,
    )
  }

  const sourceHash = hashDist(sourceDist)
  const injectedHash = hashDist(injectedDist)

  if (sourceHash !== injectedHash) {
    throw new Error(
      `[injected-artifact] stale injected artifact — ${REMEDIATION}. ` +
        `The pnpm-injected copy of storybook-builder-rsbuild in framework-next is out of sync ` +
        `with packages/builder-rsbuild/dist (a builder rebuild severed the hard-links).`,
    )
  }
}
