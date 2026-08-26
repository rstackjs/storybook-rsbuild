import { rs } from '@rstest/core'
import type { Options } from 'storybook/internal/types'

type CreateTestOptionsParams = {
  presetValues?: Map<string, unknown>
  overrides?: Omit<Partial<Options>, 'presets'>
}

export const createTestOptions = ({
  presetValues = new Map(),
  overrides = {},
}: CreateTestOptionsParams = {}) => {
  const apply = rs.fn(async (name: string, defaultValue?: unknown) =>
    presetValues.has(name) ? presetValues.get(name) : defaultValue,
  )
  const options = {
    ...overrides,
    presets: { apply },
  } as unknown as Options

  return { options }
}
