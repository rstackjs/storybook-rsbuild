// Asserts the TurboSnap result of a real rsbuild production build by running
// the pinned `chromatic` CLI offline (no token, no network) against
// `storybook-static/preview-stats.json`. Requires `pnpm build:storybook` first.
//
// Regression guard for #644: inner modules of a concatenated story module
// must keep their real importers, otherwise a change to a file outside the
// Storybook project root traces to no story.
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from 'node:fs'
import { dirname, join, posix, relative, resolve } from 'node:path'
import { describe, expect, it } from 'rstack/test'

const sandboxDir = resolve(__dirname, '..')
const staticDir = join(sandboxDir, 'storybook-static')
const statsFile = join(staticDir, 'preview-stats.json')
// Changed-file paths are relative to the git root, so derive the sandbox's
// location from it instead of hard-coding the repo layout.
const gitRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  cwd: sandboxDir,
  encoding: 'utf8',
}).trim()
const sandboxRel = relative(
  realpathSync(gitRoot),
  realpathSync(sandboxDir),
).replace(/\\/g, '/')
const sharedRel = posix.join(
  posix.dirname(sandboxRel),
  'chromatic-turbosnap-shared/src/index.ts',
)

// Run the CLI entry with the current Node, avoiding `.bin` shims (which differ
// on Windows). `chromatic`'s `bin` points at `dist/bin.cjs`.
const chromaticBin = join(
  dirname(require.resolve('chromatic/package.json', { paths: [sandboxDir] })),
  'dist/bin.cjs',
)
// Drop env vars that silently change the CLI's defaults.
const cliEnv = { ...process.env }
delete cliEnv.STORYBOOK_BASE_DIR
delete cliEnv.STORYBOOK_CONFIG_DIR
delete cliEnv.WEBPACK_STATS_FILE
const runChromatic = (args: string[]): string =>
  execFileSync(process.execPath, [chromaticBin, ...args], {
    cwd: sandboxDir,
    encoding: 'utf8',
    env: cliEnv,
  })

// `trace -m compact` prints `— <story file>[ + N modules]`. The suffix is the
// number of concatenated inner modules and depends on the bundler's
// concatenation, so it is stripped here instead of asserted.
const traceCompact = (changedFile: string): string[] =>
  runChromatic([
    'trace',
    '-m',
    'compact',
    '-b',
    sandboxRel,
    '-s',
    statsFile,
    changedFile,
  ])
    .split('\n')
    .filter((line) => line.startsWith('— '))
    .map((line) => line.slice(2).replace(/ \+ \d+ modules?$/, ''))
    .sort()

const inSandbox = (file: string) => posix.join(sandboxRel, file)

