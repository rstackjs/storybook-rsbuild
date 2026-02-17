import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  withChromaticMinimalContract,
  withStatsJsonCompat,
} from '../src/chromatic-stats'

type ChromaticReason = {
  moduleName: string
}

type ChromaticModule = {
  id: string | number | null
  name: string
  reasons?: ChromaticReason[]
}

type ChromaticStatsJson = {
  modules: ChromaticModule[]
}

const createConcatenatedStatsJson = (): Record<string, unknown> => {
  const changedSourcePath = join(
    process.cwd(),
    'packages/components/src/HelloWorld.tsx',
  )
  const sourceModulePath = join(
    process.cwd(),
    'packages/components/src/HelloWorld.stories.tsx',
  )

  return {
    modules: [
      {
        id: null,
        name: '../components/src/HelloWorld.stories.tsx + 1 modules',
        nameForCondition: changedSourcePath,
        reasons: [
          {
            moduleName: '../components/src/HelloWorld.stories.tsx + 1 modules',
            moduleIdentifier: `builtin:swc-loader!${sourceModulePath}`,
          },
        ],
      },
    ],
  }
}

describe('chromatic stats compat', () => {
  it('normalizes concatenated modules into traceable module ids and reasons', () => {
    const normalized = withChromaticMinimalContract(
      createConcatenatedStatsJson(),
    ) as ChromaticStatsJson

    expect(normalized.modules).toContainEqual({
      id: 'packages/components/src/HelloWorld.tsx',
      name: 'packages/components/src/HelloWorld.tsx',
      reasons: [
        {
          moduleName: 'packages/components/src/HelloWorld.stories.tsx',
        },
      ],
    })

    expect(normalized.modules).toContainEqual(
      expect.objectContaining({
        id: null,
        name: '../components/src/HelloWorld.stories.tsx + 1 modules',
      }),
    )
  })

  it('wraps toJson and normalizes the returned stats json', () => {
    const toJson = vi.fn(() => createConcatenatedStatsJson())
    const compatStats = withStatsJsonCompat({ toJson })

    const normalized = compatStats.toJson?.({
      hash: false,
    }) as ChromaticStatsJson

    expect(toJson).toHaveBeenCalledWith(
      {
        all: true,
        modules: true,
        reasons: true,
        hash: false,
      },
      undefined,
    )
    expect(normalized.modules).toContainEqual({
      id: 'packages/components/src/HelloWorld.tsx',
      name: 'packages/components/src/HelloWorld.tsx',
      reasons: [
        {
          moduleName: 'packages/components/src/HelloWorld.stories.tsx',
        },
      ],
    })
  })
})
