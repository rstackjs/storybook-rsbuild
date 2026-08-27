import { describe, expect, it } from '@rstest/core'
import type { StorybookConfig } from '../src/types'

const features = {
  experimentalTestSyntax: true,
  babelRemoveBugfixes: true,
} satisfies NonNullable<StorybookConfig['features']>

describe('StorybookConfig', () => {
  it('accepts React framework feature flags', () => {
    expect(features).toEqual({
      experimentalTestSyntax: true,
      babelRemoveBugfixes: true,
    })
  })
})