const stripDotSlash = (p: string) => p.replace(/^\.\//, '')
const readJson = <T>(file: string): T =>
  JSON.parse(readFileSync(file, 'utf8')) as T

// Story files as Storybook reports them (`index.json`), relative to the project root.
const storyImportPaths = new Set(
  Object.values(
    readJson<{ entries: Record<string, { importPath: string }> }>(
      join(staticDir, 'index.json'),
    ).entries,
  ).map((entry) => stripDotSlash(entry.importPath)),
)

// User source files bundled into the build, derived from the stats (no
// hand-written list, so new fixture files are covered automatically), as paths
// relative to the git root. Kept: real files on disk. Dropped: externals,
// `webpack/runtime/*`, generated entries (`storybook-config-entry.js`,
// `storybook-stories.js`, not on disk), `+ N modules` concatenation containers
// (their inner modules are listed separately), and anything in node_modules.
const toGitRel = (abs: string) =>
  relative(realpathSync(gitRoot), realpathSync(abs)).replace(/\\/g, '/')

const userFiles = (() => {
  const stats = readJson<{ modules: StatsModule[] }>(statsFile)
  const names = new Set<string>()
  const visit = (m: StatsModule) => {
    names.add(m.name)
    m.modules?.forEach(visit)
  }
  stats.modules.forEach(visit)
  const files = new Set<string>()
  for (const name of names) {
    if (/(^|[\\/])node_modules([\\/]|$)|\0|\?| \+ \d+ modules?$/.test(name)) {
      continue
    }
    const abs = resolve(sandboxDir, name)
    if (existsSync(abs) && statSync(abs).isFile()) {
      files.add(toGitRel(abs))
    }
  }
  return [...files].sort()
})()

interface StatsModule {
  name: string
  modules?: StatsModule[]
}

describe('Chromatic TurboSnap on an rsbuild build', () => {
  it('turbosnap-manifest storyFiles match index.json importPaths', () => {
    const manifest = JSON.parse(
      runChromatic(['turbosnap-manifest', '-s', statsFile]),
    ) as { storyFiles: Record<string, string> }
    expect(storyImportPaths.size).toBeGreaterThan(0)
    expect(
      new Set(Object.keys(manifest.storyFiles).map(stripDotSlash)),
    ).toEqual(storyImportPaths)
  })

  it('traces a shared file outside the project root to the story that uses it', () => {
    // shared/index.ts -> Button.tsx -> Button.stories.tsx (Button and the shared
    // helper are concatenated into the story module). Before #644 this traced
    // to 0 story files.
    expect(traceCompact(sharedRel)).toEqual([
      inSandbox('src/Button.stories.tsx'),
    ])
  })

  it('traces a concatenated inner module to its real story, not a story file itself', () => {
    // Button.tsx is an inner module of Button.stories.tsx. Before #644 it
    // inherited the CSF glob context as importer and was itself treated as a
    // story file.
    expect(traceCompact(inSandbox('src/Button.tsx'))).toEqual([
      inSandbox('src/Button.stories.tsx'),
    ])
  })

  it('traces a component imported by several modules to all affected stories', () => {
    // Badge stays standalone (4 importers). Tracing upward passes through the
    // concatenated inner module Button.tsx; Card is also imported by an MDX doc.
    expect(traceCompact(inSandbox('src/Badge.tsx'))).toEqual(
      [
        'src/Badge.stories.tsx',
        'src/Button.stories.tsx',
        'src/Card.stories.tsx',
        'src/Docs.mdx',
      ].map(inSandbox),
    )
  })

  it('traces a standalone component to its story and MDX entry (control: not concatenated)', () => {
    // Passes before and after #644; guards the output parsing and MDX story files.
    expect(traceCompact(inSandbox('src/Card.tsx'))).toEqual(
      ['src/Card.stories.tsx', 'src/Docs.mdx'].map(inSandbox),
    )
  })

  // Invariants over every file in the build, with no per-file expectations.
  // `trace -m compact` lists affected story files without saying which changed
  // file caused each one, so a batched call cannot be attributed per file:
  // trace one file at a time and collect the offenders.
  it('derives a non-empty user file list from the stats', () => {
    for (const known of [
      'src/Badge.tsx',
      'src/Button.tsx',
      'src/Card.tsx',
      'src/Button.stories.tsx',
      'src/Docs.mdx',
    ]) {
      expect(userFiles).toContain(inSandbox(known))
    }
    expect(userFiles).toContain(sharedRel)

    // Every source file on disk must be in the derived list, so the stats
    // derivation cannot silently drop files (and with them, A3 coverage).
    const onDisk = ['src', '../chromatic-turbosnap-shared/src'].flatMap((dir) =>
      readdirSync(resolve(sandboxDir, dir), {
        recursive: true,
        withFileTypes: true,
      })
        .filter((entry) => entry.isFile())
        .map((entry) => toGitRel(join(entry.parentPath, entry.name))),
    )
    expect(onDisk.length).toBeGreaterThan(0)
    expect(onDisk.filter((file) => !userFiles.includes(file))).toEqual([])
  })

  // Every affected file `trace` reports must be a real story file from
  // `index.json`. A bogus entry (e.g. an inner module treated as a story, as
  // before #644) shows up here even though the count of results looks fine.
  const notStories = (affected: string[]) =>
    affected.filter(
      (file) => !storyImportPaths.has(posix.relative(sandboxRel, file)),
    )

  // A2 is a sanity check only: it does not guard #644 (story files' own
  // traces are unaffected by that bug); A3 and the example cases do.
  it('A2: every story file traces to itself, and only to story files', () => {
    const offenders = [...storyImportPaths].flatMap((story) => {
      const affected = traceCompact(inSandbox(story))
      return affected.includes(inSandbox(story)) && !notStories(affected).length
        ? []
        : [`${story} -> [${affected.join(', ')}]`]
    })
    expect(offenders, 'story files with a wrong self-trace').toEqual([])
  })

  // Excluded from A3: story files (covered by A2) and global files. In
  // chromatic-cli's `getDependentStoryFiles` (v1; `bin-src/trace.ts` feeds it)
  // every file under the Storybook config dir (`.storybook/`, e.g. `preview.*`)
  // is a global "storybook file", except the generated stories entry and docs
  // files: changing one bails instead of tracing to stories. The CLI's
  // `annotationFilesByName` handling only recognizes the Vite builder's
  // project-annotations module, so under rsbuild the transitive importers of a
  // `.storybook/preview.*` also bail but are NOT excluded by this rule. This
  // sandbox has no preview file; add one only together with extending the
  // exclusion (e.g. everything reachable from `.storybook/` in the stats).
  // The config dir is `.storybook` under the project root (the CLI default for
  // `-c`), which this sandbox does not override.
  it('A3: every non-story, non-global user file traces only to story files, at least one', () => {
    const configDir = `${inSandbox('.storybook')}/`
    const candidates = userFiles.filter(
      (file) =>
        !file.startsWith(configDir) &&
        !storyImportPaths.has(posix.relative(sandboxRel, file)),
    )
    expect(candidates.length).toBeGreaterThan(0)
    const offenders = candidates.flatMap((file) => {
      const affected = traceCompact(file)
      return affected.length > 0 && !notStories(affected).length
        ? []
        : [`${file} -> [${affected.join(', ')}]`]
    })
    expect(offenders, 'user files with no or non-story trace results').toEqual(
      [],
    )
  })
})
