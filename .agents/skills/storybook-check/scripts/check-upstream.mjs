#!/usr/bin/env node
/**
 * Git plumbing for the storybook-check drift audit, driven by manifest.json in
 * the skill directory. Every check run is a FULL, stateless sweep: the audit
 * compares the CURRENT content of each mapped upstream/local file pair — no
 * cursors, no memory of previous runs.
 *
 * Shares the blobless clone cache at ~/.cache/storybook-upstream/ with the
 * storybook-sync skill.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const MANIFEST_PATH = resolve(SCRIPT_DIR, '../manifest.json')
const CACHE_DIR = join(homedir(), '.cache/storybook-upstream')
const REPO_URL = 'https://github.com/storybookjs/storybook.git'
const UPSTREAM_BRANCH = 'next'

const USAGE = `Usage: node check-upstream.mjs [--no-fetch] MODE

Modes:
  --groups              Print the audit partition as GROUP|UPSTREAM|LOCAL, one
                        line per mapping, grouped by the LOCAL package that owns
                        the port. Spawn one audit subagent per distinct GROUP:
                        several upstream packages can feed one local package,
                        and they have to be judged together. LOCAL is "-" for
                        review-only entries; those group by their \`reviewWith\`.
  --list                Print every manifest mapping as UPSTREAM|LOCAL.
  --show PATH           Print the CURRENT upstream content of PATH (origin/next).
  --log PATH            Recent commits touching PATH on origin/next, newest
                        first (context for the audit; content is ground truth).
  --coverage            Report manifest coverage drift:
                          INVALID-MANIFEST|<entry>|<why>
                                                   the manifest entry itself is
                                                   malformed (no reviewWith on a
                                                   review-only entry, duplicate
                                                   upstream, dangling package)
                          UNMAPPED|<path>          upstream file (under mapped
                                                   src dirs) in neither mappings
                                                   nor ignoredUpstreamFiles
                          MISSING-UPSTREAM|<path>  mapped upstream file that no
                                                   longer exists on origin/next
                                                   (deleted or renamed —
                                                   investigate with
                                                   \`git log --follow\`)
                          MISSING-LOCAL|<path>     mapped or localOnly local file
                                                   that no longer exists here
                          UNLISTED-LOCAL|<path>    local file (under mapped local
                                                   src dirs) in neither mappings
                                                   nor localOnlyFiles
  --no-fetch            Skip git fetch (cache already updated this session).
`

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

function parseArgs(argv) {
  const options = { noFetch: false, mode: '', path: '' }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    switch (arg) {
      case '--no-fetch':
        options.noFetch = true
        break
      case '--groups':
      case '--list':
      case '--coverage':
        options.mode = arg.slice(2)
        break
      case '--show':
      case '--log': {
        const value = argv[++i]
        if (!value || value.startsWith('--')) {
          fail(`${arg} requires a PATH argument\n\n${USAGE}`)
        }
        options.mode = arg.slice(2)
        options.path = value
        break
      }
      case '-h':
      case '--help':
        process.stdout.write(USAGE)
        process.exit(0)
        break
      default:
        fail(`Unknown option: ${arg}\n\n${USAGE}`)
    }
  }
  if (!options.mode) fail(USAGE)
  return options
}

const git = (args, options = {}) =>
  execFileSync('git', args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  })

const gitLines = (args, options = {}) =>
  git(args, options)
    .split('\n')
    .filter((line) => line !== '')

/**
 * Repo root drives the local-side sweep. Ask git rather than counting `..`
 * levels, so moving or symlinking the skill directory can't silently turn every
 * local file into a MISSING-LOCAL finding.
 */
function findRepoRoot() {
  try {
    return git(['-C', SCRIPT_DIR, 'rev-parse', '--show-toplevel']).trim()
  } catch {
    return resolve(SCRIPT_DIR, '../../../..')
  }
}

