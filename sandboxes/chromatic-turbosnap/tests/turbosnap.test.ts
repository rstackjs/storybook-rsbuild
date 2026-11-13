// Asserts the TurboSnap result of real rsbuild production builds by running
// the pinned `chromatic` CLI offline (no token, no network) against each
// build's `preview-stats.json`. Requires `pnpm build:storybook` first.
//
// Stats shape (observed, cause not understood): rspack names the inner modules
// of a concatenated story module ("./src/Button.stories.tsx + 2 modules") in
// one of two ways:
//  - real names: `modules` lists "./src/Button.stories.tsx", "./src/Button.tsx",
//    "../shared/src/index.ts" (seen with `.storybook/`, whose preview graph has
//    no JSX);
//  - container-named: `modules` lists the container's own name instead of
//    "./src/Button.tsx" (seen with `.storybook-jsx/`, whose preview graph
//    contains JSX, i.e. imports `react/jsx-runtime`).
// The form varies per concatenated module, not per build: in the JSX build the
// preview's own container still lists real names. The "JSX in the preview
// graph" link is an empirical rule, not a verified cause, and may change with
// rspack/swc upgrades. Pre-#644 code only breaks the real-names form (it
// invented importers for the inner modules it could see), so both builds are
// tested and the examples that depend on the form assert it first.
//
// Regression guard for #644: inner modules of a concatenated story module
// must keep their real importers, otherwise a change to a file outside the
// Storybook project root traces to no story.
import { execFileSync, spawnSync } from 'node:child_process'
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, join, posix, relative, resolve } from 'node:path'
import { describe, expect, it } from 'rstack/test'

const sandboxDir = resolve(__dirname, '..')

interface BuildConfig {
  name: string
  configDir: string
  staticDir: string
  innerNames: 'real-names' | 'container-named'
  // Files whose change bails (global): the preview and what only it imports.
  bailed: string[]
}
// Imported only by the preview of each config dir.
const previewOnly = ['src/decorators.ts', 'src/theme.ts']
const builds: BuildConfig[] = [
  {
    name: 'preview without JSX',
    configDir: '.storybook',
    staticDir: join(sandboxDir, 'storybook-static'),
    innerNames: 'real-names',
    bailed: ['.storybook/preview.ts', ...previewOnly],
  },
  {
    name: 'preview with JSX',
    configDir: '.storybook-jsx',
    staticDir: join(sandboxDir, 'dist/jsx-preview/storybook-static'),
    innerNames: 'container-named',
    bailed: ['.storybook-jsx/preview.tsx', ...previewOnly],
  },
]
// Changed-file paths are relative to the git root, so derive the sandbox's
// location from it instead of hard-coding the repo layout.
const gitRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  cwd: sandboxDir,
  encoding: 'utf8',
}).trim()
const gitRootReal = realpathSync(gitRoot)
const toGitRel = (abs: string) =>
  relative(gitRootReal, realpathSync(abs)).replace(/\\/g, '/')
// Git-relative path of a module name from the stats, or undefined if it is not
// a file on disk (externals, virtual and generated modules).
const diskGitRel = (name: string) => {
  const abs = resolve(sandboxDir, name)
  return statSync(abs, { throwIfNoEntry: false })?.isFile()
    ? toGitRel(abs)
    : undefined
}
const sandboxRel = toGitRel(sandboxDir)
const sharedRel = posix.join(
  posix.dirname(sandboxRel),
  'chromatic-turbosnap-shared/src/index.ts',
)
const inSandbox = (file: string) => posix.join(sandboxRel, file)

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

// A2/A3 spawn one CLI process per file (about 0.2s each locally, slower on
// Windows) and the shared 10s test timeout would be tight as the sandbox grows.
const SLOW_TEST_TIMEOUT = 60_000

