import { describe, expect, it } from '@rstest/core'
import type { FrameworkOptions } from '../src/types'

const customElementsManifestOptions = [
  {},
  { customElementsManifest: './custom-elements.json' },
  {
    builder: {},
    customElementsManifest: ['./a/custom-elements.json', './b/manifest.json'],
  },
] satisfies FrameworkOptions[]

describe('FrameworkOptions', () => {
  it('accepts the renderer customElementsManifest option', () => {
    expect(customElementsManifestOptions).toHaveLength(3)
  })
})