function ensureCache(noFetch) {
  if (existsSync(join(CACHE_DIR, '.git'))) {
    if (noFetch) return
    process.stderr.write(
      `:: Fetching latest upstream (${UPSTREAM_BRANCH})...\n`,
    )
    try {
      git(['-C', CACHE_DIR, 'fetch', '--all', '--tags', '--prune'], {
        stdio: ['ignore', 'ignore', 'ignore'],
      })
    } catch {
      // Auditing a slightly stale cache still finds real drift, so a failed
      // fetch shouldn't block the run — but say so loudly, because a clean
      // verdict against stale upstream is exactly the false confidence this
      // skill exists to prevent. Record the upstream SHA in the report.
      process.stderr.write(
        ':: WARNING: fetch failed — auditing the cached upstream, which may be behind.\n',
      )
    }
    return
  }
  process.stderr.write(
    ':: First run — cloning storybookjs/storybook (blobless, ~1-2 min)...\n',
  )
  mkdirSync(dirname(CACHE_DIR), { recursive: true })
  git(['clone', '--filter=blob:none', '--no-checkout', REPO_URL, CACHE_DIR], {
    stdio: ['ignore', 'ignore', 'inherit'],
  })
}

/** Files that exist on both sides but are never audited as ported behavior. */
const isSkipped = (path) =>
  /(\.test\.|\.stories\.|\.d\.ts$|__tests__|__fixtures__|__mocks__)/.test(path)

const srcDir = (path) => path.replace(/\/src\/.*$/, '/src')
const localPackage = (path) => path.split('/').slice(0, 2).join('/')
const uniq = (values) => [...new Set(values)]

function loadManifest() {
  if (!existsSync(MANIFEST_PATH)) fail(`manifest not found: ${MANIFEST_PATH}`)
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
}

const groupOf = (entry) =>
  entry.local ? localPackage(entry.local) : (entry.reviewWith ?? 'unassigned')

/**
 * Structural problems in the manifest itself. Coverage is the gate the workflow
 * runs before spawning audit subagents, so a malformed entry has to surface
 * here — otherwise it slips through and step 2 partitions on garbage.
 */
function validateManifest(manifest, repoRoot) {
  const findings = []
  const seen = new Set()

  for (const entry of manifest.mappings) {
    const id = entry.upstream ?? '<missing upstream>'
    if (!entry.upstream) {
      findings.push(`INVALID-MANIFEST|${id}|entry has no upstream path`)
      continue
    }
    if (seen.has(entry.upstream)) {
      findings.push(`INVALID-MANIFEST|${id}|duplicate upstream entry`)
    }
    seen.add(entry.upstream)

    if (!entry.local && !entry.reviewWith) {
      findings.push(
        `INVALID-MANIFEST|${id}|review-only entry needs a reviewWith naming the local package that audits it`,
      )
    }
    if (entry.local && entry.reviewWith) {
      findings.push(
        `INVALID-MANIFEST|${id}|reviewWith is only for entries without a local counterpart`,
      )
    }
    if (entry.reviewWith && !existsSync(join(repoRoot, entry.reviewWith))) {
      findings.push(
        `INVALID-MANIFEST|${id}|reviewWith points at a package that does not exist: ${entry.reviewWith}`,
      )
    }
  }

  return findings
}

function listLocalSources(repoRoot, dir) {
  const absolute = join(repoRoot, dir)
  if (!existsSync(absolute)) return []
  return readdirSync(absolute, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(ts|tsx|js)$/.test(entry.name))
    .map((entry) => {
      const nested = entry.parentPath ?? entry.path
      return join(nested, entry.name).slice(repoRoot.length + 1)
    })
    .sort()
}

