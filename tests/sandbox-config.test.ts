import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runSandboxInspect } from './helpers/runSandboxInspect'

interface SnapshotTarget {
  id: string
  fileMatcher: (fileName: string) => boolean
  extract: (content: string) => string
}

interface SandboxSnapshotCase {
  sandbox: string
  targets: SnapshotTarget[]
}

const SANDBOX_CASES: SandboxSnapshotCase[] = [
  {
    sandbox: 'react-16',
    targets: [
      {
        id: 'gfm-mdx-compile',
        fileMatcher: (fileName) =>
          /^stories-GFM-mdx\..+\.iframe\.bundle\.js$/.test(fileName),
        extract: extractGfmRuntimeMarkers,
      },
    ],
  },
]

describe.each(SANDBOX_CASES)('$sandbox config snapshots', ({
  sandbox,
  targets,
}) => {
  const inspectResultPromise = runSandboxInspect(sandbox)

  for (const target of targets) {
    it(`matches ${target.id}`, async () => {
      const inspectResult = await inspectResultPromise
      const asyncChunkDir = join(
        inspectResult.outputDir,
        'static',
        'js',
        'async',
      )
      const matchedFile = (await readdir(asyncChunkDir)).find(
        target.fileMatcher,
      )

      if (!matchedFile) {
        throw new Error(
          `No built file matched "${target.id}" for sandbox "${sandbox}"`,
        )
      }

      const filePath = join(asyncChunkDir, matchedFile)
      const content = await readFile(filePath, 'utf8')
      const gfmRuntimeMarkers = target.extract(content)

      // These markers only appear when remark-gfm transformed the MDX content.
      expect(gfmRuntimeMarkers).toContain('mailto:contact@example.com')
      expect(gfmRuntimeMarkers).toContain('data-footnote-ref')
      expect(gfmRuntimeMarkers).toContain('contains-task-list')
      expect(gfmRuntimeMarkers).toContain('textAlign: "center"')
    })
  }
})

function extractGfmRuntimeMarkers(bundleCode: string): string {
  return bundleCode
}
