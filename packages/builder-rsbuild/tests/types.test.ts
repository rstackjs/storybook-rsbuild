import { describe, expect, it } from '@rstest/core'
import type { StorybookConfigRsbuild } from '../src/types'

const features = {
  experimentalTestSyntax: true,
  babelRemoveBugfixes: true,
} satisfies NonNullable<StorybookConfigRsbuild['features']>

describe('StorybookConfigRsbuild', () => {
  it('accepts builder feature flags', () => {
    expect(features).toEqual({
      experimentalTestSyntax: true,
      babelRemoveBugfixes: true,
    })
  })
})