const stripDotSlash = (p: string) => p.replace(/^\.\//, '')
// Concatenation suffix of a module name, which can repeat for nested
// concatenation (`+ 1 modules + 1 modules`).
const NESTED_SUFFIX = /( \+ \d+ modules?)+$/
const cleanName = (name: string) =>
  stripDotSlash(name.replace(NESTED_SUFFIX, ''))
const readJson = <T>(file: string): T =>
  JSON.parse(readFileSync(file, 'utf8')) as T

interface StatsModule {
  name: string
  modules?: StatsModule[]
  reasons?: { moduleName?: string | null }[]
}

function describeBuild(build: BuildConfig) {
  const statsFile = join(build.staticDir, 'preview-stats.json')
  const stats = readJson<{ modules: StatsModule[] }>(statsFile)
  const cliArgs = ['-b', sandboxRel, '-c', build.configDir, '-s', statsFile]

  const run = (command: string, args: string[]) => {
    const result = spawnSync(
      process.execPath,
      [chromaticBin, command, ...args],
      { cwd: sandboxDir, encoding: 'utf8', env: cliEnv },
    )
    expect(result.status, result.stderr).toBe(0)
    return result
  }

  // Traces are cached: the example tests and A3 trace the same files, and
  // each CLI spawn costs about 0.2s. Warnings such as "TurboSnap disabled due
  // to file change" go to stderr (exit code 0), hence both streams.
  const traceCache = new Map<string, { stdout: string; stderr: string }>()
  const trace = (changedFile: string) => {
    let result = traceCache.get(changedFile)
    if (!result) {
      result = run('trace', ['-m', 'compact', ...cliArgs, changedFile])
      traceCache.set(changedFile, result)
    }
    return result
  }

  // `trace -m compact` prints `— <story file>[ + N modules]`; the suffix
  // depends on the bundler's concatenation, so it is stripped, not asserted.
  const traceCompact = (changedFile: string): string[] =>
    trace(changedFile)
      .stdout.split('\n')
      .filter((line) => line.startsWith('— '))
      .map((line) => line.slice(2).replace(NESTED_SUFFIX, ''))
      .sort()

  // Story files as Storybook reports them (`index.json`), relative to the project root.
  const storyImportPaths = new Set(
    Object.values(
      readJson<{ entries: Record<string, { importPath: string }> }>(
        join(build.staticDir, 'index.json'),
      ).entries,
    ).map((entry) => stripDotSlash(entry.importPath)),
  )
  const isStory = (gitRelFile: string) =>
    storyImportPaths.has(posix.relative(sandboxRel, gitRelFile))

  // User source files bundled into the build, derived from the stats so new
  // fixture files are covered automatically (git-relative). Dropped:
  // node_modules, `?query`/virtual names, `+ N modules` containers (their
  // inner modules are listed separately) and anything not a file on disk
  // (externals, `webpack/runtime/*`, generated entries).
  const userFiles = (() => {
    const files = new Set<string>()
    const visit = (m: StatsModule) => {
      if (
        !/(^|[\\/])node_modules([\\/]|$)|\0|\?/.test(m.name) &&
        !NESTED_SUFFIX.test(m.name)
      ) {
        const file = diskGitRel(m.name)
        if (file) files.add(file)
      }
      m.modules?.forEach(visit)
    }
    stats.modules.forEach(visit)
    return files
  })()

  // Global files: everything under the Storybook config dir plus every module
  // those files import, transitively. chromatic-cli's
  // `getDependentStoryFiles` (v1; fed by `bin-src/trace.ts`) bails ("TurboSnap
  // disabled due to file change") on a changed file under the config dir
  // (except the generated stories entry and docs files) and on a change that
  // reaches one through importers. Its `annotationFilesByName` special case only
  // covers the Vite builder, so under rsbuild this is derived from the stats'
  // `reasons` (importer edges) instead of being listed by hand.
  const globalFiles = (() => {
    const inConfigDir = (name: string) => name.startsWith(`${build.configDir}/`)
    const edges: [from: string, to: string][] = []
    const global = new Set<string>()
    for (const m of stats.modules) {
      const to = cleanName(m.name)
      if (inConfigDir(to)) global.add(to)
      for (const reason of m.reasons ?? []) {
        if (!reason.moduleName) continue
        const from = cleanName(reason.moduleName)
        if (inConfigDir(from)) global.add(from)
        edges.push([from, to])
      }
    }
    // Fixed point: a module imported by a global module is global.
    for (let grew = true; grew;) {
      grew = false
      for (const [from, to] of edges) {
        if (global.has(from) && !global.has(to)) {
          global.add(to)
          grew = true
        }
      }
    }
    return new Set([...global].flatMap((name) => diskGitRel(name) ?? []))
  })()

  // Precondition for examples that depend on the stats shape (see the header):
  // fails loudly if rspack changes how it names the inner modules of a
  // concatenated story module, instead of the example silently losing its
  // meaning.
  const expectInnerNames = (storyFile: string, innerFile: string) => {
    const storyName = `./${storyFile}`
    const container = stats.modules.find(
      (m) => m.name.startsWith(`${storyName} + `) && m.modules,
    )
    if (!container) throw new Error(`${storyName} is not a concatenated module`)
    const nested = container.modules!.map((m) => m.name)
    const wantReal = build.innerNames === 'real-names'
    expect(
      {
        realName: nested.includes(`./${innerFile}`),
        containerName: nested.some((name) =>
          name.startsWith(`${storyName} + `),
        ),
      },
      `${build.name}: expected inner modules in the ${build.innerNames} form; the stats shape may have changed after an rspack/swc upgrade, so re-check what this example is meant to cover`,
    ).toEqual({ realName: wantReal, containerName: !wantReal })
  }

  describe(`Chromatic TurboSnap on an rsbuild build (${build.name})`, () => {
    it('turbosnap-manifest storyFiles match index.json importPaths', () => {
      const manifest = JSON.parse(
        run('turbosnap-manifest', cliArgs).stdout,
      ) as {
        storyFiles: Record<string, string>
      }
      expect(storyImportPaths.size).toBeGreaterThan(0)
      expect(
        new Set(Object.keys(manifest.storyFiles).map(stripDotSlash)),
      ).toEqual(storyImportPaths)
    })

    it('has the expected stats shape for concatenated story modules', () => {
      expectInnerNames('src/Button.stories.tsx', 'src/Button.tsx')
      expectInnerNames('src/Styled.stories.tsx', 'src/Styled.tsx')
      expectInnerNames('src/Gadget.stories.tsx', 'src/Gadget.tsx')
      // For the `?raw` container the form shows on the story's own entry
      // (`./src/notes.md?raw` is listed by name in both forms).
      expectInnerNames('src/Raw.stories.tsx', 'src/Raw.stories.tsx')
    })

    it('traces a shared file outside the project root to the story that uses it', () => {
      // shared/index.ts -> Button.tsx -> Button.stories.tsx (Button and the
      // shared helper are concatenated into the story module). Before #644 this
      // traced to 0 story files.
      expectInnerNames('src/Button.stories.tsx', 'src/Button.tsx')
      expect(traceCompact(sharedRel)).toEqual([
        inSandbox('src/Button.stories.tsx'),
      ])
    })

    it('traces a concatenated inner module to its real story, not a story file itself', () => {
      // Button.tsx is an inner module of Button.stories.tsx. Before #644 it
      // inherited the CSF glob context as importer and was itself treated as a
      // story file. That only happens when the stats list it by its real name
      // (see the header), so assert the shape first; the other shape is a
      // control.
      expectInnerNames('src/Button.stories.tsx', 'src/Button.tsx')
      expect(traceCompact(inSandbox('src/Button.tsx'))).toEqual([
        inSandbox('src/Button.stories.tsx'),
      ])
    })

    it('traces a component imported by several modules to all affected stories', () => {
      // Badge stays standalone (several importers). Tracing upward passes
      // through the concatenated inner module Button.tsx; Card is also imported
      // by an MDX doc.
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

    it('traces a lazily imported component (separate chunk) to its story', () => {
      expect(traceCompact(inSandbox('src/HeavyPanel.tsx'))).toEqual([
        inSandbox('src/Lazy.stories.tsx'),
      ])
    })

    it('traces barrel re-exports, including an unused one, to the importing story', () => {
      // The CLI follows module-level import edges from the stats, not
      // tree-shaking: `Unused` is re-exported by the barrel but never imported
      // by a component, yet it stays in the stats as an importee of
      // `barrel/index.ts`, so it is reported as affecting Gadget.stories. That
      // is conservative (never misses a story).
      for (const file of [
        'src/barrel/index.ts',
        'src/barrel/Alpha.tsx',
        'src/barrel/Beta.tsx',
        'src/barrel/Unused.tsx',
      ]) {
        expect(traceCompact(inSandbox(file))).toEqual([
          inSandbox('src/Gadget.stories.tsx'),
        ])
      }
    })

    it('traces plain CSS, CSS Modules and a ?raw import to their stories', () => {
      for (const file of ['src/plain.css', 'src/Styled.module.css']) {
        expect(traceCompact(inSandbox(file))).toEqual([
          inSandbox('src/Styled.stories.tsx'),
        ])
      }
      expect(traceCompact(inSandbox('src/notes.md'))).toEqual([
        inSandbox('src/Raw.stories.tsx'),
      ])
    })

    it('bails on the preview and on modules only it imports', () => {
      // 0 affected stories plus a "TurboSnap disabled" warning, not a trace.
      for (const file of build.bailed) {
        const { stdout, stderr } = trace(inSandbox(file))
        const output = stdout + stderr
        expect(output).toContain('0 affected story files')
        expect(output).toContain('TurboSnap disabled due to file change')
        expect(globalFiles).toContain(inSandbox(file))
      }
      // Components used by stories and not imported by the preview are not global.
      expect(globalFiles).not.toContain(inSandbox('src/Badge.tsx'))
    })

    it('derives a non-empty user file list from the stats', () => {
      for (const known of [
        'src/Badge.tsx',
        'src/Button.tsx',
        'src/Card.tsx',
        'src/Button.stories.tsx',
        'src/Docs.mdx',
      ]) {
        expect(userFiles.has(inSandbox(known))).toBe(true)
      }
      expect(userFiles.has(sharedRel)).toBe(true)

      // Every source file on disk must be in the derived list, so the stats
      // derivation cannot silently drop files (and with them, A3 coverage).
      // `.d.ts` files are type-only and never bundled.
      const onDisk = ['src', '../chromatic-turbosnap-shared/src'].flatMap(
        (dir) =>
          readdirSync(resolve(sandboxDir, dir), {
            recursive: true,
            withFileTypes: true,
          })
            .filter((entry) => entry.isFile() && !entry.name.endsWith('.d.ts'))
            .map((entry) => toGitRel(join(entry.parentPath, entry.name))),
      )
      expect(onDisk.length).toBeGreaterThan(0)
      expect(onDisk.filter((file) => !userFiles.has(file))).toEqual([])
    })

    // Invariants over every file in the build, with no per-file expectations.
    // `trace -m compact` lists affected story files without saying which
    // changed file caused each one, so a batched call cannot be attributed per
    // file: trace one file at a time and collect the offenders. Every affected
    // file must also be a real story from `index.json`: a bogus entry (e.g. an
    // inner module treated as a story, as before #644) shows up there even
    // though the count of results looks fine.
    const offendersOf = (
      files: Iterable<string>,
      ok: (file: string, affected: string[]) => boolean,
    ) =>
      [...files].flatMap((file) => {
        const affected = traceCompact(file)
        return ok(file, affected) && affected.every(isStory)
          ? []
          : [`${file} -> [${affected.join(', ')}]`]
      })

    // A2 is a sanity check only: it does not guard #644 (story files' own
    // traces are unaffected by that bug); A3 and the example cases do.
    it(
      'A2: every story file traces to itself, and only to story files',
      () => {
        const stories = [...storyImportPaths].map(inSandbox)
        expect(
          offendersOf(stories, (file, affected) => affected.includes(file)),
          'story files with a wrong self-trace',
        ).toEqual([])
      },
      SLOW_TEST_TIMEOUT,
    )

    // Excluded from A3: story files (covered by A2) and global files (see
    // `globalFiles`; their behavior is asserted by the preview example test).
    // A file imported by both the preview and a story is global too: the CLI
    // bails as soon as a trace reaches the preview, so it is not covered here.
    it(
      'A3: every non-story, non-global user file traces only to story files, at least one',
      () => {
        const candidates = [...userFiles].filter(
          (file) => !globalFiles.has(file) && !isStory(file),
        )
        expect(candidates.length).toBeGreaterThan(0)
        expect(
          offendersOf(candidates, (_file, affected) => affected.length > 0),
          'user files with no or non-story trace results',
        ).toEqual([])
      },
      SLOW_TEST_TIMEOUT,
    )
  })
}

builds.forEach(describeBuild)
