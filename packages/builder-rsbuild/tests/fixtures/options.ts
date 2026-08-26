import { rs } from '@rstest/core'
import type { Options } from 'storybook/internal/types'

type CreateTestOptionsParams = {
  presetValues?: Map<string, unknown>
  overrides?: Omit<Partial<Options>, 'cache' | 'presets'>
  withCache?: boolean
}

export const createTestOptions = ({
  presetValues = new Map(),
  overrides = {},
  withCache = false,
}: CreateTestOptionsParams = {}) => {
  const apply = rs.fn(async (name: string, defaultValue?: unknown) =>
    presetValues.has(name) ? presetValues.get(name) : defaultValue,
  )
  const cache = withCache
    ? ({
        get: rs.fn(
          async (_key: string, defaultValue?: unknown) => defaultValue,
        ),
        set: rs.fn(async () => undefined),
      } as unknown as NonNullable<Options['cache']>)
    : undefined
  const options = {
    ...overrides,
    ...(cache ? { cache } : {}),
    presets: { apply },
  } as unknown as Options

  return { apply, cache, options }
}
