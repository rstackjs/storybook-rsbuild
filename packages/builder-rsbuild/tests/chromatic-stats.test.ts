import { join } from 'node:path'
import { describe, expect, it, rs } from 'rstack/test'
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
  modules?: Array<{ name: string }>
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

// The CSF glob context module that imports every story file.
const STORIES_CONTEXT =
  './src|lazy|/^\\.\\/.*$/|include: /\\.stories\\.tsx$/|namespace object'

// Mirrors rspack stats for a story file concatenated with the component it
// renders and a helper outside the Storybook project root (`../shared`). As in
// rspack, an orphan entry for the story file with no id comes first, the nested
// modules have no id, their real importers in `reasons`, and absolute
// `nameForCondition` paths, here relative to process.cwd().
const createConcatenatedStoryStatsJson = (): Record<string, unknown> => ({
  modules: [
    {
      id: null,
      name: './src/PriceTag.stories.tsx',
      nameForCondition: join(process.cwd(), 'src/PriceTag.stories.tsx'),
      reasons: [],
    },
    {
      id: './src/PriceTag.stories.tsx',
      name: './src/PriceTag.stories.tsx + 2 modules',
      nameForCondition: join(process.cwd(), 'src/PriceTag.stories.tsx'),
      reasons: [{ moduleName: STORIES_CONTEXT }],
      modules: [
        {
          name: './src/PriceTag.stories.tsx',
          nameForCondition: join(process.cwd(), 'src/PriceTag.stories.tsx'),
          reasons: [],
        },
        {
          name: './src/PriceTag.tsx',
          nameForCondition: join(process.cwd(), 'src/PriceTag.tsx'),
          reasons: [{ moduleName: './src/PriceTag.stories.tsx' }],
        },
        {
          name: '../shared/format-price.ts',
          nameForCondition: join(process.cwd(), '../shared/format-price.ts'),
          reasons: [{ moduleName: './src/PriceTag.tsx' }],
        },
      ],
    },
  ],
})

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

  it('keeps the real importers of modules concatenated into a story file', () => {
    const normalized = withChromaticMinimalContract(
      createConcatenatedStoryStatsJson(),
    ) as ChromaticStatsJson

    // Only the story file is imported by the stories context. The component and
    // the helper outside the project root keep their own importers, so tracing
    // a change to the helper reaches the story file. Entry order carries no
    // meaning, so it is not asserted.
    expect(normalized.modules).toHaveLength(4)
    expect(normalized.modules).toEqual(
      expect.arrayContaining([
        {
          id: './src/PriceTag.stories.tsx',
          name: './src/PriceTag.stories.tsx + 2 modules',
          modules: [
            { name: './src/PriceTag.stories.tsx' },
            { name: './src/PriceTag.tsx' },
            { name: '../shared/format-price.ts' },
          ],
          reasons: [{ moduleName: STORIES_CONTEXT }],
        },
        {
          id: './src/PriceTag.stories.tsx',
          name: './src/PriceTag.stories.tsx',
          reasons: [{ moduleName: STORIES_CONTEXT }],
        },
        {
          id: 'src/PriceTag.tsx',
          name: 'src/PriceTag.tsx',
          reasons: [{ moduleName: './src/PriceTag.stories.tsx' }],
        },
        {
          id: '../shared/format-price.ts',
          name: '../shared/format-price.ts',
          reasons: [{ moduleName: './src/PriceTag.tsx' }],
        },
      ]),
    )
  })

  it('links a story file to the stories context when rspack names its inner module after the container', () => {
    const normalized = withChromaticMinimalContract({
      modules: [
        {
          id: './src/Card.stories.tsx',
          name: './src/Card.stories.tsx + 1 modules',
          reasons: [{ moduleName: STORIES_CONTEXT }],
          modules: [{ name: './src/Card.stories.tsx + 1 modules' }],
        },
      ],
    }) as ChromaticStatsJson

    expect(normalized.modules).toContainEqual({
      id: './src/Card.stories.tsx',
      name: './src/Card.stories.tsx',
      reasons: [{ moduleName: STORIES_CONTEXT }],
    })
  })

  it('wraps toJson and normalizes the returned stats json', () => {
    const toJson = rs.fn(() => createConcatenatedStatsJson())
    const compatStats = withStatsJsonCompat<StatsWithCallableToJson>({
      toJson,
    })

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
