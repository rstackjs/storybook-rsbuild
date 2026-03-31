import { describe, expect, it } from '@rstest/core'
import { buildModuleGraph, mergeModuleGraphs } from '../src/build-module-graph'

type FakeModule = {
  type: string
  nameForCondition: () => string | undefined
}

type FakeConnection = {
  originModule: FakeModule | null
  resolvedModule: FakeModule | null
}

const createModule = (
  file: string | undefined,
  type = 'javascript/auto',
): FakeModule => ({
  type,
  nameForCondition: () => file,
})

const createCompilation = (
  modules: FakeModule[],
  connections: Array<{ from: FakeModule; to: FakeModule }>,
) => {
  const incoming = new Map<FakeModule, FakeConnection[]>()

  for (const { from, to } of connections) {
    const incomingConnections = incoming.get(to) ?? []
    incomingConnections.push({ originModule: from, resolvedModule: to })
    incoming.set(to, incomingConnections)
  }

  return {
    modules: new Set(modules),
    moduleGraph: {
      getIncomingConnections: (module: FakeModule) =>
        incoming.get(module) ?? [],
      getOutgoingConnections: () => [],
    },
  }
}

describe('buildModuleGraph', () => {
  it('builds reverse and forward file relationships from the rspack module graph', () => {
    const story = createModule('/repo/src/Button.stories.tsx')
    const component = createModule('/repo/src/Button.tsx')
    const styles = createModule('/repo/src/Button.css', 'css/module')

    const moduleGraph = buildModuleGraph(
      createCompilation(
        [story, component, styles],
        [
          { from: story, to: component },
          { from: component, to: styles },
        ],
      ) as never,
    )

    const componentNode = Array.from(
      moduleGraph.get('/repo/src/Button.tsx') ?? [],
    )[0]
    const stylesNode = Array.from(
      moduleGraph.get('/repo/src/Button.css') ?? [],
    )[0]
    const storyNode = Array.from(
      moduleGraph.get('/repo/src/Button.stories.tsx') ?? [],
    )[0]

    expect(componentNode?.type).toBe('js')
    expect(stylesNode?.type).toBe('css')
    expect(Array.from(componentNode?.importers ?? [])).toEqual([storyNode])
    expect(Array.from(componentNode?.importedModules ?? [])).toEqual([
      stylesNode,
    ])
  })

  it('keeps multiple module identities for the same file', () => {
    const client = createModule('/repo/src/shared.ts')
    const server = createModule('/repo/src/shared.ts')

    const moduleGraph = buildModuleGraph(
      createCompilation([client, server], []) as never,
    )

    expect(moduleGraph.get('/repo/src/shared.ts')?.size).toBe(2)
  })

  it('skips modules that do not resolve to a file path', () => {
    const story = createModule('/repo/src/Button.stories.tsx')
    const virtual = createModule(undefined)

    const moduleGraph = buildModuleGraph(
      createCompilation(
        [story, virtual],
        [{ from: story, to: virtual }],
      ) as never,
    )

    expect(moduleGraph.size).toBe(1)
    expect(moduleGraph.get('/repo/src/Button.stories.tsx')?.size).toBe(1)
  })

  it('merges module graphs from multiple compilations', () => {
    const a = buildModuleGraph(
      createCompilation([createModule('/repo/src/A.ts')], []) as never,
    )
    const b = buildModuleGraph(
      createCompilation([createModule('/repo/src/B.ts')], []) as never,
    )

    const merged = mergeModuleGraphs([a, b])

    expect(merged.has('/repo/src/A.ts')).toBe(true)
    expect(merged.has('/repo/src/B.ts')).toBe(true)
  })
})
