import { join } from 'node:path'
import { describe, expect, it, rs } from '@rstest/core'
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

type StatsWithCallableToJson = {
  toJson: (options?: unknown, forToString?: unknown) => unknown
}

const createStatsJsonWithInvalidModules = (): Record<string, unknown> => {
  const changedSourcePath = join(
    process.cwd(),
    'packages/components/src/Button.tsx',
  )
  const sourceModulePath = join(
    process.cwd(),
    'packages/components/src/Button.stories.tsx',
  )

  return {
    modules: [
      {
        id: 101,
        reasons: [
          {
            moduleName: './storybook-config-entry.js',
          },
        ],
      },
      {
        id: null,
        nameForCondition: changedSourcePath,
        reasons: [
          {
            moduleIdentifier: `builtin:swc-loader!${sourceModulePath}`,
          },
        ],
      },
    ],
  }
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

    expect(normalized.modules).toEqual([
      {
        id: 'packages/components/src/HelloWorld.tsx',
        name: 'packages/components/src/HelloWorld.tsx',
        reasons: [
          {
            moduleName: 'packages/components/src/HelloWorld.stories.tsx',
          },
        ],
      },
    ])
  })

  it('wraps toJson and normalizes the returned stats json', () => {
    const toJson = rs.fn(() => createConcatenatedStatsJson())
    const compatStats = withStatsJsonCompat({
      toJson,
    } as StatsWithCallableToJson)

    const normalized = compatStats.toJson?.({
      hash: false,
    }) as ChromaticStatsJson

    expect(toJson).toHaveBeenCalledWith(
      {
        modules: true,
        reasons: true,
        nestedModules: true,
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

  it('drops invalid raw modules and rebuilds a Chromatic-safe modules list', () => {
    const normalized = withChromaticMinimalContract(
      createStatsJsonWithInvalidModules(),
    ) as ChromaticStatsJson

    expect(normalized.modules).toEqual([
      {
        id: 'packages/components/src/Button.tsx',
        name: 'packages/components/src/Button.tsx',
        reasons: [
          {
            moduleName: 'packages/components/src/Button.stories.tsx',
          },
        ],
      },
    ])
  })
})