function reportCoverage(manifest, repoRoot) {
  const mappings = manifest.mappings
  const findings = validateManifest(manifest, repoRoot)

  // Entries with no upstream path are already reported as INVALID-MANIFEST;
  // keep them out of the sweep so one malformed entry can't crash the very
  // report that diagnoses it.
  const swept = mappings.filter((entry) => entry.upstream)

  // One ls-tree per mapped source dir answers both upstream questions: which
  // mapped files have disappeared, and which tracked files nobody has mapped.
  const tracked = new Set(
    uniq(swept.map((entry) => srcDir(entry.upstream))).flatMap((dir) =>
      gitLines([
        '-C',
        CACHE_DIR,
        'ls-tree',
        '-r',
        '--name-only',
        `origin/${UPSTREAM_BRANCH}`,
        dir,
      ]),
    ),
  )

  for (const entry of swept) {
    if (!tracked.has(entry.upstream)) {
      findings.push(`MISSING-UPSTREAM|${entry.upstream}`)
    }
  }

  const upstreamKnown = new Set([
    ...swept.map((entry) => entry.upstream),
    ...(manifest.ignoredUpstreamFiles ?? []),
  ])
  for (const file of [...tracked].sort()) {
    if (isSkipped(file) || upstreamKnown.has(file)) continue
    findings.push(`UNMAPPED|${file}`)
  }

  const localKnown = uniq([
    ...mappings.map((entry) => entry.local).filter(Boolean),
    ...(manifest.localOnlyFiles?.files ?? []),
  ])
  const localKnownSet = new Set(localKnown)
  for (const file of localKnown) {
    if (!existsSync(join(repoRoot, file)))
      findings.push(`MISSING-LOCAL|${file}`)
  }

  const localDirs = uniq(
    mappings
      .map((entry) => entry.local)
      .filter(Boolean)
      .map(srcDir),
  )
  for (const dir of localDirs) {
    for (const file of listLocalSources(repoRoot, dir)) {
      if (isSkipped(file) || localKnownSet.has(file)) continue
      findings.push(`UNLISTED-LOCAL|${file}`)
    }
  }

  if (findings.length === 0) {
    process.stderr.write(':: Manifest coverage is complete.\n')
    return
  }
  process.stdout.write(`${findings.join('\n')}\n`)
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  const manifest = loadManifest()
  ensureCache(options.noFetch)

  switch (options.mode) {
    case 'groups': {
      const rows = manifest.mappings
        .map((entry) => [
          groupOf(entry),
          entry.upstream ?? '-',
          entry.local ?? '-',
        ])
        .sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]))
      process.stdout.write(`${rows.map((row) => row.join('|')).join('\n')}\n`)
      break
    }
    case 'list': {
      const rows = manifest.mappings.map((entry) =>
        [entry.upstream, entry.local ?? '-'].join('|'),
      )
      process.stdout.write(`${rows.join('\n')}\n`)
      break
    }
    case 'show':
      git(
        ['-C', CACHE_DIR, 'show', `origin/${UPSTREAM_BRANCH}:${options.path}`],
        {
          stdio: ['ignore', 'inherit', 'inherit'],
        },
      )
      break
    case 'log':
      git(
        [
          '-C',
          CACHE_DIR,
          'log',
          '-15',
          '--format=%H|%ai|%an|%s',
          `origin/${UPSTREAM_BRANCH}`,
          '--',
          options.path,
        ],
        { stdio: ['ignore', 'inherit', 'inherit'] },
      )
      break
    case 'coverage':
      reportCoverage(manifest, findRepoRoot())
      break
  }
}

try {
  main()
} catch (error) {
  // Piping --show/--log into `head` closes the pipe early; that is a normal way
  // to use them, not a failure worth a stack trace.
  if (error?.signal === 'SIGPIPE' || error?.code === 'EPIPE') process.exit(0)
  const captured = error?.stderr?.toString().trim()
  if (captured) fail(captured)
  // git inherited stderr and has already explained itself; echoing node's
  // "Command failed: git ..." on top only buries the real message.
  if (error?.status != null) process.exit(error.status)
  fail(error?.message ?? String(error))
}
